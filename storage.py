"""
SGOD_PMES -- File Storage Helpers
====================================
Centralized upload pipeline. Every accepted upload is saved under:

    <UPLOAD_ROOT>/<year>/<Mon>/<irc_type>_<8-char-uuid>_<original-name><ext>

e.g.  uploads/2026/Jan/irc1a_9f3c1a2b_july-report.pdf
      uploads/2026/Unspecified/irc9_4b7e0d12_PMCF_Jean.docx

Most reports upload PDFs; IRC9 (PMCF) also accepts .docx, since a
scanned/image-only PDF has no text layer to extract from. The extension
is whatever the user uploaded -- `save_uploaded_document` does not care,
and each route validates the formats it can actually parse.

The on-disk folder structure (year -> month) is what a person browsing
the file manager sees; the DB row (`UploadedFile.relative_path`) is the
actual source of truth an app route should use to open/delete a file --
never reconstruct a path from year/month/filename by hand.

Also included:
  * `enable_sqlite_foreign_keys` -- SQLite ignores FK constraints (and
    therefore ON DELETE CASCADE) unless you turn it on per-connection.
  * `delete_uploaded_file` -- the one function that should be used to
    delete a file. It removes the DB row (cascading to every extracted
    record via models.py's relationships) *and* the file on disk, as a
    single operation, so they can never drift out of sync.
  * `seed_schools` -- one-time import of the master school list (and
    DEDP-priority flags) currently hardcoded in irc2a.js, into the new
    `School` table.
"""

import hashlib
import os
import uuid

from sqlalchemy import event
from sqlalchemy.engine import Engine
from werkzeug.utils import secure_filename

from models import IRC7Row, School, UploadedFile, db

MONTH_KEYS = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
]

# 3-letter, capitalized -- used as the on-disk month folder name.
MONTH_FOLDER_NAMES = {
    "jan": "Jan", "feb": "Feb", "mar": "Mar", "apr": "Apr",
    "may": "May", "jun": "Jun", "jul": "Jul", "aug": "Aug",
    "sep": "Sep", "oct": "Oct", "nov": "Nov", "dec": "Dec",
}


class InvalidUploadError(ValueError):
    """Raised for a bad month_key or an upload_root that can't be created."""


# ---------------------------------------------------------------------------
# SQLite ON DELETE CASCADE only works if foreign_keys is turned on --
# it's OFF by default. Call this once, right after creating the engine
# (see app.py). This is a belt-and-suspenders measure: the app's own
# delete_uploaded_file() below cascades via the ORM regardless, but this
# also protects you if anything ever deletes rows outside the ORM.
# ---------------------------------------------------------------------------
def enable_sqlite_foreign_keys(app_or_engine):
    @event.listens_for(Engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):  # noqa: ARG001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def _hash_and_size(path):
    sha256 = hashlib.sha256()
    size = 0
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            sha256.update(chunk)
            size += len(chunk)
    return sha256.hexdigest(), size


def save_uploaded_document(file_storage, upload_root, irc_type, year, month_key=None):
    """Saves an already-validated upload (a werkzeug FileStorage) under
    upload_root/<year>/<MonthFolder>/, using a collision-proof stored
    filename, and returns a dict ready to spread into UploadedFile(**dict).

    Format-agnostic: the extension is whatever the user uploaded (.pdf,
    .docx, ...), preserved from the original filename. Callers are
    responsible for rejecting formats they can't parse.

    IMPORTANT: the parser (pdfplumber, python-docx) consumes the upload
    stream when it reads the file for extraction. Call
    `file_storage.stream.seek(0)` before calling this function (this
    function also seeks defensively, but doing it explicitly at the call
    site keeps the ordering obvious).
    """
    if month_key is not None and month_key not in MONTH_KEYS:
        raise InvalidUploadError(f"Unknown month_key: {month_key!r}")

    folder_name = MONTH_FOLDER_NAMES[month_key] if month_key else "Unspecified"
    relative_dir = os.path.join(str(year), folder_name)
    absolute_dir = os.path.join(upload_root, relative_dir)
    os.makedirs(absolute_dir, exist_ok=True)

    original_filename = file_storage.filename or "upload"
    safe_original = secure_filename(original_filename) or "upload"
    stored_filename = f"{irc_type}_{uuid.uuid4().hex[:8]}_{safe_original}"
    absolute_path = os.path.join(absolute_dir, stored_filename)

    file_storage.stream.seek(0)
    file_storage.save(absolute_path)

    content_hash, file_size = _hash_and_size(absolute_path)

    return {
        "irc_type": irc_type,
        "original_filename": original_filename,
        "stored_filename": stored_filename,
        "relative_path": os.path.join(relative_dir, stored_filename),
        "year": year,
        "month_key": month_key,
        "month_name": folder_name,
        "file_size": file_size,
        "content_hash": content_hash,
    }


