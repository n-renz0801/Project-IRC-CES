import os
import sys
import json
from datetime import datetime
from flask import Flask, render_template, abort, request, jsonify
import pdfplumber
import re

from models import (
    db,
    School,
    UploadedFile,
    IRC1ARating,
    IRC1ARemark,
    IRC1BCustomerCount,
    IRC2ASchoolStatus,
    IRC2BTAFrequency,
    IRC3Status,
    IRC4Plan,
    IRC4Objective,
    IRC4Group,
    IRC4GroupSchool,
    IRC5Entry,
    IRC6Entry,
    IRC7Row,
    IRC7Column,
    IRC7CellValue,
    IRC8BRating,
    IRC8AKra,
    IRC8AObjective,
    IRC8AIndicator,
    IRC8A_CATEGORIES,
    ReportPreparer,
    IRC8AApprovingAuthority,
    IRC8AReportHeader,
    ReportSignatoryDate,
    MONTH_KEYS,
    TA_STATUS_PROVIDED,
    TA_STATUS_UNPROVIDED,
    IRC1A_REMARK_CATEGORIES,
    IRC5_NATURE_FUNDED,
    IRC5_NATURE_NONFUNDED,
    IRC6_KIND_GOAL,
    IRC6_KIND_OUTCOME,
    IRC6_KIND_OUTPUT,
    IRC7_COLUMN_TYPE_TEXT,
    IRC7_COLUMN_TYPE_NUMBER,
    IRC7_COLUMN_TYPE_PARAGRAPH,
    IRC7_COLUMN_TYPE_CHECKBOX,
    IRC8B_SECTION_CBC,
    IRC8B_SECTION_LEADERSHIP,
    IRC8A_PART_B,
    seed_irc8a_defaults,
    IRC8DRow,
    IRC8DFeedback,
    IRC8D_PARTS,
    IRC8D_POSITIONS_BY_PART,
)
import storage

def _resource_dir():
    """Where templates/ and static/ live. Read-only, so it's fine for this
    to sit inside PyInstaller's temp extraction folder (sys._MEIPASS) when
    frozen -- that folder just needs to exist for the life of the run."""
    if getattr(sys, "frozen", False):
        return sys._MEIPASS
    return os.path.abspath(os.path.dirname(__file__))


def _data_dir():
    """Where the SQLite file and uploaded PDFs live. This MUST be a stable,
    writable, per-user location -- never PyInstaller's temp extraction
    folder, which is deleted the moment the app closes (that would wipe
    the database and every uploaded file on every restart). In dev
    (not frozen) we keep using the project folder for convenience; once
    frozen we switch to the OS's standard per-user app-data location."""
    if getattr(sys, "frozen", False):
        if sys.platform == "win32":
            root = os.environ.get("LOCALAPPDATA", os.path.expanduser("~"))
        elif sys.platform == "darwin":
            root = os.path.expanduser("~/Library/Application Support")
        else:
            root = os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share"))
        return os.path.join(root, "EOPCRF_CES")
    return os.path.abspath(os.path.dirname(__file__))


app = Flask(
    __name__,
    template_folder=os.path.join(_resource_dir(), "templates"),
    static_folder=os.path.join(_resource_dir(), "static"),
)

# ---------------------------------------------------------------------------
# Database + upload-storage configuration
#
# BASE_DIR anchors both the SQLite file and the uploads tree to a stable,
# writable, per-user location (see _data_dir() above) rather than the
# current working directory or the app's install folder, so the pywebview
# .exe build keeps its data across restarts/reinstalls.
# ---------------------------------------------------------------------------
BASE_DIR = _data_dir()
INSTANCE_DIR = os.path.join(BASE_DIR, "instance")
os.makedirs(INSTANCE_DIR, exist_ok=True)

app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + os.path.join(INSTANCE_DIR, "eopcrf_ces.db")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["UPLOAD_ROOT"] = os.path.join(BASE_DIR, "uploads")
os.makedirs(app.config["UPLOAD_ROOT"], exist_ok=True)

app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024  # 20 MB per upload, generous for these PDFs

db.init_app(app)
storage.enable_sqlite_foreign_keys(app)


@app.cli.command("init-db")
def init_db_command():
    """Usage: flask --app app init-db
    Creates all tables (if missing) and seeds the School master list.
    Safe to run more than once."""
    with app.app_context():
        db.create_all()
        added = storage.seed_schools()
        added_irc7 = storage.seed_irc7_rows()
        print(f"Database ready at {app.config['SQLALCHEMY_DATABASE_URI']}")
        print(f"Seeded {added} new school(s) (existing schools were left untouched).")
        print(f"Seeded {added_irc7} new IRC7 row(s) (existing rows were left untouched).")

# ---------------------------------------------------------------------------
# Fixed list of tabs. This system has exactly 13 Individual Report Cards
# and this list will not grow, so it's kept simple as a constant here.
# ---------------------------------------------------------------------------
TABS = [
    {"id": "irc1a", "short": "IRC1a", "name": "Individual Report Card No. 1a", "desc": "Monthly Customers Feedback Rating"},
    {"id": "irc1b", "short": "IRC1b", "name": "Individual Report Card No. 1b", "desc": "Number of Customers Served"},
    {"id": "irc2a", "short": "IRC2a", "name": "Individual Report Card No. 2a", "desc": "Number of Schools Provided with TA"},
    {"id": "irc2b", "short": "IRC2b", "name": "Individual Report Card No. 2b", "desc": "Frequency of TA Provided to DEDP Priority Schools"},
    {"id": "irc3",  "short": "IRC3",  "name": "Individual Report Card No. 3",  "desc": "Status of TA Provision to Schools"},
    {"id": "irc4",  "short": "IRC4",  "name": "Individual Report Card No. 4",  "desc": "Technical Assistance (TA) Catch-up Plan"},
    {"id": "irc5",  "short": "IRC5",  "name": "Individual Report Card No. 5",  "desc": "Post Program Evaluation Results"},
    {"id": "irc6",  "short": "IRC6",  "name": "Individual Report Card No. 6",  "desc": "Monitoring & Evaluation Plan"},
    {"id": "irc7",  "short": "IRC7",  "name": "Individual Report Card No. 7",  "desc": "SGOD Dashboard Data"},
    {"id": "irc8a", "short": "IRC8a", "name": "Individual Report Card No. 8a", "desc": "Individual Performance Commitment and Review Form (IPCRF)"},
    {"id": "irc8b", "short": "IRC8b", "name": "Individual Report Card No. 8b", "desc": "Leadership and Core Behavioral Competencies"},
    {"id": "irc8c", "short": "IRC8c", "name": "Individual Report Card No. 8c", "desc": "Summary of Ratings"},
    {"id": "irc8d", "short": "IRC8d", "name": "Individual Report Card No. 8d", "desc": "Improvement and Development Plans"},
]

# Quick lookup by id, e.g. TAB_LOOKUP["irc1a"]
TAB_LOOKUP = {tab["id"]: tab for tab in TABS}

# Each tab renders its own template file under templates/tabs/, since every
# report card has its own structure/functionality. E.g. "irc1a" -> "tabs/irc1a.html"
TEMPLATE_MAP = {tab["id"]: f"tabs/{tab['id']}.html" for tab in TABS}

# ---------------------------------------------------------------------------
# Groupings used only on the home page, so related sub-reports (1a/1b,
# 2a/2b, 8a-8d) can be shown under one parent card instead of 13 separate
# tiles. Each group's "tabs" list holds the actual tab dicts from TABS above.
# ---------------------------------------------------------------------------
GROUPS = [
    {"code": "IRC1", "label": "Monthly Customers Feedback Rating & Number of Customers Served", "tabs": [TAB_LOOKUP["irc1a"], TAB_LOOKUP["irc1b"]]},
    {"code": "IRC2", "label": "Number of Schools Provided with TA & Frequency of TA Provided to DEDP Priority Schools", "tabs": [TAB_LOOKUP["irc2a"], TAB_LOOKUP["irc2b"]]},
    {"code": "IRC3", "label": "Individual Report Card No. 3", "tabs": [TAB_LOOKUP["irc3"]]},
    {"code": "IRC4", "label": "Individual Report Card No. 4", "tabs": [TAB_LOOKUP["irc4"]]},
    {"code": "IRC5", "label": "Individual Report Card No. 5", "tabs": [TAB_LOOKUP["irc5"]]},
    {"code": "IRC6", "label": "Individual Report Card No. 6", "tabs": [TAB_LOOKUP["irc6"]]},
    {"code": "IRC7", "label": "Individual Report Card No. 7", "tabs": [TAB_LOOKUP["irc7"]]},
    {"code": "IRC8", "label": "Individual Performance Commitment and Review Form (IPCRF)", "tabs": [
        TAB_LOOKUP["irc8a"], TAB_LOOKUP["irc8b"], TAB_LOOKUP["irc8c"], TAB_LOOKUP["irc8d"],
    ]},
]

# Shared by every "extract month from header" route, since every one of these
# monthly PDFs uses the same "TECHNICAL ASSISTANCE FEEDBACK RESULTS (MONTH)"
# header format.
MONTH_HEADER_PATTERN = r"TECHNICAL ASSISTANCE FEEDBACK RESULTS\s*\(?([A-Za-z]+)\)?"
MONTH_MAP = {
    'january': 'jan', 'february': 'feb', 'march': 'mar', 'april': 'apr',
    'may': 'may', 'june': 'jun', 'july': 'jul', 'august': 'aug',
    'september': 'sep', 'october': 'oct', 'november': 'nov', 'december': 'dec'
}


def _extract_month(full_text):
    """Returns (month_name, month_key) parsed from the report header, or
    (None, None) if it couldn't be found/recognized."""
    month_match = re.search(MONTH_HEADER_PATTERN, full_text)
    if not month_match:
        return None, None

    month_name = month_match.group(1).strip().lower()
    month_key = MONTH_MAP.get(month_name)
    return month_name, month_key


def _parse_numbered_school_list(section_text):
    """Parses a numbered list of school names that may wrap across lines.

    Handles both layouts seen in these PDFs:
      "1 Apia Integrated School"                    (number + name, one line)
      "1\\nAntipolo National Science and\\nTechnology HS"  (number alone on
      its own line, with the name wrapping across the following lines until
      the next number)

    Numbers are expected to increase by 1 each time (1, 2, 3, ...) — this is
    what lets the parser tell "this line starts a new entry" apart from
    "this line is a continuation of the current school's name", even though
    both cases can be plain text lines.
    """
    lines = [ln.strip() for ln in section_text.split("\n") if ln.strip()]

    num_pattern = re.compile(r"^(\d{1,3})\b\s*(.*)$")
    expected = 1
    current_name_parts = []
    have_entry = False
    schools = []

    def finalize():
        name = " ".join(current_name_parts).strip()
        name = re.sub(r"\s+", " ", name)
        if name:
            schools.append(name)

    for line in lines:
        m = num_pattern.match(line)
        if m and int(m.group(1)) == expected:
            if have_entry:
                finalize()
            expected += 1
            have_entry = True
            rest = m.group(2).strip()
            current_name_parts = [rest] if rest else []
        else:
            current_name_parts.append(line)

    if have_entry:
        finalize()

    return schools


# ---------------------------------------------------------------------------
# Shared section parsers
#
# Each of these parses ONE section out of a monthly report's full text and
# returns "nothing found" in a form its caller can check with a plain
# truthiness test (empty dict / None / empty list) rather than raising --
# that's what lets the home page's combined extractor try all of them
# against a single upload and simply skip whichever ones don't match,
# without one missing section aborting the others. The single-type
# per-tab routes below (extract_irc1a_pdf, etc.) call the same helpers,
# then layer their own "this whole upload failed" checks on top.
# ---------------------------------------------------------------------------
def _parse_irc1a_indicators(full_text):
    """Returns {indicator_id (1-10): rating (float)} for whatever
    indicators could be matched in the text -- may be a partial set, or
    empty if the section isn't present at all."""
    indicators_data = {}
    pattern = r'(\d+)\)\s*(.+?)\s+([\d.]+)(?:\s|$|Monthly)'
    for match in re.finditer(pattern, full_text, re.DOTALL):
        indicator_num = int(match.group(1))
        if 1 <= indicator_num <= 10:
            try:
                rating = float(match.group(3))
                if 1 <= rating <= 5:
                    indicators_data[indicator_num] = rating
            except ValueError:
                pass
    return indicators_data


def _parse_irc1b_customers(full_text):
    """Returns the customer count (int), or None if the "No. of
    Customers:" line isn't present or couldn't be parsed."""
    customers_pattern = r"No\.\s*of\s*Customers\s*:?\s*([\d,]+)"
    match = re.search(customers_pattern, full_text, re.IGNORECASE)
    if not match:
        return None
    try:
        return int(match.group(1).replace(",", ""))
    except ValueError:
        return None


def _parse_irc2a_schools(full_text):
    """Returns a list of school names parsed from the "Schools Provided
    with TA" section, or [] if that section isn't present or nothing
    could be parsed from it."""
    section_match = re.search(
        r"Schools Provided with TA(.*?)(?:Prepared by:|$)",
        full_text,
        re.DOTALL | re.IGNORECASE,
    )
    if not section_match:
        return []
    return _parse_numbered_school_list(section_match.group(1))


# ---------------------------------------------------------------------------
# DB persistence helpers
#
# Each of these does an "upsert" keyed on the table's unique constraint
# (see models.py), so re-importing the same month twice updates the
# existing row instead of creating a duplicate. Every one accepts an
# optional `uploaded_file` so manual edits (no PDF) can call them too,
# just passing uploaded_file=None.
# ---------------------------------------------------------------------------
def _current_year():
    return datetime.now().year


def _get_preparer():
    """Single global row holding the 'Prepared by' name/position (see
    ReportPreparer in models.py). Created lazily with blank fields on
    first access so callers never have to special-case "no row yet"."""
    preparer = ReportPreparer.query.first()
    if preparer is None:
        preparer = ReportPreparer(name="", position="")
        db.session.add(preparer)
        db.session.commit()
    return preparer


# Signatories shared by OPCRF I-IV (irc8a-irc8d). The ratee, rater and approving
# authority names (and the ratee's position) are editable but fall back to these
# defaults whenever they are blank. The rater's and authority's positions are
# fixed.
RATEE_NAME = "DR. JONATHAN P. DOMINGO"
RATEE_POSITION = "SGOD Chief"
DEFAULT_RATER_NAME = "DR. RODRIGO M. RODRIGUEZ JR., CESO VI"
RATER_POSITION = "Assistant Schools Division Superintendent"
DEFAULT_AUTHORITY_NAME = "LERMA L. FLANDEZ, CESO VI"
AUTHORITY_POSITION = "Schools Division Superintendent"


def _apply_header_defaults(header):
    """Fills blank ratee / rater names and the ratee position with their
    defaults and forces the rater's fixed position. Returns True when anything
    changed."""
    changed = False
    wanted = {"position_of_rater": RATER_POSITION}
    for column, default in (
        ("name_of_employee", RATEE_NAME),
        ("position_of_employee", RATEE_POSITION),
        ("name_of_rater", DEFAULT_RATER_NAME),
    ):
        if not (getattr(header, column) or "").strip():
            wanted[column] = default
    for column, value in wanted.items():
        if getattr(header, column) != value:
            setattr(header, column, value)
            changed = True
    return changed


def _apply_authority_defaults(authority):
    changed = False
    if not (authority.name or "").strip():
        authority.name = DEFAULT_AUTHORITY_NAME
        changed = True
    if authority.position != AUTHORITY_POSITION:
        authority.position = AUTHORITY_POSITION
        changed = True
    return changed


def _get_irc8a_approving_authority():
    """Single global row holding IRC8A's 'Approving Authority' name (see
    IRC8AApprovingAuthority in models.py). Created lazily with a blank name
    on first access, same convention as _get_preparer() above."""
    authority = IRC8AApprovingAuthority.query.first()
    if authority is None:
        authority = IRC8AApprovingAuthority(name="")
        db.session.add(authority)
        db.session.commit()
    if _apply_authority_defaults(authority):
        db.session.commit()
    return authority


def _get_irc8a_report_header():
    """Single global row holding IRC8A's printed-report header fields (see
    IRC8AReportHeader in models.py). Created lazily with blank fields on
    first access, same convention as _get_preparer() /
    _get_irc8a_approving_authority() above."""
    header = IRC8AReportHeader.query.first()
    if header is None:
        header = IRC8AReportHeader()
        db.session.add(header)
        db.session.commit()
    if _apply_header_defaults(header):
        db.session.commit()
    return header


def _ensure_seeded_kras(year):
    """Makes sure the fixed Part I-A / Part I-C structure exists for this
    year before it's read or written. See seed_irc8a_defaults() in
    models.py -- idempotent, so calling this on every request is cheap
    (one indexed lookup) once a year's KRAs already exist."""
    seed_irc8a_defaults(year)


SIGNATORY_ROLES = {"prepared_by", "checked_by", "approving_authority"}


def _get_signatory_date(tab_id, role):
    """Single row per (tab_id, role) holding the calendar-picked date shown
    under that signatory's position in the report-signatory footer (see
    ReportSignatoryDate in models.py). Created lazily with a blank date on
    first access, same convention as _get_preparer() /
    _get_irc8a_approving_authority() above."""
    row = ReportSignatoryDate.query.filter_by(tab_id=tab_id, role=role).first()
    if row is None:
        row = ReportSignatoryDate(tab_id=tab_id, role=role, date=None)
        db.session.add(row)
        db.session.commit()
    return row


def _upsert_irc1a_ratings(year, month_key, ratings_by_indicator, uploaded_file):
    """ratings_by_indicator: { indicator_id (int): rating (float) }"""
    for indicator_id, rating in ratings_by_indicator.items():
        row = IRC1ARating.query.filter_by(
            year=year, month_key=month_key, indicator_id=indicator_id
        ).first()
        if row is None:
            row = IRC1ARating(year=year, month_key=month_key, indicator_id=indicator_id)
            db.session.add(row)
        row.rating = rating
        row.uploaded_file_id = uploaded_file.id if uploaded_file else row.uploaded_file_id
    db.session.commit()


def _upsert_irc1b_customer_count(year, month_key, customer_count, uploaded_file):
    row = IRC1BCustomerCount.query.filter_by(year=year, month_key=month_key).first()
    if row is None:
        row = IRC1BCustomerCount(year=year, month_key=month_key)
        db.session.add(row)
    row.customer_count = customer_count
    row.uploaded_file_id = uploaded_file.id if uploaded_file else row.uploaded_file_id
    db.session.commit()


def _upsert_irc2a_status(year, school_name, status, month_key, uploaded_file):
    """Marks a school (matched by exact name) as provided/unprovided for
    `year`. Returns 'ok', 'not-found', or 'ambiguous' so the caller can
    report per-school import results, mirroring the frontend's existing
    not-found / already-provided / will-mark preview states."""
    school = School.query.filter_by(name=school_name).first()
    if school is None:
        return "not-found"

    row = IRC2ASchoolStatus.query.filter_by(school_id=school.id, year=year).first()
    if row is None:
        row = IRC2ASchoolStatus(school_id=school.id, year=year)
        db.session.add(row)
    row.status = status
    if status == TA_STATUS_PROVIDED:
        row.provided_month_key = month_key
    row.uploaded_file_id = uploaded_file.id if uploaded_file else row.uploaded_file_id
    db.session.commit()
    return "ok"


def _upsert_irc2b_frequency(year, school_id, month_key, provided, uploaded_file=None):
    row = IRC2BTAFrequency.query.filter_by(
        school_id=school_id, year=year, month_key=month_key
    ).first()
    if row is None:
        row = IRC2BTAFrequency(school_id=school_id, year=year, month_key=month_key)
        db.session.add(row)
    row.provided = provided
    row.uploaded_file_id = uploaded_file.id if uploaded_file else row.uploaded_file_id
    db.session.commit()


def _upsert_irc2b_from_names(year, month_key, school_names, uploaded_file=None):
    """Marks each named school as TA-provided for this year/month in the
    IRC2b monthly grid. Meant to be called with the same list of names a
    PDF upload already wrote into IRC2a (see import_home_sections /
    import_irc2a_schools) -- so one upload feeds both report cards
    instead of just IRC2a. Names that don't match a School row are
    skipped silently; the caller has already reported those as
    'not_found' against IRC2a itself.
    """
    if month_key not in MONTH_KEYS:
        return
    for name in school_names:
        school = School.query.filter_by(name=name).first()
        if school is None:
            continue
        _upsert_irc2b_frequency(year, school.id, month_key, True, uploaded_file)


def _compute_irc3_ta_counts(year):
    """Counts, for a given year, how many DEDP-priority and how many
    Non-DEDP schools currently have status 'provided' in IRC2a. This is
    IRC3's live source of truth for the 'Provided with TA' column --
    it's no longer typed in manually (see get_irc3_data / save_irc3_status)."""
    rows = (
        db.session.query(IRC2ASchoolStatus, School)
        .join(School, IRC2ASchoolStatus.school_id == School.id)
        .filter(IRC2ASchoolStatus.year == year, IRC2ASchoolStatus.status == TA_STATUS_PROVIDED)
        .all()
    )
    dedp_count = sum(1 for _, school in rows if school.is_dedp_priority)
    nondedp_count = sum(1 for _, school in rows if not school.is_dedp_priority)
    return dedp_count, nondedp_count


def _upsert_irc3_status(year, dedp_ta_count, dedp_target, nondedp_ta_count, nondedp_target):
    row = IRC3Status.query.filter_by(year=year).first()
    if row is None:
        row = IRC3Status(year=year)
        db.session.add(row)
    row.dedp_ta_count = dedp_ta_count
    row.dedp_target = dedp_target
    row.nondedp_ta_count = nondedp_ta_count
    row.nondedp_target = nondedp_target
    db.session.commit()
    return row


@app.route("/")
def home():
    """Landing page shown when the app first opens. Also builds the
    fixed 12-row month grid (current year only, for now -- see
    storage.MONTH_KEYS/MONTH_FOLDER_NAMES) for the centralized upload
    section's file manager: one file per month, or an empty slot."""
    year = _current_year()

    # Ordered ascending so that if more than one file ever ends up
    # sharing a month/year (stale data from before the replace-on-
    # reupload behavior existed), the most recently uploaded one wins
    # the dict comprehension below.
    files_this_year = (
        UploadedFile.query
        .filter_by(year=year)
        .order_by(UploadedFile.uploaded_at.asc())
        .all()
    )
    files_by_month = {f.month_key: f for f in files_this_year if f.month_key}

    month_grid = [
        {
            "month_key": month_key,
            "month_label": storage.MONTH_FOLDER_NAMES[month_key],
            "file": files_by_month.get(month_key),
        }
        for month_key in MONTH_KEYS
    ]

    return render_template(
        "home.html",
        tabs=TABS,
        groups=GROUPS,
        active_tab=None,
        month_grid=month_grid,
        current_year=year,
        preparer=_get_preparer(),
    )


@app.route("/api/preparer", methods=["GET"])
def get_preparer():
    """Read-only fetch used by base.html's report-signatory footer on every
    IRC1a-IRC8d page to fill in the current 'Prepared by' name/position."""
    preparer = _get_preparer()
    return jsonify({"name": preparer.name, "position": preparer.position}), 200


@app.route("/api/preparer", methods=["POST"])
def save_preparer():
    """Saves the 'Prepared by' name/position typed on the Home page. Single
    global row -- intentionally not year-scoped and never touched by any
    tab's Reset (see ReportPreparer in models.py)."""
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    position = (data.get("position") or "").strip()

    preparer = _get_preparer()
    preparer.name = name
    preparer.position = position
    db.session.commit()

    return jsonify({"name": preparer.name, "position": preparer.position}), 200


# "Checked by" name shown in the report-signatory footer of IRC1a-IRC7. One
# global value shared by every page, kept in a small JSON file next to the
# database (no schema change needed). Blank by default.
def _checked_by_path():
    return os.path.join(INSTANCE_DIR, "checked_by.json")


def _read_checked_by():
    try:
        with open(_checked_by_path(), "r", encoding="utf-8") as f:
            return (json.load(f).get("name") or "").strip()
    except (OSError, ValueError, AttributeError):
        return ""


@app.route("/api/checked-by", methods=["GET"])
def get_checked_by():
    return jsonify({"name": _read_checked_by()}), 200


@app.route("/api/checked-by", methods=["POST"])
def save_checked_by():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip().upper()
    tmp = _checked_by_path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"name": name}, f)
    os.replace(tmp, _checked_by_path())
    return jsonify({"name": name}), 200


@app.route("/api/irc8a/approving-authority", methods=["GET"])
def get_irc8a_approving_authority():
    """Read-only fetch used by base.html's report-signatory footer, on the
    IRC8A page only, to fill in the current 'Approving Authority' name."""
    authority = _get_irc8a_approving_authority()
    return jsonify({"name": authority.name, "position": authority.position or ""}), 200


@app.route("/api/irc8a/approving-authority", methods=["POST"])
def save_irc8a_approving_authority():
    """Saves the 'Approving Authority' name typed directly in IRC8A's
    report-signatory footer. Single global row -- not year-scoped and
    intentionally untouched by IRC8A's Reset."""
    data = request.get_json(silent=True) or {}

    authority = _get_irc8a_approving_authority()
    # Partial body: only the fields sent are changed, so saving the name
    # never blanks the position (and vice versa).
    # Position is fixed (AUTHORITY_POSITION); a blank name restores the default.
    if "name" in data:
        authority.name = (data.get("name") or "").strip().upper()
    _apply_authority_defaults(authority)
    db.session.commit()

    return jsonify({"name": authority.name, "position": authority.position or ""}), 200


@app.route("/api/irc8a/report-header", methods=["GET"])
def get_irc8a_report_header():
    """Read-only fetch used by irc8a.js to fill in the printed-report
    header fields (Name of Rater/Employee, their Positions, Bureau/Center/
    Service/Division, Rating Period, Date of Review) shown at the top of
    the IRC8A page and reproduced in its Save-to-PDF output."""
    header = _get_irc8a_report_header()
    return jsonify(header.to_dict()), 200


@app.route("/api/irc8a/report-header", methods=["POST"])
def save_irc8a_report_header():
    """Saves IRC8A's printed-report header fields, typed directly on the
    IRC8A page. Single global row -- not year-scoped and intentionally
    untouched by IRC8A's Reset. Accepts a partial body -- any field
    omitted is left as-is rather than cleared, so each input can save
    independently on blur without clobbering the others."""
    data = request.get_json(silent=True) or {}
    header = _get_irc8a_report_header()

    text_fields = {
        # The rater's position is fixed (see _apply_header_defaults()), so it
        # is not accepted here.
        "nameOfRater": "name_of_rater",
        "nameOfEmployee": "name_of_employee",
        "positionOfEmployee": "position_of_employee",
        "bureau": "bureau",
        "ratingPeriod": "rating_period",
        "statementOfPurpose": "statement_of_purpose",
    }
    # Names are always stored in capitals (matches the printed form).
    uppercase_keys = {"nameOfEmployee", "nameOfRater"}
    for json_key, column in text_fields.items():
        if json_key in data:
            value = (data.get(json_key) or "").strip()
            if json_key in uppercase_keys:
                value = value.upper()
            setattr(header, column, value)

    if "dateOfReview" in data:
        date_str = (data.get("dateOfReview") or "").strip()
        if date_str:
            try:
                header.date_of_review = datetime.strptime(date_str, "%Y-%m-%d").date()
            except ValueError:
                return jsonify({"error": "Invalid date format, expected YYYY-MM-DD"}), 400
        else:
            header.date_of_review = None

    _apply_header_defaults(header)  # blank names / ratee position -> defaults
    db.session.commit()
    return jsonify(header.to_dict()), 200


@app.route("/api/signatory-date/<tab_id>/<role>", methods=["GET"])
def get_signatory_date(tab_id, role):
    """Read-only fetch used by base.html's report-signatory footer, on
    every IRC1a-IRC8d page, to fill in the calendar-picked date under
    whichever signatory block(s) it renders (Prepared by / Checked by,
    plus Approving Authority on irc8a only)."""
    if tab_id not in TAB_LOOKUP or role not in SIGNATORY_ROLES:
        return jsonify({"error": "Invalid tab or role"}), 400
    row = _get_signatory_date(tab_id, role)
    return jsonify({"date": row.date.isoformat() if row.date else None}), 200