def save_uploaded_pdf(file_storage, upload_root, irc_type, year, month_key=None):
    """PDF-specific alias kept for the existing IRC1a/IRC1b/IRC2a/IRC3
    callers, which all validate the .pdf extension themselves before
    calling. Identical behavior to save_uploaded_document."""
    return save_uploaded_document(
        file_storage, upload_root, irc_type, year, month_key=month_key
    )


def delete_uploaded_file(uploaded_file, upload_root):
    """The single entry point for deleting an uploaded PDF.

    1. Deletes the file from disk (best-effort -- a file already
       missing on disk shouldn't block the DB cleanup).
    2. Deletes the UploadedFile row, which cascades (via the
       relationships defined in models.py) to every IRC1a rating,
       IRC1b count, IRC2a status, etc. that pointed back to it.
    3. Prunes now-empty year/month folders so the upload tree doesn't
       accumulate clutter over time.

    Call this instead of `db.session.delete(uploaded_file)` directly,
    so the file on disk and the DB never drift out of sync.
    """
    absolute_path = os.path.join(upload_root, uploaded_file.relative_path)

    try:
        os.remove(absolute_path)
    except FileNotFoundError:
        pass

    db.session.delete(uploaded_file)  # cascades to all linked IRC records
    db.session.commit()

    month_dir = os.path.dirname(absolute_path)
    year_dir = os.path.dirname(month_dir)
    for d in (month_dir, year_dir):
        try:
            if os.path.isdir(d) and not os.listdir(d):
                os.rmdir(d)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# One-time school master-list seed (source: irc2a.js's SCHOOLS + DEDP_PRIORITY)