@app.route("/api/signatory-date/<tab_id>/<role>", methods=["POST"])
def save_signatory_date(tab_id, role):
    """Saves the date picked from the pop-up calendar under a signatory's
    position. Scoped to this exact (tab, role) pair -- see
    ReportSignatoryDate in models.py for why irc1a's 'Prepared by' date is
    independent of irc1b's, IRC8a's 'Checked by' date, etc. Expects
    {"date": "YYYY-MM-DD"}, or {"date": null}/"" to clear it."""
    if tab_id not in TAB_LOOKUP or role not in SIGNATORY_ROLES:
        return jsonify({"error": "Invalid tab or role"}), 400

    data = request.get_json(silent=True) or {}
    date_str = (data.get("date") or "").strip()

    row = _get_signatory_date(tab_id, role)
    if date_str:
        try:
            row.date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            return jsonify({"error": "Invalid date format, expected YYYY-MM-DD"}), 400
    else:
        row.date = None
    db.session.commit()

    return jsonify({"date": row.date.isoformat() if row.date else None}), 200


@app.route("/irc/<tab_id>")
def view_tab(tab_id):
    """Renders the dedicated template for whichever tab was requested.
    Templates are static markup with no server-side value binding -- each
    tab's own JS is responsible for fetching /irc/<tab_id>/data on load and
    populating the page client-side (see irc1a.js, irc1b.js, irc2a.js,
    irc2b.js)."""
    active_tab = TAB_LOOKUP.get(tab_id)
    if active_tab is None:
        abort(404)
    return render_template(TEMPLATE_MAP[tab_id], tabs=TABS, active_tab=active_tab)


# ---------------------------------------------------------------------------
# Per-tab "give me what's already saved" endpoints. Every tab's JS calls its
# matching one of these on page load so a reload shows previously-saved data
# instead of a blank page (the templates themselves have no server-side
# value binding -- see view_tab above).
# ---------------------------------------------------------------------------
@app.route("/irc/irc1a/data", methods=["GET"])
def get_irc1a_data():
    year = request.args.get("year", type=int) or _current_year()
    rows = IRC1ARating.query.filter_by(year=year).all()
    ratings = {}
    for row in rows:
        ratings.setdefault(str(row.indicator_id), {})[row.month_key] = row.rating

    # "Positive Aspects" / "Opportunities for Improvement" entries -- see
    # IRC1ARemark in models.py. Grouped by category so irc1a.js can drop
    # each list straight into its own card without filtering client-side.
    remark_rows = (
        IRC1ARemark.query.filter_by(year=year)
        .order_by(IRC1ARemark.sort_order.asc(), IRC1ARemark.id.asc())
        .all()
    )
    remarks = {category: [] for category in IRC1A_REMARK_CATEGORIES}
    for remark in remark_rows:
        remarks.setdefault(remark.category, []).append(remark.to_dict())

    return jsonify({"year": year, "ratings": ratings, "remarks": remarks}), 200


@app.route("/irc/irc1a/remark", methods=["POST"])
def save_irc1a_remark():
    """Creates a new entry under "Positive Aspects" or "Opportunities for
    Improvement" (id omitted), or updates an existing one's text (id
    included). Same create-vs-update convention as /irc/irc4/objective.

    Expected JSON body:
        { "id": 7, "text": "..." }                                // update
        { "category": "positive", "text": "...", "year": 2026 }   // create
    """
    data = request.get_json(silent=True) or {}
    remark_id = data.get("id")
    year = data.get("year") or _current_year()

    if remark_id:
        remark = IRC1ARemark.query.get(remark_id)
        if remark is None:
            return jsonify({"error": "Remark not found"}), 404
        remark.text = data.get("text", remark.text)
    else:
        category = data.get("category")
        if category not in IRC1A_REMARK_CATEGORIES:
            return jsonify({"error": f"Invalid category: {category!r}"}), 400
        max_order = (
            db.session.query(db.func.max(IRC1ARemark.sort_order))
            .filter_by(year=year, category=category)
            .scalar()
            or 0
        )
        remark = IRC1ARemark(
            year=year,
            category=category,
            text=data.get("text", ""),
            sort_order=max_order + 1,
        )
        db.session.add(remark)

    db.session.commit()
    return jsonify(remark.to_dict()), 200


@app.route("/irc/irc1a/remark/<int:remark_id>", methods=["DELETE"])
def delete_irc1a_remark(remark_id):
    remark = IRC1ARemark.query.get(remark_id)
    if remark is None:
        return jsonify({"error": "Remark not found"}), 404
    db.session.delete(remark)
    db.session.commit()
    return jsonify({"deleted": True, "id": remark_id}), 200


@app.route("/irc/irc1b/data", methods=["GET"])
def get_irc1b_data():
    year = request.args.get("year", type=int) or _current_year()
    rows = IRC1BCustomerCount.query.filter_by(year=year).all()
    counts = {row.month_key: row.customer_count for row in rows}
    return jsonify({"year": year, "counts": counts}), 200


@app.route("/irc/schools", methods=["GET"])
def get_schools():
    """Master school list (id, name, level, is_dedp_priority), sourced
    from the shared `School` table -- the same one IRC2a/IRC2b already
    read from. irc4.js fetches this once on init instead of hardcoding
    its own SCHOOLS/DEDP_PRIORITY roster, so it can never drift out of
    sync with the rest of the app."""
    rows = School.query.order_by(School.name.asc()).all()
    return jsonify({"schools": [s.to_dict() for s in rows]}), 200


@app.route("/irc/irc2a/data", methods=["GET"])
def get_irc2a_data():
    year = request.args.get("year", type=int) or _current_year()
    rows = (
        db.session.query(IRC2ASchoolStatus, School)
        .join(School, IRC2ASchoolStatus.school_id == School.id)
        .filter(IRC2ASchoolStatus.year == year)
        .all()
    )
    statuses = {school.name: status.status for status, school in rows}
    return jsonify({"year": year, "statuses": statuses}), 200


@app.route("/irc/irc2a/status", methods=["POST"])
def set_irc2a_status():
    """Persists a single manual status toggle (dragging/clicking a school
    between the Provided / Not Yet Provided columns) -- as opposed to
    /irc/irc2a/import, which is for the PDF-review-then-confirm flow and
    only ever marks schools 'provided'. No PDF is involved here, so the
    resulting row keeps uploaded_file_id = NULL.

    Expected JSON body:
        { "school_name": "Antipolo NHS", "status": "provided", "year": 2026 }
    """
    data = request.get_json(silent=True) or {}
    name = data.get("school_name")
    status = data.get("status")
    year = data.get("year") or _current_year()

    if status not in (TA_STATUS_PROVIDED, TA_STATUS_UNPROVIDED):
        return jsonify({"error": f"Invalid status: {status!r}"}), 400

    outcome = _upsert_irc2a_status(year, name, status, None, None)
    if outcome == "not-found":
        return jsonify({"error": f"Unknown school: {name!r}"}), 404

    return jsonify({"school_name": name, "status": status, "year": year}), 200


@app.route("/irc/irc2b/data", methods=["GET"])
def get_irc2b_data():
    year = request.args.get("year", type=int) or _current_year()
    rows = (
        db.session.query(IRC2BTAFrequency, School)
        .join(School, IRC2BTAFrequency.school_id == School.id)
        .filter(IRC2BTAFrequency.year == year)
        .all()
    )
    frequencies = {}
    for freq, school in rows:
        frequencies.setdefault(school.name, {})[freq.month_key] = freq.provided
    return jsonify({"year": year, "frequencies": frequencies}), 200


@app.route("/irc/irc3/data", methods=["GET"])
def get_irc3_data():
    """'Provided with TA' counts are computed live from IRC2a's school
    status (see _compute_irc3_ta_counts) -- they're no longer stored
    directly. Targets still come from IRC3Status, since those are the
    one thing on this page that's still genuinely manual entry."""
    year = request.args.get("year", type=int) or _current_year()
    row = IRC3Status.query.filter_by(year=year).first()
    dedp_ta_count, nondedp_ta_count = _compute_irc3_ta_counts(year)

    return jsonify({
        "year": year,
        "dedp_ta_count": dedp_ta_count,
        "nondedp_ta_count": nondedp_ta_count,
        "dedp_target": row.dedp_target if row else 0,
        "nondedp_target": row.nondedp_target if row else 0,
    }), 200


# ---------------------------------------------------------------------------
# Centralized file manager: list every uploaded PDF (optionally filtered
# by IRC/year/month) and delete one (cascading to its extracted DB rows).
# ---------------------------------------------------------------------------
@app.route("/files", methods=["GET"])
def list_files():
    """Returns every uploaded file, most recent first. Supports optional
    ?irc_type=irc1a&year=2026&month=jan filters for a file-manager UI."""
    query = UploadedFile.query

    irc_type = request.args.get("irc_type")
    year = request.args.get("year", type=int)
    month_key = request.args.get("month")

    if irc_type:
        query = query.filter_by(irc_type=irc_type)
    if year:
        query = query.filter_by(year=year)
    if month_key:
        query = query.filter_by(month_key=month_key)

    files = query.order_by(UploadedFile.year.desc(), UploadedFile.uploaded_at.desc()).all()
    return jsonify({"files": [f.to_dict() for f in files]}), 200


@app.route("/files/<int:file_id>", methods=["DELETE"])
def delete_file(file_id):
    """Deletes an uploaded PDF from disk AND every DB record extracted
    from it (ratings, customer counts, school statuses, ...), via
    storage.delete_uploaded_file's cascade."""
    uploaded_file = UploadedFile.query.get(file_id)
    if uploaded_file is None:
        return jsonify({"error": "File not found"}), 404

    storage.delete_uploaded_file(uploaded_file, app.config["UPLOAD_ROOT"])
    return jsonify({"deleted": True, "id": file_id}), 200


@app.route("/files/reset", methods=["DELETE"])
def reset_all_files():
    """Wipes every uploaded PDF for a given year (defaults to the current
    year -- the same year the home page's Monthly Files grid is scoped
    to), one at a time through storage.delete_uploaded_file so each file
    gets the same on-disk cleanup and cascading DB delete (ratings,
    customer counts, school statuses, ...) as a single-row delete via
    DELETE /files/<id>. Used by the home page's "Reset" button to clear
    every month in one action instead of deleting rows one by one.
    """
    year = request.args.get("year", type=int) or _current_year()
    files = UploadedFile.query.filter_by(year=year).all()
    for uploaded_file in files:
        storage.delete_uploaded_file(uploaded_file, app.config["UPLOAD_ROOT"])
    return jsonify({"reset": True, "year": year, "deleted": len(files)}), 200


@app.route("/irc/home/extract", methods=["POST"])
def extract_home_pdf():
    """Combined home-page upload: runs every applicable section
    extractor (IRC1a ratings, IRC1b customer count, IRC2a school list)
    against a single PDF, instead of requiring one upload per report
    type. A section that isn't found is simply omitted from the
    response -- the whole upload only fails if the month header itself
    can't be located, or if none of the sections matched anything.

    As with the per-type extract routes, the file is saved and its
    UploadedFile row registered immediately (irc_type left NULL, since
    it may end up feeding more than one table -- see
    UploadedFile.linked_irc_types()); nothing is written to the IRC
    tables themselves until /irc/home/import confirms it.

    If this year/month already has a file on record, its info is
    returned as `existing_file` so the frontend can warn the user that
    confirming the import will replace it (the actual replacement --
    deleting the old file -- happens at /irc/home/import time, only
    once the new one's data has been safely written).
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename.endswith(".pdf"):
        return jsonify({"error": "Only PDF files are supported"}), 400

    try:
        with pdfplumber.open(file) as pdf:
            full_text = ""
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    full_text += page_text + "\n"

        month_name, month_key = _extract_month(full_text)

        if not month_name:
            return jsonify({"error": "Could not find month in PDF header"}), 400
        if not month_key:
            return jsonify({"error": f"Unknown month: {month_name}"}), 400

        sections = {}

        irc1a_ratings = _parse_irc1a_indicators(full_text)
        if irc1a_ratings:
            sections["irc1a"] = {
                str(indicator_id): {month_key: rating}
                for indicator_id, rating in irc1a_ratings.items()
            }

        irc1b_customers = _parse_irc1b_customers(full_text)
        if irc1b_customers is not None:
            sections["irc1b"] = {"customers": irc1b_customers}

        irc2a_schools = _parse_irc2a_schools(full_text)
        if irc2a_schools:
            sections["irc2a"] = {"schools": irc2a_schools}

        if not sections:
            return jsonify({
                "error": "Found the report header but couldn't match any known "
                         "section (TA ratings, customer count, or school list) "
                         "in this PDF."
            }), 400

        year = _current_year()

        existing = (
            UploadedFile.query
            .filter_by(year=year, month_key=month_key)
            .order_by(UploadedFile.uploaded_at.desc())
            .first()
        )
        existing_info = (
            {"id": existing.id, "filename": existing.original_filename}
            if existing else None
        )

        file_fields = storage.save_uploaded_pdf(
            file, app.config["UPLOAD_ROOT"], irc_type="monthly", year=year, month_key=month_key
        )
        file_fields["irc_type"] = None  # combined upload -- see UploadedFile docstring
        uploaded_file = UploadedFile(**file_fields)
        db.session.add(uploaded_file)
        db.session.commit()

        return jsonify({
            "month": month_name,
            "month_key": month_key,
            "year": year,
            "file_id": uploaded_file.id,
            "sections": sections,
            "existing_file": existing_info,
        }), 200

    except Exception as e:
        return jsonify({"error": f"Error processing PDF: {str(e)}"}), 500


@app.route("/irc/home/import", methods=["POST"])
def import_home_sections():
    """Commits the user-confirmed (and possibly edited) subset of a
    combined home-page upload.

    Expected JSON body:
        {
          "file_id": 42,        // from /irc/home/extract's response
          "year": 2026,         // optional, defaults to current year
          "month_key": "jul",
          "sections": {
            "irc1a": {"1": 4.0, "2": 3.5, ...},      // optional
            "irc1b": {"customers": 1234},             // optional
            "irc2a": {"schools": ["School A", ...]}   // optional
          }
        }

    Only the sections present in `sections` are written -- a section the
    user removed/cleared in the review modal simply isn't included and
    is left untouched, same spirit as the per-type /import routes.

    Once the new file's data is safely written, this is also where a
    month's file actually gets replaced: any *other* UploadedFile rows
    for this exact year/month are deleted (cascading to their own
    extracted records), so a month never ends up with more than one
    file behind it.
    """
    data = request.get_json(silent=True) or {}
    file_id = data.get("file_id")
    month_key = data.get("month_key")
    year = data.get("year") or _current_year()
    sections = data.get("sections")

    if month_key not in MONTH_KEYS:
        return jsonify({"error": f"Invalid month_key: {month_key!r}"}), 400
    if not isinstance(sections, dict) or not sections:
        return jsonify({"error": "'sections' must include at least one section to import"}), 400

    uploaded_file = UploadedFile.query.get(file_id) if file_id else None
    results = {}

    if "irc1a" in sections and isinstance(sections["irc1a"], dict):
        ratings_by_indicator = {}
        for key, value in sections["irc1a"].items():
            try:
                indicator_id = int(key)
                rating = float(value)
            except (TypeError, ValueError):
                continue
            if not (1 <= indicator_id <= 10):
                continue
            if not (1 <= rating <= 5):
                continue
            ratings_by_indicator[indicator_id] = rating
        if ratings_by_indicator:
            _upsert_irc1a_ratings(year, month_key, ratings_by_indicator, uploaded_file)
            results["irc1a"] = {"updated": sorted(ratings_by_indicator.keys())}

    if "irc1b" in sections and isinstance(sections["irc1b"], dict):
        try:
            customers = int(sections["irc1b"].get("customers"))
        except (TypeError, ValueError):
            customers = None
        if customers is not None and customers >= 0:
            _upsert_irc1b_customer_count(year, month_key, customers, uploaded_file)
            results["irc1b"] = {"customers": customers}

    if "irc2a" in sections and isinstance(sections["irc2a"], dict):
        school_names = sections["irc2a"].get("schools")
        if isinstance(school_names, list) and school_names:
            updated, not_found = [], []
            for name in school_names:
                outcome = _upsert_irc2a_status(year, name, TA_STATUS_PROVIDED, month_key, uploaded_file)
                (updated if outcome == "ok" else not_found).append(name)
            results["irc2a"] = {"updated": updated, "not_found": not_found}

            # Same school list also checks the corresponding month's box
            # in IRC2b's monthly TA-frequency grid, not just IRC2a's
            # current status -- one upload now feeds both report cards.
            if updated:
                _upsert_irc2b_from_names(year, month_key, updated, uploaded_file)
                results["irc2b"] = {"updated": updated}

    if not results:
        return jsonify({"error": "No valid section data to import"}), 400

    # Replace-on-reupload: now that the new file's sections are safely
    # written, remove any other file(s) previously on record for this
    # exact year/month, cascading to whatever they had extracted.
    if uploaded_file is not None:
        stale_files = UploadedFile.query.filter(
            UploadedFile.year == year,
            UploadedFile.month_key == month_key,
            UploadedFile.id != uploaded_file.id,
        ).all()
        for stale in stale_files:
            storage.delete_uploaded_file(stale, app.config["UPLOAD_ROOT"])

    return jsonify({"year": year, "month_key": month_key, "results": results}), 200


@app.route("/irc/irc1a/extract", methods=["POST"])
def extract_irc1a_pdf():
    """Extract TA ratings from a monthly PDF.
    
    Expected PDF structure:
    - Header: "TECHNICAL ASSISTANCE FEEDBACK RESULTS\n(MONTH)"
    - Section listing 10 TA indicators with their ratings
    - Each indicator: "N) Indicator text. RATING" (may span multiple lines)
    
    Returns ratings for the single month specified in the header.
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    
    file = request.files["file"]
    if not file.filename.endswith(".pdf"):
        return jsonify({"error": "Only PDF files are supported"}), 400
    
    try:
        with pdfplumber.open(file) as pdf:
            # Extract all text from the PDF
            full_text = ""
            for page in pdf.pages:
                full_text += page.extract_text() + "\n"
        
        # Extract month from header
        month_name, month_key = _extract_month(full_text)

        if not month_name:
            return jsonify({"error": "Could not find month in PDF header"}), 400

        if not month_key:
            return jsonify({"error": f"Unknown month: {month_name}"}), 400
        
        # Extract indicators and ratings - handle multiline text
        indicators_data = _parse_irc1a_indicators(full_text)

        if len(indicators_data) < 10:
            return jsonify({
                "error": f"Could not extract all 10 indicators. Found {len(indicators_data)}. Please ensure the PDF has the correct format."
            }), 400
        
        # Build response with only the extracted month
        extracted_ratings = {}
        for indicator_id in range(1, 11):
            if indicator_id in indicators_data:
                extracted_ratings[str(indicator_id)] = {month_key: indicators_data[indicator_id]}

        # --- Persist: save the PDF to the month-based folder and register
        # its UploadedFile row now (so file_id is available for the preview
        # modal and a later delete still cleans up the file). We deliberately
        # do NOT write IRC1ARating rows here -- the frontend shows a preview
        # modal first and lets the user edit any rating before committing,
        # so the actual writes happen in /irc/irc1a/import once confirmed.
        # This mirrors IRC2a's extract/import split. ---
        year = _current_year()
        file_fields = storage.save_uploaded_pdf(
            file, app.config["UPLOAD_ROOT"], irc_type="irc1a", year=year, month_key=month_key
        )
        uploaded_file = UploadedFile(**file_fields)
        db.session.add(uploaded_file)
        db.session.commit()

        return jsonify({
            "month": month_name,
            "month_key": month_key,
            "extracted_ratings": extracted_ratings,
            "file_id": uploaded_file.id,
            "year": year,
        }), 200
    
    except Exception as e:
        return jsonify({"error": f"Error processing PDF: {str(e)}"}), 500


@app.route("/irc/irc1a/import", methods=["POST"])
def import_irc1a_ratings():
    """Commits the user-confirmed (and possibly edited) IRC1a ratings
    from the preview modal.

    Expected JSON body:
        {
          "file_id": 42,          // from /irc/irc1a/extract's response
          "year": 2026,           // optional, defaults to current year
          "month_key": "jul",
          "ratings": {"1": 4.0, "2": 3.5, ..., "10": 5.0}
        }

    Only indicators present in `ratings` are written -- if the user
    cleared a field in the preview modal before confirming, that
    indicator is simply left untouched rather than zeroed out.
    """
    data = request.get_json(silent=True) or {}
    file_id = data.get("file_id")
    month_key = data.get("month_key")
    ratings = data.get("ratings")
    year = data.get("year") or _current_year()

    if month_key not in MONTH_KEYS:
        return jsonify({"error": f"Invalid month_key: {month_key!r}"}), 400
    if not isinstance(ratings, dict) or not ratings:
        return jsonify({"error": "'ratings' must be a non-empty object of indicator_id -> rating"}), 400

    ratings_by_indicator = {}
    for key, value in ratings.items():
        try:
            indicator_id = int(key)
            rating = float(value)
        except (TypeError, ValueError):
            return jsonify({"error": f"Invalid rating for indicator {key!r}"}), 400
        if not (1 <= indicator_id <= 10):
            continue
        if not (1 <= rating <= 5):
            return jsonify({"error": f"Rating for indicator {indicator_id} must be between 1 and 5"}), 400
        ratings_by_indicator[indicator_id] = rating

    if not ratings_by_indicator:
        return jsonify({"error": "No valid ratings to import"}), 400

    uploaded_file = UploadedFile.query.get(file_id) if file_id else None
    _upsert_irc1a_ratings(year, month_key, ratings_by_indicator, uploaded_file)

    return jsonify({
        "updated": sorted(ratings_by_indicator.keys()),
        "year": year,
        "month_key": month_key,
    }), 200


@app.route("/irc/irc1a/rating/<month_key>/<int:indicator_id>", methods=["DELETE"])
def delete_irc1a_rating(month_key, indicator_id):
    """Deletes a single manually-cleared IRC1a rating cell (year/month/
    indicator). This is the counterpart to /irc/irc1a/import's upsert --
    without it, clearing a cell in the table had nowhere to send that
    change, so the old value silently came back on the next page load.

    Only the rating row itself is removed. If it happened to be populated
    by a PDF import, that PDF and its UploadedFile row are left untouched
    -- deleting the PDF from the home page's month grid (delete_file) is
    still the only way to remove that. This lets the user clear/edit a
    cell without being forced to also remove the source PDF, and vice
    versa.

    Idempotent: returns 200 whether or not a row existed, since "delete"
    here really means "make sure this cell has no saved value."
    """
    year = request.args.get("year", type=int) or _current_year()

    if month_key not in MONTH_KEYS:
        return jsonify({"error": f"Invalid month_key: {month_key!r}"}), 400
    if not (1 <= indicator_id <= 10):
        return jsonify({"error": f"Invalid indicator_id: {indicator_id!r}"}), 400

    row = IRC1ARating.query.filter_by(
        year=year, month_key=month_key, indicator_id=indicator_id
    ).first()
    if row is not None:
        db.session.delete(row)
        db.session.commit()

    return jsonify({
        "deleted": True,
        "year": year,
        "month_key": month_key,
        "indicator_id": indicator_id,
    }), 200


@app.route("/irc/irc1a/reset", methods=["DELETE"])
def reset_irc1a_ratings():
    """Wipes every IRC1a rating, plus every Positive Aspects/OFI entry
    (see IRC1ARemark), for a given year (defaults to current year) in one
    shot. This is the "Reset All Data" button's counterpart to
    delete_irc1a_rating above, which only ever clears a single cell.

    Uploaded PDF files themselves (and their UploadedFile rows) are left
    untouched -- this only clears the rating values and remark entries,
    same scoping as delete_irc1a_rating.
    """
    year = request.args.get("year", type=int) or _current_year()
    IRC1ARating.query.filter_by(year=year).delete()
    IRC1ARemark.query.filter_by(year=year).delete()
    db.session.commit()
    return jsonify({"reset": True, "year": year}), 200


@app.route("/irc/irc1b/extract", methods=["POST"])
def extract_irc1b_pdf():
    """Extract the number of customers served from a monthly PDF.

    Expected PDF structure:
    - Header: "TECHNICAL ASSISTANCE FEEDBACK RESULTS\n(MONTH)"
    - A line containing "No. of Customers: N" (N may include commas, e.g. "1,234")

    Returns the customer count for the single month specified in the header.
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename.endswith(".pdf"):
        return jsonify({"error": "Only PDF files are supported"}), 400

    try:
        with pdfplumber.open(file) as pdf:
            full_text = ""
            for page in pdf.pages:
                full_text += page.extract_text() + "\n"

        # Extract month from header (same pattern as irc1a)
        month_name, month_key = _extract_month(full_text)

        if not month_name:
            return jsonify({"error": "Could not find month in PDF header"}), 400

        if not month_key:
            return jsonify({"error": f"Unknown month: {month_name}"}), 400

        # Extract "No. of Customers: N" — allow commas in the number (e.g. "1,234")
        customers = _parse_irc1b_customers(full_text)

        if customers is None:
            return jsonify({
                "error": "Could not find 'No. of Customers:' in the PDF. Please ensure the PDF has the correct format."
            }), 400

        # --- Persist: save the PDF and register its UploadedFile row now.
        # As with IRC1a, the actual IRC1BCustomerCount write is deferred to
        # /irc/irc1b/import so the user can review/edit the count first. ---
        year = _current_year()
        file_fields = storage.save_uploaded_pdf(
            file, app.config["UPLOAD_ROOT"], irc_type="irc1b", year=year, month_key=month_key
        )
        uploaded_file = UploadedFile(**file_fields)
        db.session.add(uploaded_file)
        db.session.commit()

        return jsonify({
            "month": month_name,
            "month_key": month_key,
            "customers": customers,
            "file_id": uploaded_file.id,
            "year": year,
        }), 200

    except Exception as e:
        return jsonify({"error": f"Error processing PDF: {str(e)}"}), 500


@app.route("/irc/irc1b/import", methods=["POST"])
def import_irc1b_customer_count():
    """Commits the user-confirmed (and possibly edited) IRC1b customer
    count from the preview modal.

    Expected JSON body:
        {
          "file_id": 42,        // from /irc/irc1b/extract's response
          "year": 2026,         // optional, defaults to current year
          "month_key": "jul",
          "customers": 1234
        }
    """
    data = request.get_json(silent=True) or {}
    file_id = data.get("file_id")
    month_key = data.get("month_key")
    year = data.get("year") or _current_year()

    if month_key not in MONTH_KEYS:
        return jsonify({"error": f"Invalid month_key: {month_key!r}"}), 400

    try:
        customers = int(data.get("customers"))
    except (TypeError, ValueError):
        return jsonify({"error": "'customers' must be an integer"}), 400
    if customers < 0:
        return jsonify({"error": "'customers' cannot be negative"}), 400

    uploaded_file = UploadedFile.query.get(file_id) if file_id else None
    _upsert_irc1b_customer_count(year, month_key, customers, uploaded_file)

    return jsonify({
        "updated": True,
        "year": year,
        "month_key": month_key,
        "customers": customers,
    }), 200


@app.route("/irc/irc1b/count/<month_key>", methods=["DELETE"])
def delete_irc1b_count(month_key):
    """Deletes a single manually-cleared IRC1b customer count (year/
    month). Same rationale and same "PDF stays put" behavior as
    delete_irc1a_rating above -- see its docstring."""
    year = request.args.get("year", type=int) or _current_year()

    if month_key not in MONTH_KEYS:
        return jsonify({"error": f"Invalid month_key: {month_key!r}"}), 400

    row = IRC1BCustomerCount.query.filter_by(year=year, month_key=month_key).first()
    if row is not None:
        db.session.delete(row)
        db.session.commit()

    return jsonify({"deleted": True, "year": year, "month_key": month_key}), 200


@app.route("/irc/irc1b/reset", methods=["DELETE"])
def reset_irc1b_counts():
    """Wipes every IRC1b customer count for a given year (defaults to
    current year) in one shot. This is the "Reset All Data" button's
    counterpart to delete_irc1b_count above, which only ever clears a
    single cell -- same scoping as reset_irc1a_ratings.

    Uploaded PDF files themselves (and their UploadedFile rows) are left
    untouched -- this only clears the customer-count values.
    """
    year = request.args.get("year", type=int) or _current_year()
    IRC1BCustomerCount.query.filter_by(year=year).delete()
    db.session.commit()
    return jsonify({"reset": True, "year": year}), 200


@app.route("/irc/irc2a/extract", methods=["POST"])
def extract_irc2a_pdf():
    """Extract the "Schools Provided with TA" list from a monthly PDF.

    Expected PDF structure:
    - Header: "TECHNICAL ASSISTANCE FEEDBACK RESULTS\n(MONTH)"
    - A "Schools Provided with TA" section containing a numbered list of
      school names (1, 2, 3, ... in order). A school's name may wrap onto
      the following line(s) before the next number starts — this is handled,
      see _parse_numbered_school_list.

    Returns the month and the raw list of school names extracted from that
    section. Matching those names against the system's known school list,
    and actually marking schools as provided, is left to the frontend —
    it's the one source of truth for which schools exist and their current
    status.
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename.endswith(".pdf"):
        return jsonify({"error": "Only PDF files are supported"}), 400

    try:
        with pdfplumber.open(file) as pdf:
            full_text = ""
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    full_text += page_text + "\n"

        # Extract month from header (same pattern as irc1a/irc1b)
        month_name, month_key = _extract_month(full_text)

        if not month_name:
            return jsonify({"error": "Could not find month in PDF header"}), 400

        if not month_key:
            return jsonify({"error": f"Unknown month: {month_name}"}), 400

        # Isolate the "Schools Provided with TA" section, up to whatever
        # comes right after it in the PDF (the signature block, if present).
        section_match = re.search(
            r"Schools Provided with TA(.*?)(?:Prepared by:|$)",
            full_text,
            re.DOTALL | re.IGNORECASE,
        )
        if not section_match:
            return jsonify({
                "error": "Could not find a 'Schools Provided with TA' section in the PDF."
            }), 400

        schools = _parse_numbered_school_list(section_match.group(1))

        if not schools:
            return jsonify({
                "error": "Found the 'Schools Provided with TA' section but could not extract any school names from it."
            }), 400

        # --- Persist: save the PDF now so it's registered and file_id is
        # available for the preview modal. NOTE: we deliberately do NOT
        # write IRC2ASchoolStatus rows here -- the frontend shows a
        # preview modal first and lets the user uncheck schools before
        # committing, so the actual status writes happen in
        # /irc/irc2a/import once the user confirms. This mirrors the
        # existing not-found/already-provided/will-mark preview flow. ---
        year = _current_year()
        file_fields = storage.save_uploaded_pdf(
            file, app.config["UPLOAD_ROOT"], irc_type="irc2a", year=year, month_key=month_key
        )
        uploaded_file = UploadedFile(**file_fields)
        db.session.add(uploaded_file)
        db.session.commit()

        return jsonify({
            "month": month_name,
            "month_key": month_key,
            "schools": schools,
            "file_id": uploaded_file.id,
        }), 200

    except Exception as e:
        return jsonify({"error": f"Error processing PDF: {str(e)}"}), 500