# ---------------------------------------------------------------------------
_SCHOOLS_SEED = [
    ("Antipolo City Senior High School", "secondary"),
    ("Antipolo City SPED Center", "elementary"),
    ("Antipolo National Science and Technology HS", "secondary"),
    ("Antipolo NHS", "secondary"),
    ("Apia Integrated School", "secondary"),
    ("Bagong Nayon I ES", "elementary"),
    ("Bagong Nayon II ES", "elementary"),
    ("Bagong Nayon II NHS", "secondary"),
    ("Bagong Nayon IV ES", "elementary"),
    ("Binayoyo Integrated School", "secondary"),
    ("Cabading ES", "elementary"),
    ("Calawis ES", "elementary"),
    ("Calawis NHS", "secondary"),
    ("Canumay ES", "elementary"),
    ("Canumay NHS", "secondary"),
    ("Cupang ES", "elementary"),
    ("Cupang ES Annex", "elementary"),
    ("Cupang NHS", "secondary"),
    ("Dalig ES", "elementary"),
    ("Dalig NHS", "secondary"),
    ("Dela Paz ES", "elementary"),
    ("Dela Paz NHS", "secondary"),
    ("Inuman ES", "elementary"),
    ("Isaias S. Tapales ES", "elementary"),
    ("Jesus S. Cabarrus ES", "elementary"),
    ("Juan Sumulong ES", "elementary"),
    ("Kaila ES", "elementary"),
    ("Kaysakat ES", "elementary"),
    ("Kaysakat NHS", "secondary"),
    ("Knights of Columbus ES", "elementary"),
    ("Libis ES", "elementary"),
    ("Lores ES", "elementary"),
    ("Mambugan I ES", "elementary"),
    ("Mambugan II ES", "elementary"),
    ("Mambugan NHS", "secondary"),
    ("Marcelino M. Santos NHS", "secondary"),
    ("Maximo L. Gatlabayan MNHS", "secondary"),
    ("Mayamot ES", "elementary"),
    ("Mayamot NHS", "secondary"),
    ("Muntindilaw ES", "elementary"),
    ("Muntindilaw NHS", "secondary"),
    ("Nazarene Ville ES", "elementary"),
    ("Old Boso-Boso ES", "elementary"),
    ("Old Boso-Boso NHS", "secondary"),
    ("Paglitaw ES", "elementary"),
    ("Pantay ES", "elementary"),
    ("Peace Village ES", "elementary"),
    ("Pe\u00f1afrancia ES", "elementary"),
    ("Pe\u00f1afrancia ES Annex", "elementary"),
    ("Rizza ES", "elementary"),
    ("Rizza NHS", "secondary"),
    ("San Antonio Village ES", "elementary"),
    ("San Isidro ES", "elementary"),
    ("San Isidro NHS", "secondary"),
    ("San Jose NHS", "secondary"),
    ("San Joseph ES", "elementary"),
    ("San Juan NHS", "secondary"),
    ("San Luis ES", "elementary"),
    ("San Roque NHS", "secondary"),
    ("San Ysiro ES", "elementary"),
    ("Sapinit ES", "elementary"),
    ("Sta. Cruz ES", "elementary"),
    ("Sumilang ES", "elementary"),
    ("Taguete ES", "elementary"),
    ("Tanza ES", "elementary"),
    ("Teofila Z. Rovero MES", "elementary"),
    ("Upper Kilingan ES", "elementary"),
]

_DEDP_PRIORITY = {
    "Antipolo NHS", "Bagong Nayon I ES", "Bagong Nayon II ES", "Bagong Nayon II NHS",
    "Bagong Nayon IV ES", "Cupang ES", "Dalig NHS", "Dela Paz ES",
    "Jesus S. Cabarrus ES", "Juan Sumulong ES", "Kaysakat ES", "Lores ES",
    "Mambugan I ES", "Mambugan II ES", "Mambugan NHS", "Maximo L. Gatlabayan MNHS",
    "Mayamot ES", "Muntindilaw ES", "Peace Village ES", "Pe\u00f1afrancia ES",
    "Rizza ES", "San Antonio Village ES", "San Isidro ES", "San Isidro NHS",
    "San Jose NHS", "Tanza ES",
}


def seed_schools():
    """Idempotent: only inserts schools that don't already exist by name.
    Run this once after `db.create_all()` (see app.py's `init-db` CLI
    command). Re-running it later is safe -- it won't create duplicates
    or touch existing rows' DEDP flags."""
    existing_names = {name for (name,) in db.session.query(School.name).all()}

    new_rows = [
        School(name=name, level=level, is_dedp_priority=name in _DEDP_PRIORITY)
        for name, level in _SCHOOLS_SEED
        if name not in existing_names
    ]

    if new_rows:
        db.session.bulk_save_objects(new_rows)
        db.session.commit()

    return len(new_rows)