@app.route("/irc/irc2a/import", methods=["POST"])
def import_irc2a_schools():
    """Commits the user-confirmed subset of an IRC2a preview import.

    Expected JSON body:
        {
          "file_id": 42,             // from /irc/irc2a/extract's response
          "year": 2026,              // optional, defaults to current year
          "schools": ["School A", "School B", ...]   // names to mark 'provided'
        }

    Only schools the user left checked in the preview modal should be
    included here -- this endpoint marks every listed school 'provided'
    for the given year and leaves everyone else's status untouched.
    """
    data = request.get_json(silent=True) or {}
    file_id = data.get("file_id")
    school_names = data.get("schools")
    year = data.get("year") or _current_year()

    if not isinstance(school_names, list) or not school_names:
        return jsonify({"error": "'schools' must be a non-empty list of school names"}), 400

    uploaded_file = UploadedFile.query.get(file_id) if file_id else None
    month_key = uploaded_file.month_key if uploaded_file else None

    results = {"updated": [], "not_found": []}
    for name in school_names:
        outcome = _upsert_irc2a_status(year, name, TA_STATUS_PROVIDED, month_key, uploaded_file)
        (results["updated"] if outcome == "ok" else results["not_found"]).append(name)

    # Same list also feeds IRC2b's monthly grid for this month, mirroring
    # the home-page combined upload's behavior (see import_home_sections).
    if results["updated"] and month_key:
        _upsert_irc2b_from_names(year, month_key, results["updated"], uploaded_file)

    return jsonify(results), 200


@app.route("/irc/irc2a/reset", methods=["DELETE"])
def reset_irc2a_statuses():
    """Wipes every IRC2a school status for a given year (defaults to
    current year) in one shot -- the "Reset All Data" button's
    counterpart to set_irc2a_status, which only ever toggles a single
    school. Every school reverts to "Not Yet Provided with TA" (the
    frontend's baseline for a school with no row at all -- see
    initState() in irc2a.js).

    Scoped to IRC2a only: uploaded PDF files and IRC2b's monthly TA
    grid are left untouched, same as IRC1a/IRC1b's own reset routes
    only ever clear their own table.
    """
    year = request.args.get("year", type=int) or _current_year()
    IRC2ASchoolStatus.query.filter_by(year=year).delete()
    db.session.commit()
    return jsonify({"reset": True, "year": year}), 200


@app.route("/irc/irc2b/save", methods=["POST"])
def save_irc2b_frequency():
    """Persists manual checkbox edits from the IRC2b monthly grid (no
    PDF involved, so these rows keep uploaded_file_id = NULL).

    Expected JSON body:
        {
          "year": 2026,
          "updates": [
            {"school_name": "Antipolo NHS", "month_key": "jul", "provided": true},
            ...
          ]
        }
    """
    data = request.get_json(silent=True) or {}
    year = data.get("year") or _current_year()
    updates = data.get("updates")

    if not isinstance(updates, list) or not updates:
        return jsonify({"error": "'updates' must be a non-empty list"}), 400

    results = {"updated": [], "not_found": []}
    for entry in updates:
        name = entry.get("school_name")
        month_key = entry.get("month_key")
        provided = bool(entry.get("provided"))

        if month_key not in MONTH_KEYS:
            return jsonify({"error": f"Invalid month_key: {month_key!r}"}), 400

        school = School.query.filter_by(name=name).first()
        if school is None:
            results["not_found"].append(name)
            continue

        _upsert_irc2b_frequency(year, school.id, month_key, provided)
        results["updated"].append(name)

    return jsonify(results), 200


@app.route("/irc/irc2b/reset", methods=["DELETE"])
def reset_irc2b_frequencies():
    """Wipes every IRC2b TA-frequency checkbox for a given year (defaults
    to current year) in one shot -- the "Reset All Data" button's
    counterpart to save_irc2b_frequency, which only ever toggles
    individual checkboxes. Every school/month reverts to unchecked (the
    frontend's baseline for a school/month with no row at all -- see
    loadPersistedFrequencies() in irc2b.js).

    Scoped to IRC2b only: uploaded PDF files and IRC2a's status board
    are left untouched, same as IRC1a/IRC1b/IRC2a's own reset routes
    only ever clear their own table.
    """
    year = request.args.get("year", type=int) or _current_year()
    IRC2BTAFrequency.query.filter_by(year=year).delete()
    db.session.commit()
    return jsonify({"reset": True, "year": year}), 200


@app.route("/irc/irc3/save", methods=["POST"])
def save_irc3_status():
    """Persists the manually-entered IRC3 *targets* for a year. The
    'Provided with TA' counts are no longer entered here -- they're
    computed live from IRC2a's school status (see get_irc3_data /
    _compute_irc3_ta_counts), since IRC2a already tracks that. This
    endpoint still snapshots the computed counts into IRC3Status
    alongside the targets, purely so a DB browse of that table shows a
    consistent picture -- the counts themselves are never read from
    there for display.

    Expected JSON body:
        { "year": 2026, "dedp_target": 26, "nondedp_target": 41 }
    """
    data = request.get_json(silent=True) or {}
    year = data.get("year") or _current_year()

    try:
        dedp_target = int(data.get("dedp_target", 0))
        nondedp_target = int(data.get("nondedp_target", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "Target fields must be integers"}), 400

    dedp_ta_count, nondedp_ta_count = _compute_irc3_ta_counts(year)
    row = _upsert_irc3_status(year, dedp_ta_count, dedp_target, nondedp_ta_count, nondedp_target)
    return jsonify({
        "year": row.year,
        "dedp_ta_count": row.dedp_ta_count,
        "dedp_target": row.dedp_target,
        "nondedp_ta_count": row.nondedp_ta_count,
        "nondedp_target": row.nondedp_target,
    }), 200


# ---------------------------------------------------------------------------
# IRC4 -- Technical Assistance (TA) Catch-up Plan
#
# No PDF pipeline here (see models.py) -- these routes just persist
# whatever irc4.js's fields/modal submit, same treatment as IRC5/IRC6.
# One plan per year; `_ensure_irc4_plan` also guarantees at least three
# blank objectives exist for a brand-new year, mirroring _ensure_irc6_seed
# (irc4.js's init() comment relies on this: "the server guarantees at
# least three blank objectives exist" instead of seeding them client-side).
# ---------------------------------------------------------------------------
IRC4_MIN_OBJECTIVES = 3

# Matches irc4.js's own MONTH_LABELS keys exactly (capitalized 3-letter
# codes) -- irc4.js is the source of truth for this format, not this
# app's usual lowercase MONTH_KEYS (see save_irc4_group's note below).
IRC4_SCHEDULE_MONTHS = (
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)

IRC4_PLAN_FIELD_MAP = {
    "activity": "activity",
    "taReceiver": "ta_receiver",
    "movs": "movs",
}


def _ensure_irc4_plan(year):
    plan = IRC4Plan.query.filter_by(year=year).first()
    if plan is None:
        plan = IRC4Plan(year=year)
        db.session.add(plan)
        db.session.flush()  # assigns plan.id before objectives reference it

    existing_count = IRC4Objective.query.filter_by(plan_id=plan.id).count()
    for i in range(existing_count, IRC4_MIN_OBJECTIVES):
        db.session.add(IRC4Objective(plan_id=plan.id, text="", sort_order=i))

    db.session.commit()
    return plan


@app.route("/irc/irc4/data", methods=["GET"])
def get_irc4_data():
    year = request.args.get("year", type=int) or _current_year()
    plan = _ensure_irc4_plan(year)
    return jsonify(plan.to_dict()), 200


@app.route("/irc/irc4/plan", methods=["POST"])
def save_irc4_plan():
    """Persists a single field of the plan (Activity, TA Receiver, or
    MOV's) -- irc4.js debounces and saves one field at a time, mirroring
    IRC2b's per-checkbox save.

    Expected JSON body (one of):
        { "activity": "..." }
        { "taReceiver": "..." }
        { "movs": "..." }
    """
    data = request.get_json(silent=True) or {}
    year = data.get("year") or _current_year()
    plan = _ensure_irc4_plan(year)

    for json_key, col_name in IRC4_PLAN_FIELD_MAP.items():
        if json_key in data:
            setattr(plan, col_name, data[json_key])

    db.session.commit()
    return jsonify(plan.to_dict()), 200


@app.route("/irc/irc4/objective", methods=["POST"])
def save_irc4_objective():
    """Creates a new objective (id omitted), or updates an existing one's
    text (id included).

    Expected JSON body:
        { "id": 7, "text": "..." }   // omit/null id to create
    """
    data = request.get_json(silent=True) or {}
    obj_id = data.get("id")
    year = data.get("year") or _current_year()

    if obj_id:
        obj = IRC4Objective.query.get(obj_id)
        if obj is None:
            return jsonify({"error": "Objective not found"}), 404
        obj.text = data.get("text", obj.text)
    else:
        plan = _ensure_irc4_plan(year)
        max_order = (
            db.session.query(db.func.max(IRC4Objective.sort_order))
            .filter_by(plan_id=plan.id)
            .scalar()
            or 0
        )
        obj = IRC4Objective(plan_id=plan.id, text=data.get("text", ""), sort_order=max_order + 1)
        db.session.add(obj)

    db.session.commit()
    return jsonify(obj.to_dict()), 200


@app.route("/irc/irc4/objective/<int:objective_id>", methods=["DELETE"])
def delete_irc4_objective(objective_id):
    obj = IRC4Objective.query.get(objective_id)
    if obj is None:
        return jsonify({"error": "Objective not found"}), 404
    db.session.delete(obj)
    db.session.commit()
    return jsonify({"deleted": True, "id": objective_id}), 200


@app.route("/irc/irc4/group", methods=["POST"])
def save_irc4_group():
    """Creates a new group (id omitted), or updates an existing one's
    schools + schedule (id included). The full `schools` list is always
    sent by irc4.js's modal (the whole draft, not a delta), so this
    replaces the group's school set wholesale rather than diffing it.

    Expected JSON body:
        {
          "id": 7,                      // omit/null to create a new group
          "schools": ["Antipolo NHS", ...],
          "schedule": "Jul"              // one of IRC4_SCHEDULE_MONTHS, or null
        }
    """
    data = request.get_json(silent=True) or {}
    group_id = data.get("id")
    year = data.get("year") or _current_year()

    # NOTE: irc4.js's own MONTH_LABELS keys ("Jan".."Dec", capitalized) are
    # the codes it actually sends and expects back -- NOT the lowercase
    # "jan".."dec" MONTH_KEYS the rest of this app uses for monthly grids.
    # Validating against the wrong casing here silently discarded every
    # schedule pick (always fell through to None), which is why groups
    # showed "No month selected" on the main page even after a month was
    # chosen in the modal. See IRC4_SCHEDULE_MONTHS below.
    schedule = data.get("schedule")
    if schedule not in IRC4_SCHEDULE_MONTHS:
        schedule = None

    school_names = data.get("schools") or []

    if group_id:
        group = IRC4Group.query.get(group_id)
        if group is None:
            return jsonify({"error": "Group not found"}), 404
    else:
        plan = _ensure_irc4_plan(year)
        max_order = (
            db.session.query(db.func.max(IRC4Group.sort_order))
            .filter_by(plan_id=plan.id)
            .scalar()
            or 0
        )
        group = IRC4Group(plan_id=plan.id, sort_order=max_order + 1)
        db.session.add(group)
        db.session.flush()  # assigns group.id before IRC4GroupSchool rows reference it

    group.schedule_month_key = schedule

    # Replace the school set wholesale. Unknown names (no matching School
    # row) are skipped silently, same convention as _upsert_irc2b_from_names.
    IRC4GroupSchool.query.filter_by(group_id=group.id).delete()
    seen_ids = set()
    for name in school_names:
        school = School.query.filter_by(name=name).first()
        if school is None or school.id in seen_ids:
            continue
        seen_ids.add(school.id)
        db.session.add(IRC4GroupSchool(group_id=group.id, school_id=school.id))

    db.session.commit()
    return jsonify(group.to_dict()), 200


@app.route("/irc/irc4/group/<int:group_id>", methods=["DELETE"])
def delete_irc4_group(group_id):
    group = IRC4Group.query.get(group_id)
    if group is None:
        return jsonify({"error": "Group not found"}), 404
    db.session.delete(group)
    db.session.commit()
    return jsonify({"deleted": True, "id": group_id}), 200


@app.route("/irc/irc4/school-ta-status", methods=["GET"])
def get_irc4_school_ta_status():
    """{ school_name: count } of IRC2b months marked 'provided' this
    year -- the source for irc4.js's TA-provided indicator box. Schools
    with a count of 0 are omitted entirely (per the modal's spec: no
    entry means 'not yet provided'). Resets every year, same as every
    other year-scoped table in this app -- a school's count here is
    IRC2b's `provided` rows for THIS year only, not a running total."""
    year = request.args.get("year", type=int) or _current_year()

    rows = (
        db.session.query(School.name, db.func.count(IRC2BTAFrequency.id))
        .join(IRC2BTAFrequency, IRC2BTAFrequency.school_id == School.id)
        .filter(IRC2BTAFrequency.year == year, IRC2BTAFrequency.provided.is_(True))
        .group_by(School.name)
        .all()
    )
    return jsonify({name: count for name, count in rows if count > 0}), 200


# ---------------------------------------------------------------------------
# IRC5 -- Post Program Evaluation Results
#
# No PDF pipeline here (see models.py) -- these routes just persist
# whatever the "Add Entry" modal in irc5.js submits.
# ---------------------------------------------------------------------------
@app.route("/irc/irc5/data", methods=["GET"])
def get_irc5_data():
    year = request.args.get("year", type=int) or _current_year()
    rows = IRC5Entry.query.filter_by(year=year).order_by(IRC5Entry.id.asc()).all()
    return jsonify({"year": year, "entries": [r.to_dict() for r in rows]}), 200


@app.route("/irc/irc5/entry", methods=["POST"])
def save_irc5_entry():
    """Creates a new entry, or updates an existing one if 'id' is included.

    Expected JSON body:
        {
          "id": 7,                 // omit/null to create a new entry
          "year": 2026,
          "title": "...", "nature": "Funded",
          "dateIsoList": ["2026-07-01", ...], "dateDisplay": "Jul. 1, 2026",
          "participants": "...", "rating": 3.75, "descVal": "Strongly Agree",
          "indicator": "...", "cause": "...", "measures": "..."
        }
    """
    data = request.get_json(silent=True) or {}
    entry_id = data.get("id")
    year = data.get("year") or _current_year()
    title = (data.get("title") or "").strip()
    nature = data.get("nature")

    if not title:
        return jsonify({"error": "'title' is required"}), 400
    if nature not in (IRC5_NATURE_FUNDED, IRC5_NATURE_NONFUNDED):
        return jsonify({"error": f"Invalid nature: {nature!r}"}), 400

    rating_raw = data.get("rating")
    try:
        rating = float(rating_raw) if rating_raw not in (None, "") else None
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid rating"}), 400

    if entry_id:
        entry = IRC5Entry.query.get(entry_id)
        if entry is None:
            return jsonify({"error": "Entry not found"}), 404
    else:
        entry = IRC5Entry(year=year)
        db.session.add(entry)

    entry.year = year
    entry.title = title
    entry.nature = nature
    entry.date_iso_list = data.get("dateIsoList") or []
    entry.date_display = data.get("dateDisplay") or ""
    entry.participants = data.get("participants")
    entry.rating = rating
    entry.desc_val = data.get("descVal")
    entry.indicator = data.get("indicator")
    entry.cause = data.get("cause")
    entry.measures = data.get("measures")

    db.session.commit()
    return jsonify(entry.to_dict()), 200


@app.route("/irc/irc5/entry/<int:entry_id>", methods=["DELETE"])
def delete_irc5_entry(entry_id):
    entry = IRC5Entry.query.get(entry_id)
    if entry is None:
        return jsonify({"error": "Entry not found"}), 404
    db.session.delete(entry)
    db.session.commit()
    return jsonify({"deleted": True, "id": entry_id}), 200


# ---------------------------------------------------------------------------
# IRC6 -- Monitoring & Evaluation Plan
# ---------------------------------------------------------------------------
def _ensure_irc6_seed(year):
    """Guarantees a Goal row and an Outcome row exist for `year`, mirroring
    the seeding irc6.js used to do purely in memory before this table
    existed. Safe to call on every GET/POST -- it's a no-op once both
    rows exist."""
    if not IRC6Entry.query.filter_by(year=year, kind=IRC6_KIND_GOAL).first():
        db.session.add(IRC6Entry(year=year, kind=IRC6_KIND_GOAL, sort_order=0))
    if not IRC6Entry.query.filter_by(year=year, kind=IRC6_KIND_OUTCOME).first():
        db.session.add(IRC6Entry(year=year, kind=IRC6_KIND_OUTCOME, sort_order=1))
    db.session.commit()


@app.route("/irc/irc6/data", methods=["GET"])
def get_irc6_data():
    year = request.args.get("year", type=int) or _current_year()
    _ensure_irc6_seed(year)
    rows = (
        IRC6Entry.query.filter_by(year=year)
        .order_by(IRC6Entry.sort_order.asc(), IRC6Entry.id.asc())
        .all()
    )
    return jsonify({"year": year, "entries": [r.to_dict() for r in rows]}), 200


@app.route("/irc/irc6/entry", methods=["POST"])
def save_irc6_entry():
    """Creates a new Output (id omitted), or updates an existing Goal /
    Outcome / Output row (id included). A row's `kind` is fixed at
    creation and never changes here -- only Outputs can be created this
    way; Goal/Outcome only ever come from _ensure_irc6_seed.

    Expected JSON body:
        {
          "id": 7,          // omit/null to create a new Output
          "year": 2026,
          "title": "...",   // Output only -- ignored for Goal/Outcome
          "objectives": "...", "indicators": "...", "definition": "...",
          "dcSource": "...", "dcPerson": "...", "dcFreq": "...",
          "daUsed": "...", "daPerson": "...", "daFreq": "...",
          "users": "...",
          "repComm": "...", "repFreq": "..."
        }
    """
    data = request.get_json(silent=True) or {}
    entry_id = data.get("id")
    year = data.get("year") or _current_year()

    field_map = {
        "objectives": "objectives", "indicators": "indicators", "definition": "definition",
        "dcSource": "dc_source", "dcPerson": "dc_person", "dcFreq": "dc_freq",
        "daUsed": "da_used", "daPerson": "da_person", "daFreq": "da_freq",
        "users": "users", "repComm": "rep_comm", "repFreq": "rep_freq",
    }

    if entry_id:
        entry = IRC6Entry.query.get(entry_id)
        if entry is None:
            return jsonify({"error": "Entry not found"}), 404
    else:
        _ensure_irc6_seed(year)
        max_order = db.session.query(db.func.max(IRC6Entry.sort_order)).filter_by(year=year).scalar() or 0
        entry = IRC6Entry(year=year, kind=IRC6_KIND_OUTPUT, sort_order=max_order + 1)
        db.session.add(entry)

    if entry.kind == IRC6_KIND_OUTPUT:
        entry.title = (data.get("title") or "").strip()

    for json_key, col_name in field_map.items():
        if json_key in data:
            setattr(entry, col_name, data[json_key])

    db.session.commit()
    return jsonify(entry.to_dict()), 200


@app.route("/irc/irc6/entry/<int:entry_id>", methods=["DELETE"])
def delete_irc6_entry(entry_id):
    entry = IRC6Entry.query.get(entry_id)
    if entry is None:
        return jsonify({"error": "Entry not found"}), 404
    if entry.kind != IRC6_KIND_OUTPUT:
        return jsonify({"error": "Goal and Outcome rows cannot be deleted"}), 400
    db.session.delete(entry)
    db.session.commit()
    return jsonify({"deleted": True, "id": entry_id}), 200


# ---------------------------------------------------------------------------
# IRC7 -- SGOD Dashboard Data
#
# Fixed rows (schools/curricular offerings) come from IRC7Row, seeded once
# via storage.seed_irc7_rows() -- these routes never create/delete rows.
# Columns (IRC7Column) are user-defined and fully CRUD-able; values
# (IRC7CellValue) are year-scoped and saved one cell at a time as the user
# edits the table. See the IRC7* section of models.py for the full
# rationale behind this EAV-style shape.
# ---------------------------------------------------------------------------
@app.route("/irc/irc7/data", methods=["GET"])
def get_irc7_data():
    year = request.args.get("year", type=int) or _current_year()
    rows = IRC7Row.query.order_by(IRC7Row.sort_order.asc()).all()
    columns = IRC7Column.query.order_by(IRC7Column.sort_order.asc()).all()
    cell_values = IRC7CellValue.query.filter_by(year=year).all()
    values = {f"{cv.row_id}:{cv.column_id}": cv.value for cv in cell_values}
    return jsonify({
        "year": year,
        "rows": [r.to_dict() for r in rows],
        "columns": [c.to_dict() for c in columns],
        "values": values,
    }), 200


@app.route("/irc/irc7/columns", methods=["POST"])
def add_irc7_columns():
    """Adds one or more columns in one call, matching the "Add Columns"
    modal's ability to submit several groups/columns at once.

    Expected JSON body:
        { "columns": [ {"name": "...", "type": "text", "groupName": "..."}, ... ] }

    Columns sharing the same non-empty groupName render under one
    spanning group header on the frontend (see irc7.js).

    ORDERING: a new column whose groupName matches a group that already
    exists is inserted directly after that group's current last column,
    rather than appended to the end of the table. Without this, adding a
    column to an existing group would store it at the far right of the
    sort order, and the frontend -- which builds a group header from a
    *contiguous* run of same-named columns -- would render that group as
    two separate header blocks with the same title. Everything else
    still appends at the end, as before.

    Because inserting shifts the columns after it, sort_order is
    reassigned across the whole table at the end. The set is small
    (user-defined indicator columns) so a full renumber is cheaper to
    reason about than juggling gap values.
    """
    data = request.get_json(silent=True) or {}
    new_columns = data.get("columns")
    if not isinstance(new_columns, list) or not new_columns:
        return jsonify({"error": "'columns' must be a non-empty list"}), 400

    valid_types = (IRC7_COLUMN_TYPE_TEXT, IRC7_COLUMN_TYPE_NUMBER, IRC7_COLUMN_TYPE_PARAGRAPH, IRC7_COLUMN_TYPE_CHECKBOX)

    # Current table order; new columns get spliced into this list.
    ordered = IRC7Column.query.order_by(IRC7Column.sort_order.asc()).all()

    created = []
    for col in new_columns:
        name = (col.get("name") or "").strip()
        col_type = col.get("type") or IRC7_COLUMN_TYPE_TEXT
        group_name = (col.get("groupName") or "").strip() or None
        if not name:
            continue
        if col_type not in valid_types:
            return jsonify({"error": f"Invalid column type: {col_type!r}"}), 400

        new_col = IRC7Column(name=name, type=col_type, group_name=group_name)
        db.session.add(new_col)
        created.append(new_col)

        # Find where this group currently ends, if it exists at all.
        # Scanning `ordered` (not the DB) means a batch adding several
        # columns to the same group keeps them in the submitted order:
        # each one lands after the previous one just inserted.
        insert_at = None
        if group_name:
            for index, existing in enumerate(ordered):
                if existing.group_name == group_name:
                    insert_at = index + 1

        if insert_at is None:
            ordered.append(new_col)
        else:
            ordered.insert(insert_at, new_col)

    if not created:
        return jsonify({"error": "Please add at least one column with a name."}), 400

    for index, column in enumerate(ordered, start=1):
        column.sort_order = index

    db.session.commit()
    return jsonify({
        "columns": [c.to_dict() for c in created],
        # The insert above can renumber existing columns, so the frontend
        # re-renders from the authoritative full ordering rather than
        # trying to splice the new cells into the DOM itself.
        "allColumns": [c.to_dict() for c in ordered],
    }), 200


@app.route("/irc/irc7/column/<int:column_id>", methods=["PUT"])
def edit_irc7_column(column_id):
    """Expected JSON body: { "name": "...", "type": "text" }"""
    data = request.get_json(silent=True) or {}
    column = IRC7Column.query.get(column_id)
    if column is None:
        return jsonify({"error": "Column not found"}), 404

    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name cannot be empty"}), 400
    col_type = data.get("type") or column.type
    if col_type not in (IRC7_COLUMN_TYPE_TEXT, IRC7_COLUMN_TYPE_NUMBER, IRC7_COLUMN_TYPE_PARAGRAPH, IRC7_COLUMN_TYPE_CHECKBOX):
        return jsonify({"error": f"Invalid column type: {col_type!r}"}), 400

    # Checkbox values ("1"/NULL) aren't meaningful as text/number/paragraph
    # content and vice versa, so switching to or from a checkbox column
    # clears that column's stored values (every year) instead of leaving
    # values that would be misread under the new type.
    if col_type != column.type and IRC7_COLUMN_TYPE_CHECKBOX in (col_type, column.type):
        IRC7CellValue.query.filter_by(column_id=column.id).delete()

    column.name = name
    column.type = col_type
    db.session.commit()
    return jsonify(column.to_dict()), 200