# ---------------------------------------------------------------------------
# One-time IRC7 reference-row seed (source: the fixed rows previously
# hardcoded directly into irc7.html's <tbody>). Each tuple is:
#   (school_id_code, school_name, curricular_offering, dlc, dedp_status,
#    classification)
# A handful of schools legitimately appear twice (once per curricular
# offering, e.g. Apia Integrated School / Elementary and /Secondary) -- that
# duplication is preserved here rather than collapsed, since it's what
# irc7.js's fixed table actually showed.
# ---------------------------------------------------------------------------
_IRC7_ROWS_SEED = [
    ("321507", "Antipolo City National Science and Technology HS", "JHS with SHS", "II-D", "non-DEDP", "Small"),
    ("342175", "Antipolo City Senior HS", "Secondary", "I-A", "non-DEDP", "Large"),
    ("500392", "Antipolo City SPED Center", "Elementary", "I-B", "non-DEDP", "Small"),
    ("301418", "Antipolo NHS", "Secondary", "I-A", "DEDP", "Very Large"),
    ("500391", "Apia Integrated School", "Elementary", "II-F", "non-DEDP", "Small"),
    ("500391", "Apia Integrated School", "Secondary", "II-F", "non-DEDP", "Small"),
    ("109319", "Bagong Nayon I ES", "Elementary", "I-A", "DEDP", "Very Large"),
    ("109320", "Bagong Nayon II ES", "Elementary", "I-B", "DEDP", "Very Large"),
    ("301419", "Bagong Nayon II NHS", "JHS with SHS", "I-B", "DEDP", "Very Large"),
    ("109321", "Bagong Nayon IV ES", "Elementary", "I-B", "DEDP", "Very Large"),
    ("501119", "Binayoyo Integrated School", "Elementary", "II-F", "non-DEDP", "Small"),
    ("501119", "Binayoyo Integrated School", "Secondary", "II-F", "non-DEDP", "Small"),
    ("109335", "Cabading ES", "Elementary", "II-D", "non-DEDP", "Small"),
    ("109348", "Calawis ES", "Elementary", "II-F", "non-DEDP", "Small"),
    ("301431", "Calawis NHS", "JHS with SHS", "II-F", "non-DEDP", "Small"),
    ("109349", "Canumay ES", "Elementary", "II-G", "non-DEDP", "Small"),
    ("321502", "Canumay NHS", "JHS with SHS", "II-G", "non-DEDP", "Small"),
    ("109323", "Cupang ES", "Elementary", "II-C", "DEDP", "Very Large"),
    ("230002", "Cupang ES Annex", "Elementary", "II-C", "non-DEDP", "Small"),
    ("301420", "Cupang NHS", "Secondary", "II-C", "non-DEDP", "Large"),
    ("109324", "Dalig ES", "Elementary", "II-A", "non-DEDP", "Small"),
    ("321506", "Dalig NHS", "JHS with SHS", "II-B", "DEDP", "Large"),
    (None, "Dela Paz ES", "Elementary", "I-A", "DEDP", "Large"),
    ("321505", "Dela Paz NHS", "JHS with SHS", "I-A", "non-DEDP", "Large"),
    ("109326", "Inuman ES", "Elementary", "II-D", "non-DEDP", "Large"),
    ("109350", "Isaias S. Tapales ES", "Elementary", "II-B", "non-DEDP", "Very Large"),
    ("109351", "Jesus S. Cabarrus ES", "Elementary", "II-B", "DEDP", "Large"),
    ("109327", "Juan Sumulong ES", "Elementary", "II-A", "DEDP", "Very Large"),
    ("109328", "Kaila ES", "Elementary", "II-A", "non-DEDP", "Medium"),
    ("109352", "Kaysakat ES", "Elementary", "II-G", "DEDP", "Small"),
    ("301421", "Kaysakat NHS", "JHS with SHS", "II-G", "non-DEDP", "Small"),
    ("230003", "Knights of Columbus ES", "Elementary", "II-A", "non-DEDP", "Medium"),
    ("109322", "Libis ES", "Elementary", "II-G", "non-DEDP", "Small"),
    ("109329", "Lores ES", "Elementary", "II-A", "DEDP", "Large"),
    ("109330", "Mambugan I ES", "Elementary", "I-C", "DEDP", "Large"),
    ("230005", "Mambugan II ES", "Elementary", "I-C", "DEDP", "Medium"),
    ("301448", "Mambugan NHS", "Secondary", "I-C", "DEDP", "Very Large"),
    ("321501", "Marcelino M. Santos NHS", "JHS with SHS", "II-B", "non-DEDP", "Medium"),
    ("301450", "Maximo L. Gatlabayan Memorial NHS", "JHS with SHS", "II-E", "DEDP", "Large"),
    ("109331", "Mayamot ES", "Elementary", "I-C", "DEDP", "Very Large"),
    ("301422", "Mayamot NHS", "JHS with SHS", "I-C", "non-DEDP", "Very Large"),
    ("109332", "Muntindilaw ES", "Elementary", "I-C", "DEDP", "Medium"),
    ("301423", "Muntindilaw NHS", "JHS with SHS", "I-C", "non-DEDP", "Medium"),
    ("109333", "Nazarene Ville ES", "Elementary", "II-A", "non-DEDP", "Medium"),
    ("109334", "Old Boso-boso ES", "Elementary", "II-E", "non-DEDP", "Large"),
    ("308101", "Old Boso-boso NHS", "JHS with SHS", "II-E", "non-DEDP", "Medium"),
    ("230006", "Paglitaw ES", "Elementary", "II-F", "non-DEDP", "Small"),
    ("109354", "Pantay ES", "Elementary", "II-B", "non-DEDP", "Medium"),
    ("109336", "Peace Village ES", "Elementary", "II-D", "DEDP", "Large"),
    ("109337", "Pe\u00f1afrancia ES", "Elementary", "II-C", "DEDP", "Very Large"),
    ("109338", "Pe\u00f1afrancia ES Annex", "Elementary", "II-C", "non-DEDP", "Small"),
    ("109357", "Rizza ES", "Elementary", "II-E", "DEDP", "Medium"),
    ("321504", "Rizza NHS", "JHS with SHS", "II-E", "non-DEDP", "Small"),
    ("109358", "San Antonio Village ES", "Elementary", "II-B", "DEDP", "Large"),
    ("109339", "San Isidro ES", "Elementary", "I-B", "DEDP", "Very Large"),
    ("301426", "San Isidro NHS", "JHS with SHS", "I-B", "DEDP", "Large"),
    ("301457", "San Jose NHS", "JHS with SHS", "II-A", "DEDP", "Very Large"),
    ("109359", "San Joseph ES", "Elementary", "II-G", "non-DEDP", "Small"),
    ("301427", "San Juan NHS", "JHS with SHS", "II-F", "non-DEDP", "Medium"),
    ("109340", "San Luis ES", "Elementary", "II-D", "non-DEDP", "Medium"),
    ("301425", "San Roque NHS", "JHS with SHS", "II-A", "non-DEDP", "Very Large"),
    ("109360", "San Ysiro ES", "Elementary", "II-G", "non-DEDP", "Small"),
    ("109341", "Sapinit ES", "Elementary", "II-F", "non-DEDP", "Medium"),
    ("109342", "Sta. Cruz ES", "Elementary", "I-A", "non-DEDP", "Very Large"),
    ("109361", "Sumilang ES", "Elementary", "II-E", "non-DEDP", "Small"),
    ("111082", "Taguete ES", "Elementary", "II-C", "non-DEDP", "Medium"),
    ("230001", "Tanza ES", "Elementary", "II-D", "DEDP", "Medium"),
    ("109343", "Teofila Z. Rovero Memorial ES", "Elementary", "II-B", "non-DEDP", "Medium"),
    ("109363", "Upper Kilingan ES", "Elementary", "II-E", "non-DEDP", "Small"),
]


def seed_irc7_rows():
    """Idempotent, mirroring seed_schools(): only inserts rows that don't
    already exist for that exact (school_name, curricular_offering) pair,
    so it's safe to re-run and won't create duplicates or touch existing
    rows' data. Run once after `db.create_all()` (see app.py's `init-db`
    CLI command)."""
    existing_pairs = {
        (name, offering)
        for (name, offering) in db.session.query(
            IRC7Row.school_name, IRC7Row.curricular_offering
        ).all()
    }

    new_rows = [
        IRC7Row(
            school_id_code=school_id_code,
            school_name=name,
            curricular_offering=offering,
            dlc=dlc,
            dedp_status=status,
            classification=classification,
            sort_order=i,
        )
        for i, (school_id_code, name, offering, dlc, status, classification) in enumerate(_IRC7_ROWS_SEED)
        if (name, offering) not in existing_pairs
    ]

    if new_rows:
        db.session.bulk_save_objects(new_rows)
        db.session.commit()

    return len(new_rows)