@app.route("/irc/irc7/column/<int:column_id>", methods=["DELETE"])
def delete_irc7_column(column_id):
    column = IRC7Column.query.get(column_id)
    if column is None:
        return jsonify({"error": "Column not found"}), 404
    db.session.delete(column)  # cascades to this column's cell values
    db.session.commit()
    return jsonify({"deleted": True, "id": column_id}), 200


@app.route("/irc/irc7/group/<path:group_name>", methods=["PUT"])
def rename_irc7_group(group_name):
    """Renames every column currently sharing `group_name` -- there's no
    separate "group" row in the schema (see models.py), so a group's
    identity IS its name; renaming necessarily applies to all of its
    columns at once, however many separate "Add Columns" batches they
    originally came from.

    Expected JSON body: { "name": "New Group Name" }
    """
    data = request.get_json(silent=True) or {}
    new_name = (data.get("name") or "").strip()
    if not new_name:
        return jsonify({"error": "Name cannot be empty"}), 400

    columns = IRC7Column.query.filter_by(group_name=group_name).all()
    if not columns:
        return jsonify({"error": "Group not found"}), 404

    for col in columns:
        col.group_name = new_name
    db.session.commit()
    return jsonify({"groupName": new_name, "columnIds": [c.id for c in columns]}), 200


@app.route("/irc/irc7/group/<path:group_name>", methods=["DELETE"])
def delete_irc7_group(group_name):
    """Deletes every column sharing `group_name` (and, via cascade, every
    cell value stored under them) -- see rename_irc7_group's docstring
    for why this applies to the whole name, not just one batch."""
    columns = IRC7Column.query.filter_by(group_name=group_name).all()
    if not columns:
        return jsonify({"error": "Group not found"}), 404

    for col in columns:
        db.session.delete(col)
    db.session.commit()
    return jsonify({"deleted": True, "groupName": group_name}), 200


@app.route("/irc/irc7/cell", methods=["POST"])
def save_irc7_cell():
    """Expected JSON body:
        { "rowId": 12, "columnId": 5, "year": 2026, "value": "1234" }

    Saving an empty string just clears the cell (stored as NULL) rather
    than being treated as an error -- irc7.js calls this on every cell's
    "change" event, including clearing one out."""
    data = request.get_json(silent=True) or {}
    row_id = data.get("rowId")
    column_id = data.get("columnId")
    year = data.get("year") or _current_year()
    value = data.get("value")

    if IRC7Row.query.get(row_id) is None:
        return jsonify({"error": "Row not found"}), 404
    column = IRC7Column.query.get(column_id)
    if column is None:
        return jsonify({"error": "Column not found"}), 404

    if column.type == IRC7_COLUMN_TYPE_CHECKBOX:
        # Normalize to "1" (checked) / NULL (unchecked) no matter how the
        # client phrased it (true, "true", "1", 1, ...).
        value = "1" if value in (True, 1, "1", "true", "True") else None
    elif value == "":
        value = None

    cell = IRC7CellValue.query.filter_by(row_id=row_id, column_id=column_id, year=year).first()
    if cell is None:
        cell = IRC7CellValue(row_id=row_id, column_id=column_id, year=year)
        db.session.add(cell)
    cell.value = value
    db.session.commit()

    return jsonify({"rowId": row_id, "columnId": column_id, "year": year, "value": value}), 200


@app.route("/irc/irc7/reset", methods=["DELETE"])
def reset_irc7_data():
    """Two reset scopes for the "Reset" button/modal, chosen via
    ?scope=values|all (defaults to "values"):

      - scope=values (default): wipes every IRC7CellValue for a given
        year (defaults to current year) -- the "Clear entered values
        only" option. Same as before: IRC7Row (fixed schools) and
        IRC7Column (columns/groups, with their names and types) are left
        completely untouched, so the table's shape survives.

      - scope=all: the "Reset entire table" option. Deletes every
        IRC7Column outright, which cascades to delete all of its cell
        values too (see the FK relationship in models.py) -- across
        every year, not just the one passed in, since a deleted column
        no longer exists for any year. IRC7Row (fixed schools) is still
        never touched; only user-added columns/groups and their data.
    """
    scope = request.args.get("scope", "values")
    year = request.args.get("year", type=int) or _current_year()

    if scope == "all":
        IRC7Column.query.delete()
        db.session.commit()
        return jsonify({"reset": True, "scope": "all"}), 200

    IRC7CellValue.query.filter_by(year=year).delete()
    db.session.commit()
    return jsonify({"reset": True, "scope": "values", "year": year}), 200


# ---------------------------------------------------------------------------
# IRC8B -- Part II: Leadership Competencies and Core Behavioural Competencies
# ---------------------------------------------------------------------------
@app.route("/irc/irc8b/data", methods=["GET"])
def get_irc8b_data():
    year = request.args.get("year", type=int) or _current_year()
    rows = IRC8BRating.query.filter_by(year=year).all()

    ratings = {}
    remarks = {}
    # subsection_key -> section_key ("leadership" | "cbc"), so irc8c.js
    # can group subsection averages into Part II-A / II-B without
    # duplicating irc8b.js's hardcoded DATA. Additive: existing callers
    # that only read "ratings"/"remarks" are unaffected.
    sections = {}
    for row in rows:
        sections[row.subsection_key] = row.section_key
        if row.rating is not None:
            ratings.setdefault(row.subsection_key, {})[str(row.criterion_index)] = row.rating
        if row.remarks:
            remarks.setdefault(row.subsection_key, {})[str(row.criterion_index)] = row.remarks

    return jsonify({"year": year, "ratings": ratings, "remarks": remarks, "sections": sections}), 200


@app.route("/irc/irc8b/rating", methods=["POST"])
def save_irc8b_rating():
    """Expected JSON body:
        { "year": 2026, "sectionKey": "cbc", "subsectionKey": "self_management",
          "criterionIndex": 0, "rating": 4, "remarks": "Optional text" }

    'rating' and 'remarks' are each optional -- only the fields present in
    the body are changed. rating: null clears a previously-set rating
    (irc8b.js does this when the user clicks an already-selected button);
    remarks: "" clears the remark.
    """
    data = request.get_json(silent=True) or {}
    year = data.get("year") or _current_year()
    section_key = data.get("sectionKey")
    subsection_key = data.get("subsectionKey")
    criterion_index = data.get("criterionIndex")

    if section_key not in (IRC8B_SECTION_LEADERSHIP, IRC8B_SECTION_CBC):
        return jsonify({"error": f"Invalid sectionKey: {section_key!r}"}), 400
    if not subsection_key or criterion_index is None:
        return jsonify({"error": "'subsectionKey' and 'criterionIndex' are required"}), 400
    if "rating" in data and data["rating"] is not None and data["rating"] not in (1, 2, 3, 4, 5):
        return jsonify({"error": f"Invalid rating: {data['rating']!r}"}), 400
    if "remarks" in data and data["remarks"] is not None and not isinstance(data["remarks"], str):
        return jsonify({"error": "'remarks' must be a string"}), 400

    row = IRC8BRating.query.filter_by(
        year=year, subsection_key=subsection_key, criterion_index=criterion_index
    ).first()
    if row is None:
        row = IRC8BRating(year=year, subsection_key=subsection_key, criterion_index=criterion_index, remarks="")
        db.session.add(row)
    row.section_key = section_key
    if "rating" in data:
        row.rating = data["rating"]
    if "remarks" in data:
        row.remarks = (data["remarks"] or "")[:500]
    db.session.commit()

    return jsonify({
        "year": year,
        "sectionKey": section_key,
        "subsectionKey": subsection_key,
        "criterionIndex": criterion_index,
        "rating": row.rating,
        "remarks": row.remarks,
    }), 200


# ---------------------------------------------------------------------------
# IRC8A -- Individual Performance Commitment and Review Form (IPCRF)
#
# These routes just persist whatever the KRA / Objective / rubric-indicator
# modals in irc8a.js submit. See the IRC8A* section of models.py for the
# full rationale behind the KRA -> Objective -> Indicator shape.
# ---------------------------------------------------------------------------
def _validate_weight(raw):
    """Returns (weight_or_None, error_message_or_None). Mirrors irc8a.js's
    own "Weight must be a number between 0 and 100" client-side check."""
    if raw in (None, ""):
        return None, None
    try:
        weight = float(raw)
    except (TypeError, ValueError):
        return None, "Weight must be a number between 0 and 100."
    if weight < 0 or weight > 100:
        return None, "Weight must be a number between 0 and 100."
    return weight, None


@app.route("/irc/irc8a/data", methods=["GET"])
def get_irc8a_data():
    year = request.args.get("year", type=int) or _current_year()
    _ensure_seeded_kras(year)
    kras = (
        IRC8AKra.query.filter_by(year=year)
        .order_by(IRC8AKra.sort_order.asc(), IRC8AKra.id.asc())
        .all()
    )
    return jsonify({"year": year, "kras": [k.to_dict() for k in kras]}), 200


@app.route("/irc/irc8a/kra", methods=["POST"])
def save_irc8a_kra():
    """Creates a new KRA (id omitted), or updates an existing one's text/
    weight (id included) -- a KRA's `year` is fixed at creation and never
    changes here.

    Expected JSON body:
        { "id": 3, "year": 2026, "text": "...", "weight": 25 }
    """
    data = request.get_json(silent=True) or {}
    kra_id = data.get("id")
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Please describe the KRA."}), 400

    weight, err = _validate_weight(data.get("weight"))
    if err:
        return jsonify({"error": err}), 400

    if kra_id:
        kra = IRC8AKra.query.get(kra_id)
        if kra is None:
            return jsonify({"error": "KRA not found"}), 404
        if kra.locked:
            return jsonify({"error": "This KRA is part of the fixed evaluation structure (Part I-A/I-C) and can't be edited."}), 403
    else:
        # Every KRA created through this endpoint lands in Part I-B --
        # Part I-A/I-C KRAs only ever come from seed_irc8a_defaults().
        year = data.get("year") or _current_year()
        max_order = db.session.query(db.func.max(IRC8AKra.sort_order)).filter_by(year=year).scalar() or 0
        kra = IRC8AKra(year=year, part=IRC8A_PART_B, sort_order=max_order + 1)
        db.session.add(kra)

    kra.text = text
    kra.weight = weight
    # Optional alignment fields -- only the keys present in the body change.
    for json_key, column in (("gaaProgram", "gaa_program"), ("bedpPillars", "bedp_pillars"), ("adminAgenda", "admin_agenda")):
        if json_key in data:
            setattr(kra, column, (data.get(json_key) or "").strip() or None)
    db.session.commit()
    return jsonify(kra.to_dict()), 200


@app.route("/irc/irc8a/kra/<int:kra_id>", methods=["DELETE"])
def delete_irc8a_kra(kra_id):
    kra = IRC8AKra.query.get(kra_id)
    if kra is None:
        return jsonify({"error": "KRA not found"}), 404
    if kra.locked:
        return jsonify({"error": "This KRA is part of the fixed evaluation structure (Part I-A/I-C) and can't be deleted."}), 403
    db.session.delete(kra)  # cascades to its objectives and their indicators
    db.session.commit()
    return jsonify({"deleted": True, "id": kra_id}), 200


@app.route("/irc/irc8a/objective", methods=["POST"])
def save_irc8a_objective():
    """Creates a new Objective under `kraId` (id omitted), or updates an
    existing one's text/weight (id included).

    Expected JSON body:
        { "id": 9, "kraId": 3, "text": "...", "weight": 40 }
    """
    data = request.get_json(silent=True) or {}
    obj_id = data.get("id")
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Please describe the objective."}), 400

    weight, err = _validate_weight(data.get("weight"))
    if err:
        return jsonify({"error": err}), 400

    if obj_id:
        objective = IRC8AObjective.query.get(obj_id)
        if objective is None:
            return jsonify({"error": "Objective not found"}), 404
        if objective.kra.locked:
            return jsonify({"error": "This objective is part of the fixed evaluation structure (Part I-A/I-C) and can't be edited."}), 403
    else:
        kra_id = data.get("kraId")
        kra = IRC8AKra.query.get(kra_id) if kra_id else None
        if kra is None:
            return jsonify({"error": "KRA not found"}), 404
        if kra.locked:
            return jsonify({"error": "Objectives can't be added here -- this KRA is part of the fixed evaluation structure (Part I-A/I-C)."}), 403
        max_order = (
            db.session.query(db.func.max(IRC8AObjective.sort_order))
            .filter_by(kra_id=kra.id).scalar() or 0
        )
        objective = IRC8AObjective(kra_id=kra.id, sort_order=max_order + 1)
        db.session.add(objective)

    objective.text = text
    objective.weight = weight
    # Optional Performance Target / listed-MOV fields -- only keys present change.
    for json_key, column in (("targetValue", "target_value"), ("targetDescription", "target_description"), ("movRequired", "mov_required")):
        if json_key in data:
            setattr(objective, column, (data.get(json_key) or "").strip() or None)
    db.session.commit()
    return jsonify(objective.to_dict()), 200


@app.route("/irc/irc8a/objective/<int:obj_id>", methods=["DELETE"])
def delete_irc8a_objective(obj_id):
    objective = IRC8AObjective.query.get(obj_id)
    if objective is None:
        return jsonify({"error": "Objective not found"}), 404
    if objective.kra.locked:
        return jsonify({"error": "This objective is part of the fixed evaluation structure (Part I-A/I-C) and can't be deleted."}), 403
    db.session.delete(objective)  # cascades to its rubric indicators
    db.session.commit()
    return jsonify({"deleted": True, "id": obj_id}), 200


@app.route("/irc/irc8a/objective/<int:obj_id>/mov", methods=["POST"])
def save_irc8a_objective_mov(obj_id):
    """Expected JSON body: { "url": "https://..." }
    An empty/omitted url clears the MOV link, matching irc8a.js's
    delete-mov action."""
    objective = IRC8AObjective.query.get(obj_id)
    if objective is None:
        return jsonify({"error": "Objective not found"}), 404

    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    objective.mov = url or None
    db.session.commit()
    return jsonify(objective.to_dict()), 200


@app.route("/irc/irc8a/objective/<int:obj_id>/actual-results", methods=["POST"])
def save_irc8a_objective_actual_results(obj_id):
    """Expected JSON body: { "text": "..." }"""
    objective = IRC8AObjective.query.get(obj_id)
    if objective is None:
        return jsonify({"error": "Objective not found"}), 404

    data = request.get_json(silent=True) or {}
    objective.actual_results = (data.get("text") or "").strip() or None
    db.session.commit()
    return jsonify(objective.to_dict()), 200


@app.route("/irc/irc8a/objective/<int:obj_id>/timeline", methods=["POST"])
def save_irc8a_objective_timeline(obj_id):
    """Expected JSON body: { "text": "..." }"""
    objective = IRC8AObjective.query.get(obj_id)
    if objective is None:
        return jsonify({"error": "Objective not found"}), 404

    data = request.get_json(silent=True) or {}
    objective.timeline = (data.get("text") or "").strip() or None
    db.session.commit()
    return jsonify(objective.to_dict()), 200


@app.route("/irc/irc8a/objective/<int:obj_id>/rating", methods=["POST"])
def save_irc8a_objective_rating(obj_id):
    """Sets (or clears) one category's selected rating on an objective --
    fired both by clicking a rubric indicator (select-indicator) and by
    picking a value directly from that category's dropdown.

    Expected JSON body: { "category": "quality", "rating": 4 }
    'rating' may be null/omitted to clear it."""
    objective = IRC8AObjective.query.get(obj_id)
    if objective is None:
        return jsonify({"error": "Objective not found"}), 404

    data = request.get_json(silent=True) or {}
    category = data.get("category")
    rating = data.get("rating")

    if category not in IRC8A_CATEGORIES:
        return jsonify({"error": f"Invalid category: {category!r}"}), 400
    if rating is not None and rating not in (1, 2, 3, 4, 5):
        return jsonify({"error": f"Invalid rating: {rating!r}"}), 400

    objective.set_rating(category, rating)
    db.session.commit()
    return jsonify(objective.to_dict()), 200


@app.route("/irc/irc8a/indicator", methods=["POST"])
def save_irc8a_indicator():
    """Creates a new rubric indicator under `objectiveId` (id omitted), or
    updates an existing one's rate/label (id included). A category is
    fixed at creation and never changes here.

    Expected JSON body:
        { "id": 5, "objectiveId": 9, "category": "quality", "rate": 3, "label": "..." }

    Rejects a rate already used by another indicator in the same
    (objective, category) -- matching populateRateOptions's "already
    used" filtering on the frontend, enforced here at the DB level too.
    """
    data = request.get_json(silent=True) or {}
    indicator_id = data.get("id")
    label = (data.get("label") or "").strip()
    rate = data.get("rate")

    if not label:
        return jsonify({"error": "Please describe what earns this rating level."}), 400
    if rate not in (1, 2, 3, 4, 5):
        return jsonify({"error": "Please select a rating level."}), 400

    if indicator_id:
        indicator = IRC8AIndicator.query.get(indicator_id)
        if indicator is None:
            return jsonify({"error": "Indicator not found"}), 404
        if indicator.objective.kra.locked:
            return jsonify({"error": "This indicator is part of the fixed evaluation structure (Part I-A/I-C) and can't be edited."}), 403
        objective_id = indicator.objective_id
        category = indicator.category  # fixed at creation
    else:
        indicator = None
        objective_id = data.get("objectiveId")
        category = data.get("category")
        if category not in IRC8A_CATEGORIES:
            return jsonify({"error": f"Invalid category: {category!r}"}), 400
        objective = IRC8AObjective.query.get(objective_id) if objective_id else None
        if objective is None:
            return jsonify({"error": "Objective not found"}), 404
        if objective.kra.locked:
            return jsonify({"error": "Indicators can't be added here -- this objective is part of the fixed evaluation structure (Part I-A/I-C)."}), 403
        if len(objective.indicators_for(category)) >= 5:
            return jsonify({"error": "At most 5 indicators are allowed per category."}), 400

    # Dupe check runs before the new row is added to the session (and
    # before any field is set on an existing one), so autoflush never
    # tries to insert/update a half-filled row while this query runs.
    dupe_query = IRC8AIndicator.query.filter_by(
        objective_id=objective_id, category=category, rate=rate
    )
    if indicator_id:
        dupe_query = dupe_query.filter(IRC8AIndicator.id != indicator_id)
    if dupe_query.first() is not None:
        return jsonify({"error": f"Rating level {rate} is already used for this category."}), 400

    if indicator is None:
        indicator = IRC8AIndicator(objective_id=objective_id, category=category)
        db.session.add(indicator)

    indicator.rate = rate
    indicator.label = label
    db.session.commit()
    return jsonify(indicator.to_dict()), 200


@app.route("/irc/irc8a/indicator/<int:indicator_id>", methods=["DELETE"])
def delete_irc8a_indicator(indicator_id):
    indicator = IRC8AIndicator.query.get(indicator_id)
    if indicator is None:
        return jsonify({"error": "Indicator not found"}), 404
    if indicator.objective.kra.locked:
        return jsonify({"error": "This indicator is part of the fixed evaluation structure (Part I-A/I-C) and can't be deleted."}), 403
    db.session.delete(indicator)
    db.session.commit()
    return jsonify({"deleted": True, "id": indicator_id}), 200


@app.route("/irc/irc8a/reset", methods=["DELETE"])
def reset_irc8a_data():
    """Reset IRC8A data for one or more parts.

    Query params:
      parts   -- comma-separated subset of "a,b,c" (Part I-A / I-B / I-C).
                 Required (at least one valid part).
      partB   -- only matters when "b" is in parts:
                   "data" (default): clear ratings, timeline, MOV link and
                       actual accomplishments of Part I-B objectives; KRAs,
                       objectives, weights and rubric indicators are kept.
                   "all": delete every Part I-B KRA (cascading to its
                       objectives and indicators).
      year    -- rating year (defaults to the current year).

    For every selected part that still exists, "reset" means clearing the
    three ratings, the MOV link, the actual accomplishments and the
    timeline. Part I-A / I-C have a fixed structure, so that is all that
    can be reset for them. Not-selected parts are left untouched.
    """
    year = request.args.get("year", type=int) or _current_year()
    raw_parts = request.args.get("parts", "")
    parts = [p for p in dict.fromkeys(x.strip().lower() for x in raw_parts.split(",")) if p in ("a", "b", "c")]
    if not parts:
        return jsonify({"error": "Select at least one part to reset."}), 400

    part_b_mode = request.args.get("partB", "data")
    if part_b_mode not in ("data", "all"):
        part_b_mode = "data"

    remove_part_b = "b" in parts and part_b_mode == "all"
    if remove_part_b:
        # Load and delete through the ORM so cascades are honoured.
        for kra in IRC8AKra.query.filter_by(year=year, part=IRC8A_PART_B).all():
            db.session.delete(kra)
        db.session.commit()

    objectives = (
        IRC8AObjective.query.join(IRC8AKra, IRC8AObjective.kra_id == IRC8AKra.id)
        .filter(IRC8AKra.year == year, IRC8AKra.part.in_(parts))
        .all()
    )
    for objective in objectives:
        for category in IRC8A_CATEGORIES:
            objective.set_rating(category, None)
        objective.mov = None
        objective.actual_results = None
        objective.timeline = None
    db.session.commit()
    return jsonify({
        "reset": True,
        "parts": parts,
        "partB": part_b_mode if "b" in parts else None,
        "year": year,
    }), 200


# ---------------------------------------------------------------------------
# IRC8D -- Part IV: Improvement and Development Plans
#
# Four routes: read everything on the page (six fixed plan rows -- three in
# Part IV-A, three in Part IV-B -- plus the two Feedback boxes), patch a
# single row, save a Feedback box, and reset. There's no create/delete for
# rows -- see models.py's IRC8DRow docstring for why they're permanent
# slots, and why "top 5" ranking/label resolution for Part IV-B's Strengths
# / Improvement Needs picks is left to irc8d.js instead of computed here.
# ---------------------------------------------------------------------------
_IRC8D_TEXT_FIELDS = {
    # JSON key -> model attribute
    "gapAnalysis": "gap_analysis",
    "improvementArea": "improvement_area",
    "objective": "objective",
    "intervention": "intervention",
    "timeline": "timeline",
    "resources": "resources",
}
_IRC8D_REF_FIELDS = {
    "strengthRef": "strength_ref",
    "devNeedsRef": "dev_needs_ref",
}


@app.route("/irc/irc8d/data", methods=["GET"])
def get_irc8d_data():
    year = request.args.get("year", type=int) or _current_year()

    existing = {(r.part, r.position): r for r in IRC8DRow.query.filter_by(year=year).all()}
    added = False
    for part in IRC8D_PARTS:
        for position in IRC8D_POSITIONS_BY_PART[part]:
            if (part, position) not in existing:
                row = IRC8DRow(year=year, part=part, position=position, is_locked=True)
                db.session.add(row)
                existing[(part, position)] = row
                added = True
    if added:
        db.session.commit()

    rows = [existing[(part, position)].to_dict() for part in IRC8D_PARTS for position in IRC8D_POSITIONS_BY_PART[part]]

    feedback = {part: "" for part in IRC8D_PARTS}
    for fb in IRC8DFeedback.query.filter_by(year=year).all():
        if fb.part in feedback:
            feedback[fb.part] = fb.text or ""

    return jsonify({"year": year, "rows": rows, "feedback": feedback}), 200


@app.route("/irc/irc8d/row", methods=["POST"])
def save_irc8d_row():
    """Partial update of one fixed plan row. Every field is optional -- only
    keys present in the body are changed, so the dropdown picks, the text
    cells, and the lock toggle can each be saved independently without
    clobbering the others.

    Expected JSON body (all fields but 'part' and 'position' optional):
        {
          "year": 2026, "part": "B", "position": 1,
          "strengthRef": "o:17", "devNeedsRef": "c:self_management",
          "gapAnalysis": "...", "improvementArea": "...",
          "objective": "...", "intervention": "...",
          "timeline": "...", "resources": "...",
          "isLocked": true
        }
    gapAnalysis / improvementArea are Part IV-A columns; strengthRef /
    devNeedsRef are Part IV-B columns. Sending one for the wrong part is
    rejected rather than silently stored.
    """
    data = request.get_json(silent=True) or {}
    year = data.get("year") or _current_year()
    part = data.get("part")
    position = data.get("position")

    if part not in IRC8D_PARTS:
        return jsonify({"error": f"Invalid part: {part!r}"}), 400
    if position not in IRC8D_POSITIONS_BY_PART[part]:
        return jsonify({"error": f"Invalid position: {position!r}"}), 400
    if part == "A" and any(k in data for k in _IRC8D_REF_FIELDS):
        return jsonify({"error": "Part IV-A has no Strengths / Improvement Needs picks"}), 400
    if part == "B" and ("gapAnalysis" in data or "improvementArea" in data):
        return jsonify({"error": "Part IV-B has no Gap Analysis / Improvement Area columns"}), 400

    row = IRC8DRow.query.filter_by(year=year, part=part, position=position).first()
    if row is None:
        row = IRC8DRow(year=year, part=part, position=position, is_locked=True)
        db.session.add(row)

    for key, attr in _IRC8D_REF_FIELDS.items():
        if key in data:
            setattr(row, attr, str(data[key]) if data[key] not in (None, "") else None)
    for key, attr in _IRC8D_TEXT_FIELDS.items():
        if key in data:
            setattr(row, attr, (data.get(key) or "").strip() or None)
    if "isLocked" in data:
        row.is_locked = bool(data["isLocked"])

    db.session.commit()
    return jsonify(row.to_dict()), 200


@app.route("/irc/irc8d/feedback", methods=["POST"])
def save_irc8d_feedback():
    """Saves one 'Feedback:' box. Expected JSON body:
        { "year": 2026, "part": "A", "text": "..." }
    Empty text clears the box."""
    data = request.get_json(silent=True) or {}
    year = data.get("year") or _current_year()
    part = data.get("part")

    if part not in IRC8D_PARTS:
        return jsonify({"error": f"Invalid part: {part!r}"}), 400
    if data.get("text") is not None and not isinstance(data["text"], str):
        return jsonify({"error": "'text' must be a string"}), 400

    fb = IRC8DFeedback.query.filter_by(year=year, part=part).first()
    if fb is None:
        fb = IRC8DFeedback(year=year, part=part)
        db.session.add(fb)
    fb.text = (data.get("text") or "").strip() or None

    db.session.commit()
    return jsonify({"year": year, "part": part, "text": fb.text or ""}), 200


@app.route("/irc/irc8d/reset", methods=["DELETE"])
def reset_irc8d_data():
    """Clears every plan row for the given year back to blank and locked,
    and empties both Feedback boxes. The seven rows themselves are fixed
    slots so they're never deleted here, only their editable fields.
    irc8d.js just re-fetches everything via loadAll() afterward, so no
    scope/body is needed in the response beyond a success flag."""
    year = request.args.get("year", type=int) or _current_year()

    for row in IRC8DRow.query.filter_by(year=year).all():
        row.gap_analysis = None
        row.improvement_area = None
        row.strength_ref = None
        row.dev_needs_ref = None
        row.objective = None
        row.intervention = None
        row.timeline = None
        row.resources = None
        row.is_locked = True

    IRC8DFeedback.query.filter_by(year=year).delete()

    db.session.commit()
    return jsonify({"reset": True, "year": year}), 200


# ---------------------------------------------------------------------------
# IRC8C -- Part III: Summary of Ratings. Read-only, has no routes of its
# own: irc8c.js reads IRC8A's data (/irc/irc8a/data), IRC8B's data
# (/irc/irc8b/data) and IRC8A's report header
# (/api/irc8a/report-header) directly, since there's nothing
# IRC8C-specific to store.
# ---------------------------------------------------------------------------


def not_found(e):
    return render_template("404.html", tabs=TABS, active_tab=None), 404


if __name__ == "__main__":
    # Convenience for local dev: make sure the schema exists and the
    # school master list is seeded even if `flask init-db` was never run.
    # In production/packaged builds, prefer running the CLI command
    # explicitly once during setup instead of relying on this.
    with app.app_context():
        db.create_all()
        storage.seed_schools()
        storage.seed_irc7_rows()
    app.run(debug=True)