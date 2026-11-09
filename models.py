"""
Project-IRC-CES -- Database Models
=============================
SQLAlchemy models for IRC1a through IRC4, IRC5, IRC6, IRC7, and IRC8b, plus
the central `UploadedFile` table that every PDF-extracted record links
back to.

IRC5, IRC6, IRC7, and IRC8b have no PDF extraction pipeline -- everything
in those tables is entered by hand through their own tab's UI, so none of
their models carry an `uploaded_file_id` column. See the section header
above each one for its specific shape.

Design notes
------------
* Every table that CAN be populated from an uploaded PDF carries a
  nullable `uploaded_file_id` FK with `ondelete="CASCADE"`. Manually
  typed rows (no PDF behind them) simply leave it NULL.

* Cascade deletion is wired two ways so it holds up no matter how a
  file gets deleted later:
    1. DB-level: `ondelete="CASCADE"` on the FK column + `passive_deletes=True`
       on the relationship. This requires SQLite's `PRAGMA foreign_keys=ON`,
       which `storage.py` / `app.py` turn on for every connection.
    2. ORM-level: `cascade="all, delete-orphan"` on the relationship, so
       `db.session.delete(uploaded_file)` cleans up children even before
       the DB-level pragma is considered.
  Belt-and-suspenders: (1) protects you if a file row is ever deleted
  outside the ORM (a script, a DB browser, etc.); (2) is what actually
  fires in the normal Flask-route deletion flow.

* `year` + `month_key` live on every monthly table, so the schema is
  already multi-year even though the current UI only shows one year at
  a time. Nothing here assumes a single year.

* IRC4 ("TA Catch-up Plan") has no PDF pipeline -- like IRC5/IRC6/IRC7/
  IRC8b, everything is entered by hand through its own tab's UI, so none
  of `IRC4Plan` / `IRC4Objective` / `IRC4Group` / `IRC4GroupSchool` carry
  an `uploaded_file_id` column. See the IRC4 section header below for
  the full shape.

* `UploadedFile.irc_type` is nullable. A per-tab upload (irc1a.html,
  irc1b.html, irc2a.html uploading directly on their own tab) still
  sets it to that single type, same as before. The home page's
  combined monthly upload can feed *several* report tables from one
  PDF, so it leaves `irc_type` NULL and represents "the file for this
  month" instead -- use `UploadedFile.linked_irc_types()` to see which
  section tables actually ended up with rows pointing back to it.
"""

from datetime import datetime

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

MONTH_KEYS = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
]

TA_STATUS_PROVIDED = "provided"
TA_STATUS_UNPROVIDED = "unprovided"

IRC1A_REMARK_POSITIVE = "positive"
IRC1A_REMARK_OFI = "ofi"
IRC1A_REMARK_CATEGORIES = {IRC1A_REMARK_POSITIVE, IRC1A_REMARK_OFI}

SCHOOL_LEVEL_ELEMENTARY = "elementary"
SCHOOL_LEVEL_SECONDARY = "secondary"

IRC5_NATURE_FUNDED = "Funded"
IRC5_NATURE_NONFUNDED = "Non-Funded"

IRC6_KIND_GOAL = "goal"
IRC6_KIND_OUTCOME = "outcome"
IRC6_KIND_OUTPUT = "output"

IRC7_COLUMN_TYPE_TEXT = "text"
IRC7_COLUMN_TYPE_NUMBER = "number"
IRC7_COLUMN_TYPE_PARAGRAPH = "paragraph"
# Cell values for a checkbox column are stored in IRC7CellValue.value as
# "1" (checked); unchecked is stored as NULL, same as any other cleared cell.
IRC7_COLUMN_TYPE_CHECKBOX = "checkbox"

# IRC8B (Part II) has two sections: II-A Leadership Competencies and
# II-B Core Behavioural Competencies.
IRC8B_SECTION_LEADERSHIP = "leadership"
IRC8B_SECTION_CBC = "cbc"

IRC8A_CATEGORY_QUALITY = "quality"
IRC8A_CATEGORY_EFFICIENCY = "efficiency"
IRC8A_CATEGORY_TIMELINESS = "timeliness"
IRC8A_CATEGORIES = (IRC8A_CATEGORY_QUALITY, IRC8A_CATEGORY_EFFICIENCY, IRC8A_CATEGORY_TIMELINESS)

# IRC8A is split into the three sub-parts of the official OPCRF/IPCRF
# Annex A form. Part I-A and Part I-C are the office's fixed, pre-defined
# structure (KRAs/Objectives come from the Compendium of Office Functions
# and never get added/edited/deleted by a user -- only rated). Part I-B is
# the "Innovating and Intervening Accomplishments" section, which is fully
# user-managed (this is what the original single-part IRC8A already did
# before this split). See `part` on IRC8AKra below and the "locked KRA"
# guards in app.py's KRA/Objective/Indicator routes.
IRC8A_PART_A = "a"
IRC8A_PART_B = "b"
IRC8A_PART_C = "c"
IRC8A_PARTS = (IRC8A_PART_A, IRC8A_PART_B, IRC8A_PART_C)

IRC8A_PART_LABELS = {
    IRC8A_PART_A: "Part I-A: Commitment to Organizational Outcomes",
    IRC8A_PART_B: "Part I-B: Innovating and Intervening Accomplishments",
    IRC8A_PART_C: "Part I-C: Organizational Effectiveness",
}

# IRC8D (Part IV: Improvement and Development Plans) has two tables -- Part
# IV-A (Office Improvement Plan) and Part IV-B (Individual Development Plan)
# -- each with exactly three fixed rows rather than a user-managed add/delete
# list, plus one Feedback box under each table.
IRC8D_PART_A = "A"
IRC8D_PART_B = "B"
IRC8D_PARTS = (IRC8D_PART_A, IRC8D_PART_B)
# Part IV-A keeps 3 fixed rows; Part IV-B has 4 (rows 1-2 draw their picks
# from IRC8a, rows 3-4 from IRC8b -- see irc8d.js).
IRC8D_POSITIONS_BY_PART = {IRC8D_PART_A: (1, 2, 3), IRC8D_PART_B: (1, 2, 3, 4)}
IRC8D_POSITIONS = (1, 2, 3, 4)  # union, kept for existing imports


# ---------------------------------------------------------------------------
# Central file registry
# ---------------------------------------------------------------------------
class UploadedFile(db.Model):
    """One row per PDF ever accepted by an /extract endpoint. Deleting
    this row (via the file manager) cascades to every extracted record
    that points back to it, across every IRC table."""

    __tablename__ = "uploaded_files"

    id = db.Column(db.Integer, primary_key=True)

    # Which single report this PDF was uploaded for: 'irc1a', 'irc1b',
    # 'irc2a', ... . NULL for a home-page combined upload that may feed
    # more than one report table -- see `linked_irc_types()` below for
    # what such a file actually ended up populating.
    irc_type = db.Column(db.String(10), nullable=True, index=True)

    original_filename = db.Column(db.String(255), nullable=False)
    stored_filename = db.Column(db.String(255), nullable=False)

    # Path *relative to UPLOAD_ROOT*, e.g. "2026/Jan/irc1a_9f3c1a2b_july.pdf".
    # Always derive the absolute path via UPLOAD_ROOT + relative_path --
    # never hardcode an absolute path, so the DB stays portable between
    # the dev machine and the packaged .exe.
    relative_path = db.Column(db.String(500), nullable=False, unique=True)

    year = db.Column(db.Integer, nullable=False, index=True)
    month_key = db.Column(db.String(3), nullable=True, index=True)   # nullable: not every IRC is monthly
    month_name = db.Column(db.String(20), nullable=True)

    file_size = db.Column(db.Integer, nullable=True)
    content_hash = db.Column(db.String(64), nullable=True, index=True)  # sha256, lets you flag re-uploads of the same PDF

    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)

    # --- Reverse relationships: every table below has a matching one of these ---
    ratings = db.relationship(
        "IRC1ARating", backref="source_file",
        cascade="all, delete-orphan", passive_deletes=True,
    )
    customer_counts = db.relationship(
        "IRC1BCustomerCount", backref="source_file",
        cascade="all, delete-orphan", passive_deletes=True,
    )
    school_statuses = db.relationship(
        "IRC2ASchoolStatus", backref="source_file",
        cascade="all, delete-orphan", passive_deletes=True,
    )
    ta_frequencies = db.relationship(
        "IRC2BTAFrequency", backref="source_file",
        cascade="all, delete-orphan", passive_deletes=True,
    )
    irc3_statuses = db.relationship(
        "IRC3Status", backref="source_file",
        cascade="all, delete-orphan", passive_deletes=True,
    )

    def linked_irc_types(self):
        """Which section tables this file actually has rows in -- the
        multi-section replacement for relying on the single `irc_type`
        column. A home-page combined upload (irc_type=NULL) can link to
        several of these at once; a per-tab upload will normally show
        just the one matching its `irc_type`, once its /import step has
        run (right after /extract, before /import, this is still empty
        -- that's expected, nothing has been written yet)."""
        types = []
        if self.ratings:
            types.append("irc1a")
        if self.customer_counts:
            types.append("irc1b")
        if self.school_statuses:
            types.append("irc2a")
        if self.ta_frequencies:
            types.append("irc2b")
        if self.irc3_statuses:
            types.append("irc3")
        return types

    def to_dict(self):
        return {
            "id": self.id,
            "irc_type": self.irc_type,
            "linked_irc_types": self.linked_irc_types(),
            "original_filename": self.original_filename,
            "relative_path": self.relative_path,
            "year": self.year,
            "month_key": self.month_key,
            "month_name": self.month_name,
            "file_size": self.file_size,
            "uploaded_at": self.uploaded_at.isoformat(),
        }


# ---------------------------------------------------------------------------
# School master list (shared by IRC2a + IRC2b)
# ---------------------------------------------------------------------------
class School(db.Model):
    """Master list of schools. Seeded once from the SCHOOLS/DEDP_PRIORITY
    constants currently hardcoded in irc2a.js -- see storage.py's
    `seed_schools()` helper. Not deleted via cascade from UploadedFile,
    since a school's identity shouldn't disappear just because a PDF
    that once mentioned it gets deleted."""

    __tablename__ = "schools"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(150), nullable=False, unique=True)
    level = db.Column(db.String(10), nullable=False)  # SCHOOL_LEVEL_ELEMENTARY | SCHOOL_LEVEL_SECONDARY
    is_dedp_priority = db.Column(db.Boolean, nullable=False, default=False)

    ta_statuses = db.relationship("IRC2ASchoolStatus", backref="school", cascade="all, delete-orphan")
    ta_frequencies = db.relationship("IRC2BTAFrequency", backref="school", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "level": self.level,
            "is_dedp_priority": self.is_dedp_priority,
        }


# ---------------------------------------------------------------------------
# IRC1a -- 10 TA indicators x monthly rating (1-5)
# ---------------------------------------------------------------------------
class IRC1ARating(db.Model):
    __tablename__ = "irc1a_ratings"
    __table_args__ = (
        db.UniqueConstraint("year", "month_key", "indicator_id", name="uq_irc1a_year_month_indicator"),
    )

    id = db.Column(db.Integer, primary_key=True)
    uploaded_file_id = db.Column(db.Integer, db.ForeignKey("uploaded_files.id", ondelete="CASCADE"), nullable=True)

    year = db.Column(db.Integer, nullable=False, index=True)
    month_key = db.Column(db.String(3), nullable=False)
    indicator_id = db.Column(db.Integer, nullable=False)  # 1-10
    rating = db.Column(db.Float, nullable=False)  # 1.000-5.000

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---------------------------------------------------------------------------
# IRC1a -- individual entries under the "Positive Aspects" / "Opportunities
# for Improvement (OFI)" cards (see irc1a.html's .irc1a-insight-card). Each
# card used to be one free-text textarea; it's now a year-scoped,
# add/remove-able list of entries instead -- same shape as IRC4Objective.
# category is one of IRC1A_REMARK_CATEGORIES ("positive" | "ofi") and
# sort_order preserves the order entries were added in.
# ---------------------------------------------------------------------------
class IRC1ARemark(db.Model):
    __tablename__ = "irc1a_remarks"

    id = db.Column(db.Integer, primary_key=True)
    year = db.Column(db.Integer, nullable=False, index=True)
    category = db.Column(db.String(20), nullable=False)
    text = db.Column(db.Text, nullable=True, default="")
    sort_order = db.Column(db.Integer, nullable=False, default=0)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "text": self.text or "",
        }


# ---------------------------------------------------------------------------
# IRC1b -- monthly "No. of Customers Served"
# ---------------------------------------------------------------------------
class IRC1BCustomerCount(db.Model):
    __tablename__ = "irc1b_customer_counts"
    __table_args__ = (
        db.UniqueConstraint("year", "month_key", name="uq_irc1b_year_month"),
    )

    id = db.Column(db.Integer, primary_key=True)
    uploaded_file_id = db.Column(db.Integer, db.ForeignKey("uploaded_files.id", ondelete="CASCADE"), nullable=True)

    year = db.Column(db.Integer, nullable=False, index=True)
    month_key = db.Column(db.String(3), nullable=False)
    customer_count = db.Column(db.Integer, nullable=False, default=0)

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---------------------------------------------------------------------------
# IRC2a -- current provided/unprovided status per school (the Kanban board)
# ---------------------------------------------------------------------------
class IRC2ASchoolStatus(db.Model):
    """Current TA-provision status of a school for a given year -- this
    is the Kanban board's source of truth. `provided_month_key` records
    *when* it was marked provided for display purposes; it is not a
    monthly time series (that's IRC2b)."""

    __tablename__ = "irc2a_school_status"
    __table_args__ = (
        db.UniqueConstraint("school_id", "year", name="uq_irc2a_school_year"),
    )

    id = db.Column(db.Integer, primary_key=True)
    school_id = db.Column(db.Integer, db.ForeignKey("schools.id", ondelete="CASCADE"), nullable=False)
    uploaded_file_id = db.Column(db.Integer, db.ForeignKey("uploaded_files.id", ondelete="CASCADE"), nullable=True)

    year = db.Column(db.Integer, nullable=False, index=True)
    status = db.Column(db.String(11), nullable=False, default=TA_STATUS_UNPROVIDED)
    provided_month_key = db.Column(db.String(3), nullable=True)

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---------------------------------------------------------------------------
# IRC2b -- monthly TA-provided checkbox grid, per school
# ---------------------------------------------------------------------------
class IRC2BTAFrequency(db.Model):
    """One row per school/year/month checkbox in the IRC2b grid."""

    __tablename__ = "irc2b_ta_frequency"
    __table_args__ = (
        db.UniqueConstraint("school_id", "year", "month_key", name="uq_irc2b_school_year_month"),
    )

    id = db.Column(db.Integer, primary_key=True)
    school_id = db.Column(db.Integer, db.ForeignKey("schools.id", ondelete="CASCADE"), nullable=False)
    uploaded_file_id = db.Column(db.Integer, db.ForeignKey("uploaded_files.id", ondelete="CASCADE"), nullable=True)

    year = db.Column(db.Integer, nullable=False, index=True)
    month_key = db.Column(db.String(3), nullable=False)
    provided = db.Column(db.Boolean, nullable=False, default=False)


# ---------------------------------------------------------------------------
# IRC3 -- DEDP / Non-DEDP TA provision summary + targets, per year
# ---------------------------------------------------------------------------
class IRC3Status(db.Model):
    """One row per year. Currently entered manually in the UI (computed
    by the user from their IRC2 results), so `uploaded_file_id` stays
    NULL unless/until IRC3 gets its own PDF extractor."""

    __tablename__ = "irc3_status"
    __table_args__ = (
        db.UniqueConstraint("year", name="uq_irc3_year"),
    )

    id = db.Column(db.Integer, primary_key=True)
    uploaded_file_id = db.Column(db.Integer, db.ForeignKey("uploaded_files.id", ondelete="CASCADE"), nullable=True)

    year = db.Column(db.Integer, nullable=False, index=True)
    dedp_ta_count = db.Column(db.Integer, nullable=False, default=0)
    dedp_target = db.Column(db.Integer, nullable=False, default=0)
    nondedp_ta_count = db.Column(db.Integer, nullable=False, default=0)
    nondedp_target = db.Column(db.Integer, nullable=False, default=0)

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---------------------------------------------------------------------------
# IRC4 -- Technical Assistance (TA) Catch-up Plan
#
# One plan per year (IRC4Plan), built from IRC3's results. No PDF pipeline
# here -- entered entirely by hand through irc4.js, same treatment as
# IRC5/IRC6/IRC7/IRC8b, so nothing below carries an `uploaded_file_id`.
#
#   IRC4Plan          -- the single-per-year Activity / TA Receiver / MOV's
#                         text blocks.
#   IRC4Objective     -- ordered list of objectives under the plan.
#   IRC4Group         -- one schedule "batch": a set of schools + one
#                         target month. A school can appear in more than
#                         one group (e.g. TA in two different months), so
#                         schools are NOT stored as a column here -- see
#                         IRC4GroupSchool below.
#   IRC4GroupSchool   -- junction table (many-to-many between groups and
#                         schools). Links to the shared `School` table
#                         (same one IRC2a/IRC2b already use) rather than
#                         storing school names as raw strings, so IRC4
#                         stays in sync with the rest of the app by
#                         construction instead of via a copy-pasted roster.
#
# The "has this school already been given TA" indicator shown in irc4.js's
# Add/Edit Group modal is NOT stored here -- it's computed live from
# IRC2BTAFrequency (see the /irc/irc4/school-ta-status route in app.py),
# since IRC2b's records are the actual source of truth for that count.
# ---------------------------------------------------------------------------
class IRC4Plan(db.Model):
    __tablename__ = "irc4_plans"
    __table_args__ = (
        db.UniqueConstraint("year", name="uq_irc4_plan_year"),
    )

    id = db.Column(db.Integer, primary_key=True)

    year = db.Column(db.Integer, nullable=False, index=True)

    activity = db.Column(db.Text, nullable=True)
    ta_receiver = db.Column(db.Text, nullable=True)
    movs = db.Column(db.Text, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    objectives = db.relationship(
        "IRC4Objective", backref="plan", order_by="IRC4Objective.sort_order, IRC4Objective.id",
        cascade="all, delete-orphan",
    )
    groups = db.relationship(
        "IRC4Group", backref="plan", order_by="IRC4Group.sort_order, IRC4Group.id",
        cascade="all, delete-orphan",
    )

    def to_dict(self):
        return {
            "id": self.id,
            "year": self.year,
            "activity": self.activity or "",
            "taReceiver": self.ta_receiver or "",
            "movs": self.movs or "",
            "objectives": [o.to_dict() for o in self.objectives],
            "groups": [g.to_dict() for g in self.groups],
        }


class IRC4Objective(db.Model):
    __tablename__ = "irc4_objectives"

    id = db.Column(db.Integer, primary_key=True)
    plan_id = db.Column(db.Integer, db.ForeignKey("irc4_plans.id", ondelete="CASCADE"), nullable=False)

    text = db.Column(db.Text, nullable=True, default="")

    # Preserves manual ordering (letterLabel(a, b, c, ...) in irc4.js is
    # derived from this position, never stored as a literal "a."/"b."
    # value -- same convention as IRC6Entry's output rows).
    sort_order = db.Column(db.Integer, nullable=False, default=0)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "text": self.text or "",
        }


class IRC4Group(db.Model):
    __tablename__ = "irc4_groups"

    id = db.Column(db.Integer, primary_key=True)
    plan_id = db.Column(db.Integer, db.ForeignKey("irc4_plans.id", ondelete="CASCADE"), nullable=False)

    # One of irc4.js's own month codes ("Jan".."Dec", capitalized -- see
    # that file's MONTH_LABELS), NOT this app's usual lowercase MONTH_KEYS.
    # NULL if not yet picked.
    schedule_month_key = db.Column(db.String(3), nullable=True)

    sort_order = db.Column(db.Integer, nullable=False, default=0)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    group_schools = db.relationship(
        "IRC4GroupSchool", backref="group", order_by="IRC4GroupSchool.id",
        cascade="all, delete-orphan",
    )

    def to_dict(self):
        return {
            "id": self.id,
            "schedule": self.schedule_month_key,
            "schools": [gs.school.name for gs in self.group_schools if gs.school],
        }


class IRC4GroupSchool(db.Model):
    """Junction row: one school inside one group. A school can sit in
    more than one group (different months), so there's deliberately no
    unique constraint on `school_id` alone -- only on the (group, school)
    pair, so the same school can't be added twice to the same group."""

    __tablename__ = "irc4_group_schools"
    __table_args__ = (
        db.UniqueConstraint("group_id", "school_id", name="uq_irc4_group_school"),
    )

    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey("irc4_groups.id", ondelete="CASCADE"), nullable=False)
    school_id = db.Column(db.Integer, db.ForeignKey("schools.id", ondelete="CASCADE"), nullable=False)

    school = db.relationship("School")


# ---------------------------------------------------------------------------
# IRC5 -- Post Program Evaluation Results (one row per activity)
#
# No PDF pipeline for this one (per the SMME Section's evaluation results,
# typed in by hand), so there's no uploaded_file_id here -- unlike the
# tables above, nothing here is ever populated from an /extract endpoint.
# `year` still exists so entries file under a report period the same way
# every other table in this app does.
# ---------------------------------------------------------------------------
class IRC5Entry(db.Model):
    __tablename__ = "irc5_entries"

    id = db.Column(db.Integer, primary_key=True)

    year = db.Column(db.Integer, nullable=False, index=True)

    title = db.Column(db.String(255), nullable=False)
    nature = db.Column(db.String(20), nullable=False)  # IRC5_NATURE_FUNDED | IRC5_NATURE_NONFUNDED

    # List of ISO "YYYY-MM-DD" strings, e.g. ["2026-12-11", "2026-12-14", ...].
    # `date_display` caches the frontend's hybrid "Dec. 11, 14-16, 2026"
    # formatting of that same list, so the table can render without
    # recomputing it -- it's derived data, kept in sync by the save route.
    date_iso_list = db.Column(db.JSON, nullable=False, default=list)
    date_display = db.Column(db.String(255), nullable=False, default="")

    participants = db.Column(db.Text, nullable=True)

    # Overall Rating (1.00-4.00) and its derived Descriptive Value
    # (Strongly Agree / Agree / Disagree / Strongly Disagree, per the
    # 0.75-wide bands in irc5.js's computeDescVal). `desc_val` is cached
    # here for the same reason as `date_display` -- it's recomputed from
    # `rating` on every save, never trusted as independently-entered data.
    rating = db.Column(db.Float, nullable=True)
    desc_val = db.Column(db.String(30), nullable=True)

    indicator = db.Column(db.Text, nullable=True)
    cause = db.Column(db.Text, nullable=True)
    measures = db.Column(db.Text, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "year": self.year,
            "title": self.title,
            "nature": self.nature,
            "dateIsoList": self.date_iso_list or [],
            "dateDisplay": self.date_display,
            "participants": self.participants,
            "rating": self.rating,
            "descVal": self.desc_val,
            "indicator": self.indicator,
            "cause": self.cause,
            "measures": self.measures,
        }


# ---------------------------------------------------------------------------
# IRC6 -- Monitoring & Evaluation Plan (Goal / Outcome / Output rows)
#
# One "goal" row and one "outcome" row per year are expected to exist
# (seeded the same way irc6.js seeds them client-side), plus any number of
# "output" rows. `sort_order` preserves each output's position -- outputs
# are numbered by position at render time (see irc6.js's outputNumberFor),
# never stored as a literal "Output N" value, so deleting one still leaves
# the rest numbering cleanly.
#
# The partial unique index below enforces "at most one goal row and one
# outcome row per year" at the DB level without constraining "output" rows,
# which are meant to repeat.
# ---------------------------------------------------------------------------
class IRC6Entry(db.Model):
    __tablename__ = "irc6_entries"
    __table_args__ = (
        db.Index(
            "uq_irc6_goal_outcome_per_year",
            "year", "kind",
            unique=True,
            sqlite_where=db.text("kind != 'output'"),
        ),
    )

    id = db.Column(db.Integer, primary_key=True)

    year = db.Column(db.Integer, nullable=False, index=True)
    kind = db.Column(db.String(10), nullable=False)  # IRC6_KIND_GOAL | IRC6_KIND_OUTCOME | IRC6_KIND_OUTPUT

    # Only meaningful when kind == IRC6_KIND_OUTPUT; blank for goal/outcome.
    title = db.Column(db.String(255), nullable=False, default="")

    objectives = db.Column(db.Text, nullable=True)
    indicators = db.Column(db.Text, nullable=True)
    definition = db.Column(db.Text, nullable=True)

    dc_source = db.Column(db.Text, nullable=True)   # Data Collection: Source/Methods
    dc_person = db.Column(db.String(255), nullable=True)
    dc_freq = db.Column(db.String(255), nullable=True)

    da_used = db.Column(db.Text, nullable=True)      # Data Analysis: Data Used
    da_person = db.Column(db.String(255), nullable=True)
    da_freq = db.Column(db.String(255), nullable=True)

    users = db.Column(db.Text, nullable=True)         # Users of M&E Results

    rep_comm = db.Column(db.Text, nullable=True)      # Reporting: Communication Strategies
    rep_freq = db.Column(db.String(255), nullable=True)

    sort_order = db.Column(db.Integer, nullable=False, default=0)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "year": self.year,
            "kind": self.kind,
            "title": self.title,
            "objectives": self.objectives,
            "indicators": self.indicators,
            "definition": self.definition,
            "dcSource": self.dc_source,
            "dcPerson": self.dc_person,
            "dcFreq": self.dc_freq,
            "daUsed": self.da_used,
            "daPerson": self.da_person,
            "daFreq": self.da_freq,
            "users": self.users,
            "repComm": self.rep_comm,
            "repFreq": self.rep_freq,
        }


# ---------------------------------------------------------------------------
# IRC7 -- SGOD Dashboard Data (user-extensible spreadsheet)
#
# irc7.html ships with a *fixed* set of rows (one per school / curricular
# offering combination -- some schools appear twice, once per offering) and
# a *fixed* set of leading columns (School ID, School Name, Curricular
# Offering, DLC, Status, School Classification). On top of that, the user
# can add any number of extra columns (grouped or standalone, each typed
# text/number/paragraph) via the "Add Column" modal, and fill in a value
# for each one against each row.
#
# That's modeled here as three tables instead of one wide table:
#   - IRC7Row     -- the fixed reference rows, seeded once (see
#                    storage.seed_irc7_rows()), analogous to School.
#   - IRC7Column  -- the user-defined columns/groups, added and removed
#                    freely through the UI.
#   - IRC7CellValue -- one value per (row, column, year) -- EAV-style,
#                    since the set of columns is unbounded and changes at
#                    runtime. `value` is always stored as text; number
#                    columns are parsed/validated at the API layer.
# `year` lives on IRC7CellValue (not IRC7Row/IRC7Column) since the rows and
# the column definitions are shared across years, but the entered data for
# a given school+column is naturally year-scoped, like everything else in
# this app that isn't a static master list.
# ---------------------------------------------------------------------------
class IRC7Row(db.Model):
    """One fixed reference row: a school, or a school's specific curricular
    offering. Seeded once from the dataset baked into the old irc7.html
    (see storage.seed_irc7_rows()); not created/deleted through the UI."""

    __tablename__ = "irc7_rows"

    id = db.Column(db.Integer, primary_key=True)

    # DepEd School ID as printed on the report -- kept as a string since a
    # few source rows have it blank (e.g. "Dela Paz ES"), and it's never
    # used arithmetically. Deliberately NOT unique: several rows legitimately
    # share the same school_id_code (one per curricular offering).
    school_id_code = db.Column(db.String(20), nullable=True)
    school_name = db.Column(db.String(150), nullable=False)
    curricular_offering = db.Column(db.String(50), nullable=False)
    dlc = db.Column(db.String(10), nullable=True)  # District Learning Cluster, e.g. "II-D"
    dedp_status = db.Column(db.String(11), nullable=False, default="non-DEDP")  # "DEDP" | "non-DEDP"
    classification = db.Column(db.String(20), nullable=True)  # Small / Medium / Large / Very Large

    # Preserves the original on-screen row order (seed order), since rows
    # aren't alphabetically unambiguous on their own (duplicate names).
    sort_order = db.Column(db.Integer, nullable=False, default=0)

    cell_values = db.relationship(
        "IRC7CellValue", backref="row",
        cascade="all, delete-orphan", passive_deletes=True,
    )

    def to_dict(self):
        return {
            "id": self.id,
            "schoolIdCode": self.school_id_code,
            "schoolName": self.school_name,
            "curricularOffering": self.curricular_offering,
            "dlc": self.dlc,
            "dedpStatus": self.dedp_status,
            "classification": self.classification,
            "sortOrder": self.sort_order,
        }


class IRC7Column(db.Model):
    """A user-added column, standalone or part of a named group. Deleting a
    column (or a whole group) cascades to every cell value stored under
    it, mirroring irc7.js's removeColumn()/removeGroup() UI behavior."""

    __tablename__ = "irc7_columns"

    id = db.Column(db.Integer, primary_key=True)

    name = db.Column(db.String(150), nullable=False)
    type = db.Column(db.String(20), nullable=False, default=IRC7_COLUMN_TYPE_TEXT)

    # Null for a standalone column; columns sharing the same group_name are
    # rendered under one spanning header, same as irc7.js's `groupName`.
    group_name = db.Column(db.String(150), nullable=True)

    sort_order = db.Column(db.Integer, nullable=False, default=0)

    cell_values = db.relationship(
        "IRC7CellValue", backref="column",
        cascade="all, delete-orphan", passive_deletes=True,
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "type": self.type,
            "groupName": self.group_name,
            "sortOrder": self.sort_order,
        }


class IRC7CellValue(db.Model):
    __tablename__ = "irc7_cell_values"
    __table_args__ = (
        db.UniqueConstraint("row_id", "column_id", "year", name="uq_irc7_row_column_year"),
    )

    id = db.Column(db.Integer, primary_key=True)
    row_id = db.Column(db.Integer, db.ForeignKey("irc7_rows.id", ondelete="CASCADE"), nullable=False)
    column_id = db.Column(db.Integer, db.ForeignKey("irc7_columns.id", ondelete="CASCADE"), nullable=False)

    year = db.Column(db.Integer, nullable=False, index=True)
    value = db.Column(db.Text, nullable=True)

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---------------------------------------------------------------------------
# IRC8B -- Part II: Leadership Competencies (II-A) and Core Behavioural
# Competencies (II-B)
#
# The sections/subsections/indicator text is hardcoded in irc8b.js (DATA
# constant) -- only what the user enters is persisted here, one row per
# (year, subsection, indicator index): the 1-5 rating and the
# "Remarks / Observations" text from the form.
# ---------------------------------------------------------------------------
class IRC8BRating(db.Model):
    __tablename__ = "irc8b_ratings"
    __table_args__ = (
        db.UniqueConstraint("year", "subsection_key", "criterion_index", name="uq_irc8b_year_subsection_criterion"),
    )

    id = db.Column(db.Integer, primary_key=True)

    year = db.Column(db.Integer, nullable=False, index=True)
    section_key = db.Column(db.String(10), nullable=False)      # IRC8B_SECTION_LEADERSHIP | IRC8B_SECTION_CBC
    subsection_key = db.Column(db.String(40), nullable=False)   # e.g. "self_management"
    criterion_index = db.Column(db.Integer, nullable=False)     # 0-based position within the subsection's indicators

    rating = db.Column(db.Integer, nullable=True)  # 1-5, or NULL if cleared
    remarks = db.Column(db.Text, nullable=False, default="", server_default="")  # Remarks / Observations

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---------------------------------------------------------------------------
# IRC8A -- Individual Performance Commitment and Review Form (IPCRF)
#
# The KRA -> Objective -> rubric-indicator hierarchy from irc8a.js maps
# onto three tables:
#
#   IRC8AKra        -- one row per Key Result Area. `year` lives here (the
#                       top of the tree) since the whole IPCRF is an annual
#                       document; nothing below repeats it.
#   IRC8AObjective  -- one row per Objective under a KRA. Carries the
#                       Planning fields (timeline) and Evaluation fields
#                       (MOV link, actual results, and the three per-
#                       category ratings) directly as columns, since each
#                       objective has exactly one of each.
#   IRC8AIndicator  -- one row per rubric line ("what earns a 3" etc.)
#                       under one of an objective's three categories
#                       (quality/efficiency/timeliness). irc8a.js caps
#                       these at 5 per category with a unique rate 1-5
#                       each, enforced here via the unique constraint below.
#
# `rating_quality` / `rating_efficiency` / `rating_timeliness` on
# IRC8AObjective are the *selected* rating for that category -- set either
# by clicking a rubric indicator or picking a value directly from that
# category's dropdown. They are stored independently of IRC8AIndicator:
# deleting a rubric indicator never clears a rating that happens to match
# its rate, since the rating may have been set manually too.
#
# The overall Average (per objective) and Score (Average x Objective
# Weight), and the KRA-list-wide Total KRA Weight / Overall Rating summary,
# are all cheap to recompute from the columns above on every read, so none
# of them are persisted.
# ---------------------------------------------------------------------------
class IRC8AKra(db.Model):
    __tablename__ = "irc8a_kras"

    id = db.Column(db.Integer, primary_key=True)

    year = db.Column(db.Integer, nullable=False, index=True)
    text = db.Column(db.Text, nullable=False, default="")
    weight = db.Column(db.Float, nullable=True)  # percent, 0-100

    # "Organizational Outcomes Alignment" columns from the OPCRF sheet. One
    # set per KRA (every objective under the KRA shares them). Seeded for
    # Part I-A, optional free text for user-built Part I-B KRAs.
    gaa_program = db.Column(db.Text, nullable=True)     # GAA Programs / Subprograms
    bedp_pillars = db.Column(db.Text, nullable=True)    # BEDP Pillars
    admin_agenda = db.Column(db.Text, nullable=True)    # Current Administration Agenda

    # Which of the three OPCRF sub-parts this KRA belongs to. Defaults to
    # "b" (the user-managed part) so every KRA created the old way, before
    # this column existed, keeps behaving exactly as it did. "a" and "c"
    # KRAs are seeded once per year by seed_irc8a_defaults() below and
    # are structurally locked -- see the `locked` property.
    part = db.Column(db.String(1), nullable=False, default=IRC8A_PART_B, index=True)

    # Preserves on-screen KRA order (also drives the palette color cycle
    # and the "Key Result Area N" numbering in irc8a.js) -- assigned as
    # max(sort_order)+1 at creation time; there's no drag-reorder in the
    # current UI, so nothing else ever rewrites it.
    sort_order = db.Column(db.Integer, nullable=False, default=0)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    objectives = db.relationship(
        "IRC8AObjective", backref="kra",
        cascade="all, delete-orphan", passive_deletes=True,
        order_by="IRC8AObjective.sort_order",
    )

    @property
    def locked(self):
        """True for Part I-A / Part I-C KRAs: their text/weight can't be
        edited and no KRA/Objective/Indicator can be added or removed
        under them -- only ratings (and the MOV/Actual Results/Timeline
        evaluation fields) can be filled in. Enforced server-side in
        app.py; this property is just what the frontend reads to decide
        which buttons to show."""
        return self.part != IRC8A_PART_B

    def to_dict(self):
        return {
            "id": self.id,
            "year": self.year,
            "text": self.text,
            "weight": self.weight,
            "gaaProgram": self.gaa_program,
            "bedpPillars": self.bedp_pillars,
            "adminAgenda": self.admin_agenda,
            "part": self.part,
            "locked": self.locked,
            "objectives": [o.to_dict() for o in self.objectives],
        }


class IRC8AObjective(db.Model):
    __tablename__ = "irc8a_objectives"

    id = db.Column(db.Integer, primary_key=True)
    kra_id = db.Column(db.Integer, db.ForeignKey("irc8a_kras.id", ondelete="CASCADE"), nullable=False)

    text = db.Column(db.Text, nullable=False, default="")
    weight = db.Column(db.Float, nullable=True)  # percent, 0-100

    # Planning
    timeline = db.Column(db.Text, nullable=True)
    target_value = db.Column(db.String(100), nullable=True)   # Performance Targets: Value (numerical, statistical, trend)
    target_description = db.Column(db.Text, nullable=True)    # Performance Targets: Description (expected outcome/output/service)
    mov_required = db.Column(db.Text, nullable=True)          # MOVs the form lists for this objective (document names)

    # Evaluation
    mov = db.Column(db.String(2000), nullable=True)   # Means of Verification link
    actual_results = db.Column(db.Text, nullable=True)

    # Selected rating per category -- independent of IRC8AIndicator, see
    # the module-level docstring above for why.
    rating_quality = db.Column(db.Integer, nullable=True)      # 1-5
    rating_efficiency = db.Column(db.Integer, nullable=True)   # 1-5
    rating_timeliness = db.Column(db.Integer, nullable=True)   # 1-5

    # Preserves on-screen order within its KRA -- drives the "Objective A/B/C..."
    # lettering (letterLabel(objIndex) in irc8a.js) by position, not by id.
    sort_order = db.Column(db.Integer, nullable=False, default=0)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    indicators = db.relationship(
        "IRC8AIndicator", backref="objective",
        cascade="all, delete-orphan", passive_deletes=True,
    )

    _RATING_COLUMNS = {
        IRC8A_CATEGORY_QUALITY: "rating_quality",
        IRC8A_CATEGORY_EFFICIENCY: "rating_efficiency",
        IRC8A_CATEGORY_TIMELINESS: "rating_timeliness",
    }

    def rating_for(self, category):
        return getattr(self, self._RATING_COLUMNS[category], None)

    def set_rating(self, category, value):
        setattr(self, self._RATING_COLUMNS[category], value)

    def indicators_for(self, category):
        # Sorted highest rate first, matching irc8a.js's renderIndicatorGroup.
        return sorted(
            (i for i in self.indicators if i.category == category),
            key=lambda i: i.rate,
            reverse=True,
        )

    def average(self):
        values = [
            v for v in (self.rating_quality, self.rating_efficiency, self.rating_timeliness)
            if v is not None
        ]
        if not values:
            return None
        return sum(values) / len(values)

    def score(self):
        avg = self.average()
        if avg is None or self.weight is None:
            return None
        return avg * (self.weight / 100)

    def to_dict(self):
        return {
            "id": self.id,
            "kraId": self.kra_id,
            "text": self.text,
            "weight": self.weight,
            "timeline": self.timeline,
            "targetValue": self.target_value,
            "targetDescription": self.target_description,
            "movRequired": self.mov_required,
            "mov": self.mov,
            "actualResults": self.actual_results,
            "ratings": {
                IRC8A_CATEGORY_QUALITY: self.rating_quality,
                IRC8A_CATEGORY_EFFICIENCY: self.rating_efficiency,
                IRC8A_CATEGORY_TIMELINESS: self.rating_timeliness,
            },
            "average": self.average(),
            "score": self.score(),
            IRC8A_CATEGORY_QUALITY: [i.to_dict() for i in self.indicators_for(IRC8A_CATEGORY_QUALITY)],
            IRC8A_CATEGORY_EFFICIENCY: [i.to_dict() for i in self.indicators_for(IRC8A_CATEGORY_EFFICIENCY)],
            IRC8A_CATEGORY_TIMELINESS: [i.to_dict() for i in self.indicators_for(IRC8A_CATEGORY_TIMELINESS)],
        }


class IRC8AIndicator(db.Model):
    """One rubric line ("what earns this rating level") under one of an
    objective's three Planning categories. irc8a.js caps these at 5 per
    (objective, category) with a unique rate 1-5 each -- enforced here too."""

    __tablename__ = "irc8a_indicators"
    __table_args__ = (
        db.UniqueConstraint("objective_id", "category", "rate", name="uq_irc8a_objective_category_rate"),
    )

    id = db.Column(db.Integer, primary_key=True)
    objective_id = db.Column(db.Integer, db.ForeignKey("irc8a_objectives.id", ondelete="CASCADE"), nullable=False)

    category = db.Column(db.String(12), nullable=False)  # IRC8A_CATEGORY_*
    rate = db.Column(db.Integer, nullable=False)          # 1-5
    label = db.Column(db.Text, nullable=False, default="")

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "objectiveId": self.objective_id,
            "category": self.category,
            "rate": self.rate,
            "label": self.label,
        }


# ---------------------------------------------------------------------------
# Fixed Part I-A / Part I-C structure -- copied verbatim from the Annex A
# OPCRF sheet (irc8a_format.pdf, SGOD / SDO Antipolo City). Nothing below is
# reworded: KRA names, objective text, Weight Allocation per objective, and
# every rubric line (the 5-4-3-2-1 Quality / Efficiency / Timeliness
# indicators) are exactly as printed in the PDF, including its own typos
# (e.g. "feedbcak", "assistacne", "of of the schools"). The "5)" / "4)" ...
# numbering in front of each rubric line is not stored -- the page shows the
# level itself. An empty Quality / Efficiency / Timeliness group means that
# measure's cells are blank in the PDF (so no rating is required for it).
#
# Each objective's "indicators" are seeded as IRC8AIndicator rows, so
# they show up as the clickable rubric lines on the page. Part I-A and
# Part I-C are locked (see IRC8AKra.locked) so these can't be edited or
# deleted from the UI -- raters just click the level that applies.
#
# Weight Allocation checks (asserted at import time below):
#   Part I-A: 4 + 8 + 6 + 8 + 18 + 9 + 7 = 60      Part I-C: 5 + 5 + 5 = 15
# ---------------------------------------------------------------------------
IRC8A_SEED_KRAS = [
    {"part": IRC8A_PART_A, "text": "Support for School Management and Operations", "weight": 4, "objectives": [
        {
            "text": "A. Capacitated at least 86% of the schools and learning centers in the delivery of basic education program support services.",
            "weight": 2,
            "indicators": {
                "quality": {
                    5: "Capacitated the schools and learning centers, conducted analyses, and held post-program evaluation meetings to provide technical assistance, utilizing the Monitoring and Evaluation findings, to improve the delivery of basic education program support services.",
                    4: "Capacitated the schools and learning centers, and conducted analyses of M&E results in the delivery of basic education. program support services.",
                    3: "Capacitated the schools and learning centers in the delivery of basic education program support services.",
                    2: "Held Quality Assurance Team (QAT) meetings with Section Heads to review the implementation plan and resolve issues related to the delivery of basic education program support services.",
                    1: "Collected information from Section Heads of proposed Programs, Projects, and Activities (PPAs) concerning the delivery of basic education program support services.",
                },
                "efficiency": {
                    5: "96-100% (64-67) of the schools and learning centers",
                    4: "91-95% (60-63) of the schools and learning centers",
                    3: "86-90% (57-59) of the schools and learning centers",
                    2: "81-85% (54-56) of the schools and learning centers",
                    1: "80% and below (53 & below) of the schools and learning centers",
                },
            },
        },
        {
            "text": "B. Implemented and managed at least 86% of programmed learner support services such as youth development, sports development, health, and nutrition, DRRM programs, and the Child-Friendly School System with emphasis on right-based education (RBE) on deadline.",
            "weight": 2,
            "indicators": {
                "quality": {
                    5: "Implemented and managed the approved learner support services such as youth development, sports development, health, and nutrition, DRRM programs, and the Child-Friendly School System with emphasis on right-based education (RBE), attained M&E results of \"Strongly Agree\", identified and submitted Narrative & Pictorial Report.",
                    4: "Implemented and managed the approved learner support services such as youth development, sports development, health, and nutrition, DRRM programs, and the Child-Friendly School System with emphasis on right-based education (RBE), and attained M&E results of \"Strongly Agree.\"",
                    3: "Implemented and managed the approved learner support services such as youth development, sports development, health, and nutrition, DRRM programs, and the Child-Friendly School System with emphasis on right-based education (RBE).",
                    2: "Submitted and presented the PPAs",
                    1: "Conceptualized the PPAs",
                },
                "efficiency": {
                    5: "96-100% (21) of the learning support services",
                    4: "91-94% (19-20) of the learning support services",
                    3: "86-90% (18) of the learning support services",
                    2: "81-85% (16-17) of the learning support services",
                    1: "80% and below (15 & below) of the learning support services",
                },
                "timeliness": {
                    5: "Submitted Accomplishment Report 2 days before the deadline.",
                    4: "1 day before the deadline",
                    3: "on deadline",
                    2: "1 day after the deadline",
                    1: "2 days or more after the deadline",
                },
            },
        },
    ]},
    {"part": IRC8A_PART_A, "text": "Planning and Research Management", "weight": 8, "objectives": [
        {
            "text": "A. Facilitated the preparation of the Division Education Development Plan (DEDP) and assisted at least 86% of the schools in the preparation of responsive and QBEDP-aligned School Improvement Plan (SIP)/Annual Improvement Plan (AIP).",
            "weight": 2,
            "indicators": {
                "quality": {
                    5: "Facilitated the preparation/review/updating of the Division Education Development Plan (DEDP) and assisted the schools in the preparation and evaluation of responsive and QBEDP-aligned School Improvement Plan (SIP)/Annual Improvement Plan (AIP), attained a TA Feedback results of \"Very Satisfied\" and identified and addressed improvement areas.",
                    4: "Facilitated the preparation/review/ updating of the Division Education Development Plan (DEDP), assisted the schools in the preparation of responsive and QBEDP-aligned School Improvement Plan (SIP)/Annual Improvement Plan (AIP), and monitored and evaluated the SIP/AIP implementation.",
                    3: "Facilitated the preparation/review/updating of the Division Education Development Plan (DEDP) and assisted the schools in the preparation of responsive and QBEDP-aligned School Improvement Plan (SIP)/Annual Improvement Plan (AIP).",
                    2: "Prepared and issued a Division Memo on SIP/AIP Evaluation",
                    1: "Organized/Reconstituted the SIP/AIP Evaluation Team",
                },
                "efficiency": {
                    5: "96-100% (64-67) of the schools and learning centers",
                    4: "91-95% (60-63) of the schools and learning centers",
                    3: "86-90% (57-59) of the schools and learning centers",
                    2: "81-85% (54-56) of the schools and learning centers",
                    1: "80% and below (53 & below) of the schools and learning centers",
                },
            },
        },
        {
            "text": "B. Validated, consolidated and processed timely, accurate, and relevant basic education statistics for budget, planning, policy, research, and resource allocation of at least 86% of the schools on deadline.",
            "weight": 2,
            "indicators": {
                "quality": {
                    5: "Validated, consolidated, processed timely, communicated, and submitted accurate, and relevant basic education statistics for budget, planning, policy, research, and resource allocation of of the schools.",
                    4: "Validated, consolidated, processed timely, and communicated accurate, and relevant basic education statistics for budget, planning, policy, research, and resource allocation of of the schools.",
                    3: "Validated, consolidated and processed timely, accurate, and relevant basic education statistics for budget, planning, policy, research, and resource allocation of of the schools.",
                    2: "Ensured the completeness of all reports",
                    1: "Released a memorandum through the Planning & Research Section regarding the submission of reports.",
                },
                "efficiency": {
                    5: "96-100% (64-67) of the schools and learning centers",
                    4: "91-95% (60-63) of the schools and learning centers",
                    3: "86-90% (57-59) of the schools and learning centers",
                    2: "81-85% (54-56) of the schools and learning centers",
                    1: "80% and below (53 & below) of the schools and learning centers",
                },
                "timeliness": {
                    5: "Submitted reports 2 days before the deadline.",
                    4: "1 day before the deadline",
                    3: "on deadline",
                    2: "1 day after the deadline",
                    1: "2 days or more after the deadline",
                },
            },
        },
        {
            "text": "C. Provided technical assistance to at least 86% of the schools or learning centers to increase the capacity of personnel in the conduct of policy evaluation researches.",
            "weight": 2,
            "indicators": {
                "quality": {
                    5: "Provided technical assistance to the schools to increase the capacity of personnel in the conduct of policy evaluation researches, received a Very Satisfactory rating in feedback and client satisfaction for the provided TA, and identified areas for improvement based on the TA feedbcak report.",
                    4: "Provided technical assistance to the schools to increase the capacity of personnel in the conduct of policy evaluation researches and received a Very Satisfactory rating in feedback and client satisfaction for the provided TA.",
                    3: "Provided technical assistance to the schools to increase the capacity of personnel in the conduct of policy evaluation researches.",
                    2: "Addressed inquiries regarding the scheduled TA.",
                    1: "Released a memorandum or notice outlining the schedule of TA through the Planning and Research Section.",
                },
                "efficiency": {
                    5: "96-100% (64-67) of the schools and learning centers",
                    4: "91-95% (60-63) of the schools and learning centers",
                    3: "86-90% (57-59) of the schools and learning centers",
                    2: "81-85% (54-56) of the schools and learning centers",
                    1: "80% and below (53 & below) of the schools and learning centers",
                },
            },
        },
        {
            "text": "D. Provided TA to at least 5 of the schools that conducted BERF research studies. (2%)",
            "weight": 2,
            "indicators": {
                "quality": {
                    5: "Provided TA to the schools in the conduct of BERF research studies, received a Very Satisfactory rating in feedback and client satisfaction for the provided TA, and identified areas for improvement based on the TA feedbcak report.",
                    4: "Provided TA to the schools in the conduct of BERF research studies and received a Very Satisfactory rating in feedback and client satisfaction for the provided TA.",
                    3: "Provided TA to the schools in the conduct of BERF research studies.",
                    2: "Responded to questions pertaining to the planned technical assistance.",
                    1: "Issued a memorandum or notice delineating the timetable for technical assistance through the Planning and Research Section.",
                },
                "efficiency": {
                    5: "7 of the schools and learning centers",
                    4: "6 of the schools and learning centers",
                    3: "5 of the schools and learning centers",
                    2: "4 of the schools and learning centers",
                    1: "3 of the schools and learning centers",
                },
            },
        },
    ]},
    {"part": IRC8A_PART_A, "text": "Community Level Linkages and Partnerships", "weight": 6, "objectives": [
        {
            "text": "A. Capacitated at least 86% of the schools in forging partnerships and linkages.",
            "weight": 2,
            "indicators": {
                "quality": {
                    5: "Capacitated the schools in forging partnerships and linkages, obtained a Very Satisfactory rating, and identified areas for improvement based on the TA feedback results",
                    4: "Capacitated the schools in forging partnerships and linkages and obtained a Very Satisfactory rating based on the TA feedback results.",
                    3: "Capacitated the schools in forging partnerships and linkages.",
                    2: "Prepared, presented, and checked program proposal.",
                    1: "Conducted needs assessment to ASP/BE coordinators.",
                },
                "efficiency": {
                    5: "96-100% (64-67) of the schools and learning centers",
                    4: "91-95% (60-63) of the schools and learning centers",
                    3: "86-90% (57-59) of the schools and learning centers",
                    2: "81-85% (54-56) of the schools and learning centers",
                    1: "80% and below (53 & below) of the schools and learning centers",
                },
            },
        },
        {
            "text": "B. Established and/or strengthened linkages, engagements, and partnerships with at least 5 stakeholders to ensure continuous support for basic education.",
            "weight": 2,
            "indicators": {
                "quality": {
                    5: "Established and/or strengthened linkages, engagements, recognized partnerships, signed MOAs/MOUs, updated the partnership progress monitoring chart, and recognized their valuable contributions to ensure continuous support for basic education.",
                    4: "Established and/or strengthened linkages, engagements, and recognized partnerships to ensure continuous support for basic education.",
                    3: "Established and/or strengthened linkages, engagements, and partnerships to ensure continuous support for basic education.",
                    2: "Conducted stakeholders mapping.",
                    1: "Identified needs of schools and learning center.",
                },
                "efficiency": {
                    5: "7 stakeholders",
                    4: "6 stakeholders",
                    3: "5 stakeholders",
                    2: "4 stakeholders",
                    1: "3 stakeholders",
                },
                "timeliness": {
                    5: "Reports are updated 1-2 days after the MOA signing",
                    4: "Reports are updated 3-4 working days after the MOA signing",
                    3: "Reports are updated 5-6 working days after the MOA signing",
                    2: "Reports are updated 7-8 working days after the MOA signing",
                    1: "Reports are updated 9-10 working days after the MOA signing",
                },
            },
        },
        {
            "text": "C. Accepted donations from program/project partners for proper utilization and benefitted at least 86% of the schools.",
            "weight": 2,
            "indicators": {
                "quality": {
                    5: "Accepted donations from program/project partners for proper utilization, issued a Deed of Donation (DOD), and recognized their valuable contributions.",
                    4: "Accepted donations from program/project partners for proper utilization and issued a Deed of Donation.",
                    3: "Accepted donations from program/project partners for proper utilization.",
                    2: "Performed stakeholders mapping.",
                    1: "Identified needs of schools and learning center.",
                },
                "efficiency": {
                    5: "96-100% (64-67) of the schools and learning centers benefitted",
                    4: "91-95% (60-63) of the schools and learning centers benefitted",
                    3: "86-90% (57-59) of the schools and learning centers benefitted",
                    2: "81-85% (54-56) of the schools and learning centers benefitted",
                    1: "80% and below (53 & below) of the schools and learning centers benefitted",
                },
            },
        },
    ]},
    {"part": IRC8A_PART_A, "text": "Human Resource Development", "weight": 8, "objectives": [
        {
            "text": "A. Provided strategic direction in operationalizing the HRD system in the SDO and schools ensuring that at least 86% of the approved training plans followed the L&D guidelines and NEAP standards.",
            "weight": 2,
            "indicators": {
                "quality": {
                    5: "Provided strategic direction in operationalizing the HRD system ensuring that the approved training plans followed the L&D guidelines and NEAP standards, offered technical assistance in the SDO and schools, and achieved a TA feedback rating of \"Very Satisfactory.\"",
                    4: "Provided strategic direction in operationalizing the HRD system ensuring that the approved training plans followed the L&D guidelines and NEAP standards, and offered technical assistacne to schools and learning center.",
                    3: "Provided strategic direction in operationalizing the HRD system in the SDO and schools ensuring that the approved training plans followed the L&D guidelines and NEAP standards.",
                    2: "Developed and finalized the HRD Plan/system.",
                    1: "Identified and consolidated the HRD/Teachers' professional needs.",
                },
                "efficiency": {
                    5: "96-100% of the approved training plans followed the L&D guidelines and NEAP standards.",
                    4: "91-95% of the approved training plans followed the L&D guidelines and NEAP standards.",
                    3: "86-90% of the approved training plans followed the L&D guidelines and NEAP standards.",
                    2: "81-85% of the approved training plans followed the L&D guidelines and NEAP standards.",
                    1: "80% and below of the approved training plans followed the L&D guidelines and NEAP standards.",
                },
            },
        },
        {
            "text": "B. Established and managed at least 3 rewards and recognition system and activities in collaboration with Personnel Section.",
            "weight": 2,
            "indicators": {
                "quality": {
                    5: "Established and managed rewards and recognition system and activities in collaboration with the Personnel Section, attained M&E results of 'Strongly Agree.\" and suggested solutions to the identified areas for improvement.",
                    4: "Established and managed rewards and recognition system and activities in collaboration with the Personnel Section and attained M&E results of 'Strongly Agree.\"",
                    3: "Established and managed rewards and recognition system and activities in collaboration with the Personnel Section.",
                    2: "Convened meetings to address program details and areas for improvement.",
                    1: "Collected and assessed M&E reports to facilitate ongoing enhancements.",
                },
                "efficiency": {
                    5: "5 R&R activities",
                    4: "4 R&R activities",
                    3: "3 R&R activities",
                    2: "2 R&R activities",
                    1: "1 R&R activity",
                },
            },
        },
        {
            "text": "C. Designed, developed and implemented timely, relevant, and responsive Professional Development Programs intended to meet the competency need of at least 86% of the teaching and related teaching, and non-teaching personnel in the schools/Division Office with Post Program Report submitted 3 weeks after the activity.",
            "weight": 2,
            "indicators": {
                "quality": {
                    5: "Designed, developed and implemented timely, relevant, and responsive Professional Development Programs intended to meet the competency needs of the teaching and related teaching, and non-teaching personnel in the schools/Division Office, achieved \"Strongly Agree\" results in Monitoring and Evaluation, and submitted Post Program Report to SDS for documentation and liquidation purposes.",
                    4: "Designed, developed and implemented timely, relevant, and responsive Professional Development Programs intended to meet the competency needs of the teaching and related teaching, and non-teaching personnel in the schools/Division Office, and achieved \"Strongly Agree\" results in Monitoring and Evaluation.",
                    3: "Designed, developed and implemented timely, relevant, and responsive Professional Development Programs intended to meet the competency needs of the teaching and related teaching, and non-teaching personnel in the schools/Division Office.",
                    2: "Identified priority professional and competency needs of the teaching, teaching-related, and non-teaching personnel in schools/Division Office",
                    1: "Gathered, consolidated, and analyzed reports.",
                },
                "efficiency": {
                    5: "96-100% (64-67) of the teaching and related teaching, and non-teaching personnel in the schools/Division Office.",
                    4: "91-95% (60-63) of the teaching and related teaching, and non-teaching personnel in the schools/Division Office.",
                    3: "86-90% (57-59) of the teaching and related teaching, and non-teaching personnel in the schools/Division Office.",
                    2: "81-85% (54-56) of the teaching and related teaching, and non-teaching personnel in the schools/Division Office.",
                    1: "80% and below (53 & below) of the teaching and related teaching, and non-teaching personnel in the schools/Division Office.",
                },
                "timeliness": {
                    5: "Post Program Report was submitted 1 week after the activity.",
                    4: "Post Program Report was submitted 2 weeks after the activity.",
                    3: "Post Program Report was submitted 3 weeks after the activity.",
                    2: "Post Program Report was submitted 4 weeks after the activity.",
                    1: "Post Program Report was submitted 5 weeks after the activity.",
                },
            },
        },
        {
            "text": "D. Assisted the SDO Units/functional divisions, and at least 86% of the schools in the development/ implementation of a Performance Management monitoring and evaluation mechanism.",
            "weight": 2,
            "indicators": {
                "quality": {
                    5: "Assisted the SDO Units/functional divisions, and schools in the development/implementation of a Performance Management monitoring and evaluation mechanism, and conducted coaching or feedback sessions.",
                    4: "Assisted the SDO Units/functional divisions, and schools in the development/implementation of a Performance Management monitoring and evaluation mechanism.",
                    3: "Assisted the SDO Units/functional divisions, and schools in the development/implementation of a Performance Management monitoring and evaluation mechanism.",
                    2: "Identified areas requiring improvement or priority needs.",
                    1: "Collected, consolidated, and examined performance reports.",
                },
                "efficiency": {
                    5: "96-100% (64-67) of the schools and learning centers",
                    4: "91-95% (60-63) of the schools and learning centers",
                    3: "86-90% (57-59) of the schools and learning centers",
                    2: "81-85% (54-56) of the schools and learning centers",
                    1: "80% and below (53 & below) of the schools and learning centers",
                },
            },
        },
    ]},
    {"part": IRC8A_PART_A, "text": "Quality Assurance", "weight": 18, "objectives": [
        {
            "text": "A. Led in ensuring the completeness of documents pertinent to application in the operation/establishment/ conversion/closure of at least 86% of the private schools.",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Led in ensuring the completeness of documents pertinent to application in the operation/establishment/ conversion/closure of the private schools, obtained a \"Very Satisfied\" TA rating, and submitted the documents to the SDS for signature and endorsement to the Regional Office.",
                    4: "Led in ensuring the completeness of documents pertinent to application in the operation/establishment/ conversion/closure of the private schools, and obtained TA rating of \"Very Satisfied.\"",
                    3: "Led in ensuring the completeness of documents pertinent to application in the operation/establishment/ conversion/closure of the private schools.",
                    2: "Recorded received documents.",
                    1: "Received documents from private schools.",
                },
                "efficiency": {
                    5: "21-25 of the private schools had their documents officially approved and endorsed.",
                    4: "16-20 of the private schools had their documents officially approved and endorsed.",
                    3: "11-15 of the private schools had their documents officially approved and endorsed.",
                    2: "6-10 of the private schools had their documents officially approved and endorsed.",
                    1: "5 and below of the private schools had their documents officially approved and endorsed.",
                },
            },
        },
        {
            "text": "B. Ensured access of at least 86% of the schools to adequate, disaster resilient and safe buildings and ground facilities compliant to the prescribed standards within the deadline.",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Ensured access of the schools to adequate, disaster resilient and safe buildings and ground facilities compliant to the prescribed standards and attained an evaluation results of \"Highly Evident\", and submitted Accomplishment Report.",
                    4: "Ensured access of the schools to adequate, disaster resilient and safe buildings and ground facilities compliant to the prescribed standards and attained an evaluation results of \"Highly Evident.\"",
                    3: "Ensured access of the schools to adequate, disaster resilient and safe buildings and ground facilities compliant to the prescribed standards.",
                    2: "Prepared and submitted report with analysis",
                    1: "Developed a monitoring tool and performed on-site inspections in schools.",
                },
                "efficiency": {
                    5: "96-100% (64-67) of the schools and learning centers are compliant to the prescribed standards.",
                    4: "91-95% (60-63) of the schools and learning centers are compliant to the prescribed standards.",
                    3: "86-90% (57-59) of the schools and learning centers are compliant to the prescribed standards.",
                    2: "81-85% (54-56) of the schools and learning centers are compliant to the prescribed standards.",
                    1: "80% and below (53 & below) of the schools and learning centers are compliant to the prescribed standards.",
                },
                "timeliness": {
                    5: "5 days before the deadline",
                    4: "7 days before the deadline",
                    3: "within the deadline",
                    2: "5 days beyond the deadline",
                    1: "7 days or more beyond the deadline",
                },
            },
        },
        {
            "text": "C. Quality assured at least 3 of the learning and development programs implemented.",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Quality assured the learning and development programs implemented, presented to the program owner the evaluation results during Post-Program Evaluation Meeting, provides recommendations for the improvement of the program, and uploaded Post Program Report in the Data Mngt, System for record keeping and further analysis.",
                    4: "Quality assured the learning and development programs implemented, and presented to the program owner the evaluation results during Post-Program Evaluation Meeting.",
                    3: "Quality assured the learning and development programs implemented.",
                    2: "Discussed with the program owner the proposed QAME tool for the activity.",
                    1: "Gathered and analyzed activity proposals and Division Memo.",
                },
                "efficiency": {
                    5: "5 L&D programs were quality assured.",
                    4: "4 L&D programs were quality assured.",
                    3: "3 L&D programs were quality assured.",
                    2: "2 L&D programs were quality assured.",
                    1: "1 L&D program was quality assured.",
                },
            },
        },
        {
            "text": "D. Ensured the continuous improvement of at least 71% of the schools and learning centers thru School-Based Management (SBM)/School Governance Council (SGC).",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Ensured the continuous improvement of the schools and learning centers through School-Based Management (SBM)/School Governance Council (SGC), and conducted ocular inspection to conducted visual inspections to offer essential technical support, and received a TA feedback rating of 'Very Satisfied.\"",
                    4: "Ensured the continuous improvement of the schools and learning centers through School-Based Management (SBM)/School Governance Council (SGC), and conducted ocular inspection to conducted visual inspections to offer essential technical support.",
                    3: "Ensured the continuous improvement of the schools and learning centers through School-Based Management (SBM)/School Governance Council (SGC).",
                    2: "Gathered, consolidated, and analyzed data/reports.",
                    1: "Released a memorandum in determining the SGC status of schools.",
                },
                "efficiency": {
                    5: "91-100% (20-23) of the secondary schools provided with TA on SBM/SGC.",
                    4: "81-90% (18-19) of the secondary schools provided with TA on SBM/SGC.",
                    3: "71-80% (16-17) of the secondary schools provided with TA on SBM/SGC.",
                    2: "61-70% (14-15) of the secondary schools provided with TA on SBM/SGC.",
                    1: "60% and below (11 & below) of the secondary schools provided with TA on SBM/SGC.",
                },
            },
        },
        {
            "text": "E. Utilized/enhanced existing tools and develop new tools to monitor and evaluate the implementation of at least 86% of the approved PPAs properly.",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Utilized/enhanced existing tools and develop new tools to monitor and evaluate the implementation of the approved PPAs properly, and presented the results, along with recommendations, to the program owners.",
                    4: "Utilized/enhanced existing tools and develop new tools to monitor and evaluate the implementation of the approved PPAs properly with the results presented to the program owners.",
                    3: "Utilized/enhanced existing tools and develop new tools to monitor and evaluate the implementation of the approved PPAs properly.",
                    2: "Developed M&E Tool through the School Management Monitoring & Evaluation Section and in collaboration with the program owner.",
                    1: "Prepared and submitted M&E Plan for major PAPs.",
                },
                "efficiency": {
                    5: "96-100% (26-27) of the PPAs with M&E tools",
                    4: "91-94% (24-25) of the PPAs with M&E tools",
                    3: "86-90% (22-23) of the PPAs with M&E tools",
                    2: "81-85% (20-21) of the PPAs with M&E tools",
                    1: "80% (19) and below of the PPAs with M&E tools",
                },
            },
        },
        {
            "text": "F. Analyzed M&E result of at least 86% of SGOD PPAs (based on PMIS) for appropriate intervention 7 days following the conclusion of the program.",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Analyzed M&E results of SGOD PAPs (based on PMIS), identified implementation issues or challenges for appropriate intervention, and submitted action/catch-up plan.",
                    4: "Analyzed M&E results of SGOD PAPs (based on PMIS), and listed implementation issues/challenges for appropriate intervention.",
                    3: "Analyzed M&E results of SGOD PAPs (based on PMIS) for appropriate intervention.",
                    2: "Conducted Post-Program Evaluation Meeting",
                    1: "Gathered and consolidated M&E results.",
                },
                "efficiency": {
                    5: "96-100% (26-27) of the PPAs with M&E analysis",
                    4: "91-94% (24-25) of the PPAs with M&E analysis",
                    3: "86-90% (22-23) of the PPAs with M&E analysis",
                    2: "81-85% (20-21) of the PPAs with M&E analysis",
                    1: "80% (19) and below of the PPAs with M&E analysis",
                },
                "timeliness": {
                    5: "1 week after the conclusion of the program",
                    4: "2 weeks after the conclusion of the program",
                    3: "3 weeks after the conclusion of the program",
                    2: "4 weeks after the conclusion of the program",
                    1: "5 weeks or more after the conclusion of the program",
                },
            },
        },
    ]},
    {"part": IRC8A_PART_A, "text": "Provision of Technical Assistance", "weight": 9, "objectives": [
        {
            "text": "A. Provided technical assistance to at least 86% of the DEDP priority schools and learning centers in relation to governance and operations 7 days after each month.",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Provided technical assistance to DEDP priority schools and learning centers in relation to governance and operations, attained overall TA feedback rating of \"Very Satisfactory\", updated the IRC, and submitted TA feedback results every 1 week after each month.",
                    4: "Provided technical assistance to DEDP priority schools and learning centers in relation to governance and operations, and attained overall TA feedback rating of \"Very Satisfactory.\"",
                    3: "Provided technical assistance to DEDP priority schools and learning centers in relation to governance and operations, and attained a TA feedback rating of \"Satisfactory\".",
                    2: "Identified needs of schools related to special programs , governance and operation.",
                    1: "Collected reports from schools.",
                },
                "efficiency": {
                    5: "96-100% (26) of the DEDP priority schools",
                    4: "91-95% (24-25) of the DEDP priority schools",
                    3: "86-90% (23) of the DEDP priority schools",
                    2: "81-85% (21-22) of the DEDP priority schools",
                    1: "80% and below (20 & below) of the DEDP priority schools",
                },
                "timeliness": {
                    5: "5 days after each month",
                    4: "6 days after each month",
                    3: "7 days after each month",
                    2: "8 days after each month",
                    1: "9 days after each month",
                },
            },
        },
        {
            "text": "B. Provided follow-up technical assistance to at least 86% of the DEDP priority schools and learning centers in relation to governance and operations 7 days after each month.",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Provided follow-up technical assistance to DEDP priority schools and learning centers in relation to governance and operations, attained overall TA feedback rating of \"Very Satisfactory\", updated the IRC, and submitted TA feedback results.",
                    4: "Provided follow-up technical assistance to DEDP priority schools and learning centers in relation to governance and operations, and attained overall TA feedback rating of \"Very Satisfactory.\"",
                    3: "Provided follow-up technical assistance to DEDP priority schools and learning centers in relation to governance and operations, and attained a TA feedback rating of \"Satisfactory\".",
                    2: "Identified needs of schools related to special programs , governance and operation.",
                    1: "Collected reports from schools.",
                },
                "efficiency": {
                    5: "96-100% (26) of the DEDP priority schools",
                    4: "91-95% (24-25) of the DEDP priority schools",
                    3: "86-90% (23) of the DEDP priority schools",
                    2: "81-85% (21-22) of the DEDP priority schools",
                    1: "80% and below (20 & below) of the DEDP priority schools",
                },
                "timeliness": {
                    5: "5 days after each month",
                    4: "6 days after each month",
                    3: "7 days after each month",
                    2: "8 days after each month",
                    1: "9 days after each month",
                },
            },
        },
        {
            "text": "C. Provided technical assistance to at least 86% of the non-DEDP priority schools and learning centers in relation to governance and operations 7 days after each month.",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Provided technical assistance to Non-DEDP priority schools and learning centers in relation to governance and operations, attained overall TA feedback rating of \"Very Satisfactory\", updated the IRC, and submitted TA feedback results every 1 week after each month.",
                    4: "Provided technical assistance to Non-DEDP priority schools and learning centers in relation to governance and operations, and attained overall TA feedback rating of \"Very Satisfactory.\"",
                    3: "Provided technical assistance to Non-DEDP priority schools and learning centers in relation to governance and operations, and attained a TA feedback rating of \"Satisfactory\".",
                    2: "Identified needs of schools related to special programs , governance and operation.",
                    1: "Collected reports from schools.",
                },
                "efficiency": {
                    5: "96-100% (39-41) of the Non-DEDP priority schools",
                    4: "91-95% (37-38) of the Non-DEDP priority schools",
                    3: "86-90% (35-36) of the Non-DEDP priority schools",
                    2: "81-85% (33-34) of the Non-DEDP priority schools",
                    1: "80% and below (32 & below) of the Non-DEDP priority schools",
                },
                "timeliness": {
                    5: "5 days after each month",
                    4: "6 days after each month",
                    3: "7 days after each month",
                    2: "8 days after each month",
                    1: "9 days after each month",
                },
            },
        },
    ]},
    {"part": IRC8A_PART_A, "text": "Office Administration and Performance Management", "weight": 7, "objectives": [
        {
            "text": "A. Established and maintained systems and processes geared towards administrative effectiveness and efficiency of at least 86% of the SGOD PPAs within the deadline.",
            "weight": 2,
            "indicators": {
                "quality": {
                    5: "Established and maintained systems and processes geared towards administrative effectiveness and efficiency of the SGOD PAPs, accomplished and submitted all required pertinent forms and documents accurately and timely.",
                    4: "Established and maintained systems and processes geared towards administrative effectiveness and efficiency of the SGOD PAPs, and accomplished all required pertinent forms and documents accurately.",
                    3: "Established and maintained systems and processes geared towards administrative effectiveness and efficiency of the SGOD PAPs.",
                    2: "Identified needs of schools related to special programs , governance and operation.",
                    1: "Collected reports from schools.",
                },
                "efficiency": {
                    5: "96-100% (26-27) of SGOD PAPs",
                    4: "91-95% (24-25) of SGOD PAPs",
                    3: "86-90% (22-23) of SGOD PAPs",
                    2: "81-85% (20-21) of SGOD PAPs",
                    1: "80% (19) and below of SGOD PAPs",
                },
                "timeliness": {
                    5: "5 days before the deadline",
                    4: "3 days before the deadline",
                    3: "within the deadline",
                    2: "3 days beyond the deadline",
                    1: "5 days or more beyond the deadline",
                },
            },
        },
        {
            "text": "B. Promoted a culture of excellence, innovation, and collaboration through rewards and recognition, and received at least 6 monthly customers feedback ratings within the year.",
            "weight": 2,
            "indicators": {
                "quality": {
                    5: "Promoted a culture of excellence, innovation, and collaboration, attained \"Very Satisfied\" customer feedback results, and provided corrective actions on identified issues (if any).",
                    4: "Promoted a culture of excellence, innovation, and collaboration, and attained \"Very Satisfied\" customer feedback results.",
                    3: "Promoted a culture of excellence, innovation, and collaboration through rewards and recognition.",
                    2: "Computed and shared monthly summary customer feedback results.",
                    1: "Gathered and consolidated customers feedback results.",
                },
                "efficiency": {
                    5: "11-12 customers feedback ratings",
                    4: "8-10 customers feedback ratings",
                    3: "6-7 customers feedback ratings",
                    2: "3-5 customers feedback ratings",
                    1: "1-2 customers feedback ratings",
                },
            },
        },
        {
            "text": "C. Conducted periodic monitoring and evaluation of at least 86% of the office/staff performance for the provision of relevant learning and development programs and submitted to ASDS for signature 3 weeks following the conclusion of the Year-End Performance",
            "weight": 3,
            "indicators": {
                "quality": {
                    5: "Conducted periodic monitoring and evaluation of the office/staff performance, coaching for the provision of relevant learning and development programs, and compiled corrected IPCRF with proper label and arrangements and submitted to ASDS for signature.",
                    4: "Conducted periodic monitoring and evaluation of the office/staff performance, and coaching for the provision of relevant learning and development programs.",
                    3: "Conducted periodic monitoring and evaluation of the office/staff performance for the provision of relevant learning and development programs.",
                    2: "Prepared and provided presentation template",
                    1: "Issued a memorandum regarding the conduct of the Performance Appraisal Feedback and Rating",
                },
                "efficiency": {
                    5: "96-100% (25-26) of the SGOD Kapamilya have undergone the performance management cycle.",
                    4: "91-95% (23-24) of the SGOD Kapamilya have undergone the performance management cycle.",
                    3: "86-90% (22) of the SGOD Kapamilya have undergone the performance management cycle.",
                    2: "81-85% (21) of the SGOD Kapamilya have undergone the performance management cycle.",
                    1: "80% (20) and below of the SGOD Kapamilya have undergone the performance management cycle.",
                },
                "timeliness": {
                    5: "Signed PCRFs submitted 1 week after the conclusion of the Year-End Performance Evaluation.",
                    4: "Signed PCRFs submitted 2 weeks after the conclusion of the Year-End Performance Evaluation.",
                    3: "Signed PCRFs submitted 3 weeks after the conclusion of the Year-End Performance Evaluation.",
                    2: "Signed PCRFs submitted 4 weeks after the conclusion of the Year-End Performance Evaluation.",
                    1: "Signed PCRFs submitted 5 weeks after the conclusion of the Year-End Performance Evaluation.",
                },
            },
        },
    ]},
    {"part": IRC8A_PART_C, "text": "Financial Stewardship", "weight": 5, "objectives": [
        {
            "text": "Utilized 98% of the budget allocation in accordance with the quarterly disbursement program with no overdraft/deficit/disallowance from oversight agency/ies",
            "weight": 5,
            "indicators": {
                "quality": {
                    5: "Budget allocation disbursed within the reglementary period with no overdraft/deficit/disallowance from oversight agency/ies",
                    4: "Budget allocation disbursed within the reglementary period with 1-2 overdraft/deficit/disallowance from oversight agency/ies",
                    3: "Budget allocation disbursed within the reglementary period with 3-4 overdraft/deficit/disallowance from oversight agency/ies",
                    2: "Budget allocation disbursed within the reglementary period with 5-6 overdraft/deficit/disallowance from oversight agency/ies",
                    1: "Budget allocation disbursed within the reglementary period with 7 or more overdraft/deficit/disallowance from oversight agency/ies",
                },
                "efficiency": {
                    5: "Budget is utilized according to the BUR target, based on the official BUR report of the Finance Service/Section/Unit (i.e. 98% of the budget allocation is utilized within the FY)",
                    4: "Budget is utilized with 1-5% variance from BUR target, based on the official BUR report of the Finance Service/Section/Unit (i.e. 93-97% of the budget allocation is utilized within the FY)",
                    3: "Budget is utilized with 6-10% variance from BUR target, based on the official BUR report of the Finance Service/Section/Unit (i.e. 88-92% of the budget allocation is utilized within the FY)",
                    2: "Budget is utilized with 11-15% variance from BUR target, based on the official BUR report of the Finance Service/Section/Unit (i.e. 83-87% of the budget allocation is utilized within the FY)",
                    1: "Budget is utilized with more than 15% variance from BUR target, based on the official BUR report of the Finance Service/Section/Unit (i.e. Below 83% of the budget allocation is utilized within the FY)",
                },
                "timeliness": {
                    5: "Quarterly basis:\nBudget is utilized according to the quarterly disbursement program (i.e. 98% of the quarterly BUR target is utilized by the end of each quarter)",
                    4: "Quarterly basis:\nBudget is utilized with 1-5% variance from the quarterly disbursement program (i.e. 93-97% of the quarterly BUR target is utilized by the end of each quarter)",
                    3: "Quarterly basis:\nBudget is utilized with 6-10% variance from the quarterly disbursement program (i.e. 88-92% of the quarterly BUR target is utilized by the end of each quarter)",
                    2: "Quarterly basis:\nBudget is utilized with 11-15% variance from the quarterly disbursement program (i.e. 83-87% of the quarterly BUR target is utilized by the end of each quarter)",
                    1: "Quarterly basis:\nBudget is utilized with more than 15% variance from the quarterly disbursement program (i.e. Below 83% of the quarterly BUR target is utilized by the end of each quarter)",
                },
            },
        },
    ]},
    {"part": IRC8A_PART_C, "text": "Process improvement", "weight": 5, "objectives": [
        {
            "text": "Streamlined core processes and management of service provisioning of frontline and other office deliverables to ensure ease of transactions and/or digitalization/digitization",
            "weight": 5,
            "indicators": {
                "quality": {
                    5: "Improvements/reduction on all of the service standards\n1. no. of documentary requirements\n2. total processing time\n3. transaction cost\n4. client steps/agency action steps\n5. no. of signatories",
                    4: "Improvements/reduction on 4 service standards\n1. no. of documentary requirements\n2. total processing time\n3. transaction cost\n4. client steps/agency action steps\n5. no. of signatories",
                    3: "Improvements/reduction on 2-3 service standards\n1. no. of documentary requirements\n2. total processing time\n3. transaction cost\n4. client steps/agency action steps\n5. no. of signatories",
                    2: "Improvements/reduction on 1 service standards\n1. no. of documentary requirements\n2. total processing time\n3. transaction cost\n4. client steps/agency action steps\n5. no. of signatories",
                    1: "No change in no. of documentary requirements, total processing time, transaction cost, process steps, signatories",
                },
                "efficiency": {
                    5: "Streamlined and/or digitized all office core processes identified in the QMS planning documents",
                    4: "Streamlined and/or digitized 76-99% of the office core processes identified in the QMS planning documents",
                    3: "Streamlined and/or digitized 51-75% of the office core processes identified in the QMS planning documents",
                    2: "Streamlined and/or digitized 26-50% of the office core processes identified in the QMS planning documents",
                    1: "Streamlined and/or digitized 0-25% of the office core processes identified in the QMS planning documents",
                },
            },
        },
    ]},
    {"part": IRC8A_PART_C, "text": "Client Satisfaction", "weight": 5, "objectives": [
        {
            "text": "Achieved 100% resolution and compliance rate to #8888 and CCB complaints within the prescribed processing time (simple - 3 days; complex - 7 days; highly technical - 20 days) with at least Satisfactory overall average result on the Client Satisfaction Measurement",
            "weight": 5,
            "indicators": {
                "quality": {
                    5: "95.0% - 100% (Outstanding) overall average on the results of the Client Satisfaction Measurement (CSM)",
                    4: "90.9% - 94.9% (Very Satisfactory) overall average on the results of the CSM",
                    3: "80.0% - 89.9% (Satisfactory) overall average on the results of the CSM",
                    2: "60.0% - 79.9% (Fair) overall average on the results of the CSM",
                    1: "Below 60.0% (Poor) overall average on the results of the CSM",
                },
                "efficiency": {
                    5: "100% resolution and compliance rate to #8888 and CCB complaints",
                    4: "At least 80% resolution and compliance rate to #8888 and CCB complaints",
                    3: "At least 50% resolution and compliance rate to #8888 and CCB complaints",
                    2: "At least 1% resolution and compliance rate to #8888 and CCB complaints",
                    1: "0% resolution and compliance rate to #8888 and CCB complaints",
                },
                "timeliness": {
                    5: "Complaints acted upon and closed within prescribed processing time (simple - 3 days; complex - 7 days; highly technical - 20 days)",
                    3: "Complaints are acted upon and closed with documented delays based on the prescribed processing time (simple - 3 days; complex - 7 days; highly technical - 20 days)",
                    1: "No complaint acted upon and resolved",
                },
            },
        },
    ]},
]

# Guard against a transcription slip: Part I-A must total 60% and Part I-C 15%,
# and each KRA's weight must equal the sum of its objectives' weights.
for _kra in IRC8A_SEED_KRAS:
    assert _kra["weight"] == sum(o["weight"] for o in _kra["objectives"]), _kra["text"]
assert sum(k["weight"] for k in IRC8A_SEED_KRAS if k["part"] == IRC8A_PART_A) == 60
assert sum(k["weight"] for k in IRC8A_SEED_KRAS if k["part"] == IRC8A_PART_C) == 15

# ---------------------------------------------------------------------------
# Part I-A / I-C columns that sit beside the rubric on the OPCRF sheet but are
# not part of it: the per-KRA "Organizational Outcome Attribution" values
# (GAA Programs/Subprograms, BEDP Pillars, Reform Agenda) and each objective's
# Timeline, Performance Target (value + description) and listed MOVs. Several
# items in one cell are separated by a newline, as on the sheet.
# Indexed like IRC8A_SEED_KRAS (KRA index; KRA index + objective index) so
# the long seed list above stays untouched.
# ---------------------------------------------------------------------------
IRC8A_SEED_KRA_META = {
    0: {"gaa": "* Education Human Resource Development Program\n* Support to Schools and Learners Program",
        "bedp": "* Resilience & Well-being\n* Enabling Mechanism: Governance & Management",
        "agenda": "* Efficient & Supportive Governance Structure\n* Learners Physical & Mental Well-being Protected"},
    1: {"gaa": "* Education Policy Development Program\n*Basic Education Inputs Program\n* Support to Schools and Learners Program",
        "bedp": "* Access\n* Equity\n* Enabling Mechanism: Governance & Management",
        "agenda": "* Efficient & Supportive Governance Structure"},
    2: {"gaa": "* Support to Schools and Learners Program",
        "bedp": "* Enabling Mechanism: Governance & Management",
        "agenda": "* Efficient & Supportive Governance Structure"},
    3: {"gaa": "* Education Human Resource Development Program",
        "bedp": "* Enabling Mechanism: Governance & Management",
        "agenda": "* High Performing Teachers\n* High Quality of Education"},
    4: {"gaa": "* Education Policy Development Program\n*Basic Education Inputs Program\n* Inclusive Education Program\n* Education Human Resource Development Program\n* Support to Schools and Learners Program",
        "bedp": "* Access\n* Equity\n* Quality\n* Resilience & Well-being\n* Enabling Mechanism: Governance & Management",
        "agenda": "* Efficient & Supportive Governance Structure"},
    5: {"gaa": "* Support to Schools and Learners Program",
        "bedp": "* Enabling Mechanism: Governance & Management",
        "agenda": "* Efficient & Supportive Governance Structure"},
    6: {"gaa": "* Support to Schools and Learners Program",
        "bedp": "* Enabling Mechanism: Governance & Management",
        "agenda": "* Efficient & Supportive Governance Structure"},
}

IRC8A_SEED_OBJECTIVE_META = {
    (0, 0): {"value": "86%",
             "desc": "Implementation rate of approved needs-based capacity-building activities for different job groups",
             "timeline": "January to December 2026",
             "mov": "Signed copies of Project Proposals\nSigned Memos\nSigned Post Program Narrative & Pictorial Reports\nQuarterly Accomplishment Report"},
    (0, 1): {"value": "23,000",
             "desc": "Number of learners benefitting from the School-Based Feeding Program",
             "timeline": "January to December 2026",
             "mov": "Signed copies of Project Proposals\nSigned Memos\nSigned Post Program Narrative & Pictorial Reports\nQuarterly Accomplishment Report"},
    (1, 0): {"value": "86%",
             "desc": "Percentage of AIP activities implemented in schools and learning centers.",
             "timeline": "January to December 2026",
             "mov": "Copy of the Approved DEDP\nSigned Memos\nSigned Post Program Narrative & Pictorial Reports\nQuarterly Accomplishment Report"},
    (1, 1): {"value": "86%",
             "desc": "Percentage of public schools meeting the standard ratio for teachers",
             "timeline": "January to December 2026",
             "mov": "Validated and processed basic education statistics\nForwarded Estimates\nValidated BEIS/School Profile"},
    (1, 2): {"value": "57",
             "desc": "Number of proposed policies reviewed",
             "timeline": "January to December 2026",
             "mov": "Online TA Feedback Results\nQuarterly Accomplishment Report\nList of Research Proposals in the Division Registry\nList of Completed Researches in the Division Registry"},
    (1, 3): {"value": "5",
             "desc": "Number of education researches completed",
             "timeline": "January to December 2026",
             "mov": "Online TA Feedback Results\nQuarterly Accomplishment Report\nList of Research Proposals in the Division Registry\nList of Completed Researches in the Division Registry"},
    (2, 0): {"value": "86%",
             "desc": "Percentage of schools provided with capacity building activities and technical assistance",
             "timeline": "January to December 2026",
             "mov": "Online TA Feedback Results\nSigned Memos\nSigned Post Program Narrative & Pictorial Reports\nQuarterly Accomplishment Report"},
    (2, 1): {"value": "5",
             "desc": "Number of established partnerships",
             "timeline": "January to December 2026",
             "mov": "Signed copies of MOA/MOU\nQuarterly Accomplishment Report\nSGOD Dashboard\nPartnership Progress Monitoring Chart\nDepEd Partnership Database System (DPDS) Results"},
    (2, 2): {"value": "57",
             "desc": "Number of schools that received donations based on the DPDS.",
             "timeline": "January to December 2026",
             "mov": "Signed DODs/DOAs\nQuarterly Accomplishment Report\nPartnership Progress Monitoring Chart\nDepEd Partnership Database System (DPDS) Results"},
    (3, 0): {"value": "5",
             "desc": "Number of conducted division/ school- initiated trainings",
             "timeline": "January to December 2026",
             "mov": "Signed Human Resource Development Plan\nSigned HRD Consolidated Needs\nApproved Training Proposals\nActivity/Program Completion Report\nApproved Learning and Development Need Assessment (LDNA)\nEstablished pool of SDO and School Learning Facilitators"},
    (3, 1): {"value": "3",
             "desc": "Number of activities relative to reward and recognition managed/ implemented",
             "timeline": "January to December 2026",
             "mov": "Policy Guidelines\nDivision Memorandum\nMinutes of the Meeting\nPost Program Evaluation Report\nQuarterly Accomplishment Report"},
    (3, 2): {"value": "1,928",
             "desc": "Number of public school teachers, teaching-related, and non-teaching personnel trained",
             "timeline": "January to December 2026",
             "mov": "Training Needs Assessment\nNeeds assessment result of the teaching personnel in the SDO based on the Electronic Self-Assessment Tool (eSAT)\nSummary of the Individual Development Plan (IDP) of the teaching, teaching-related and non-teaching personnel in the SDO"},
    (3, 3): {"value": "57",
             "desc": "Number of personnel coached",
             "timeline": "January to December 2026",
             "mov": "OPCRF/IPCRF\nPerformance Coaching & Monitoring Form"},
    (4, 0): {"value": "11",
             "desc": "Number of private schools/ TVI/ non-DepEd schools endorsed for Special Order",
             "timeline": "January to December 2026",
             "mov": "Directory/List of schools with complete documentary requirements based on the type of request applied\nDirectory of Private Schools with Status as to permit/recognition\nList of newly established/renamed/ converted/closed public and private schools\nAttestations\nSpecial Order"},
    (4, 1): {"value": "57",
             "desc": "Number of schools with adequate, disaster resilient and safe buildings",
             "timeline": "January to December 2026",
             "mov": "Report on safety school buildings and ground facilities in partnership with the LGU\nQuarterly Accomplishment Report\nInventory of Buildings/School building"},
    (4, 2): {"value": "3",
             "desc": "Number of accomplished and implemented QAME tools",
             "timeline": "January to December 2026",
             "mov": "QAME Plan and Reports\nAccomplished QAME tools per activity with analysis\nQuality Assurance Team (QAT) Meetings (Pictures)"},
    (4, 3): {"value": "16",
             "desc": "Number of technical assistance provided based on SBM/SGC.",
             "timeline": "January to December 2026",
             "mov": "Report on SGC Functionality/SBM Level of Manifestation\nMemoranda\nPictures\nQuarterly Accomplishment Report"},
    (4, 4): {"value": "22",
             "desc": "Number of M&E Plans and Reports submitted",
             "timeline": "January to December 2026",
             "mov": "M&E tools/instrument\nM&E Plans and Reports"},
    (4, 5): {"value": "22",
             "desc": "Number of consolidated findings and recommendations submitted",
             "timeline": "January to December 2026",
             "mov": "Quarterly PIRPA Report\nPost Program Evaluation Meetings (Pictures)\nM&E Plans and Reports"},
    (5, 0): {"value": "86%",
             "desc": "Percentage of DEDP priority schools provided with TA",
             "timeline": "January to December 2026",
             "mov": "Number of TA Provided to Schools (IRC)\nStatus Report on Schools Provided with TA (IRC)\nTA Progress Report (with analysis)-IRC\nOnline TA Feedback Results\nQuarterly Accomplishment Reports"},
    (5, 1): {"value": "86%",
             "desc": "Percentage of DEDP priority schools provided with follow-up TA",
             "timeline": "January to December 2026",
             "mov": "Number of TA Provided to Schools (IRC)\nStatus Report on Schools Provided with TA (IRC)\nTA Progress Report (with analysis)-IRC\nOnline TA Feedback Results\nQuarterly Accomplishment Reports"},
    (5, 2): {"value": "86%",
             "desc": "Percentage of non-DEDP priority schools provided with follow-up TA",
             "timeline": "January to December 2026",
             "mov": "TA Progress Report (with analysis)-IRC\nSGOD Dashboard\nOnline TA Feedback Results\nQuarterly Accomplishment Reports"},
    (6, 0): {"value": "86%",
             "desc": "Percentage of pertinent forms and documents accomplished and submitted on time",
             "timeline": "January to December 2026",
             "mov": "SGOD Dashboard\nProgram Implementation Review Results\nIndividual Report Card (IRC)"},
    (6, 1): {"value": "Very Satisfied",
             "desc": "CCSS rating received",
             "timeline": "January to December 2026",
             "mov": "Monthly Customer Feedback Results"},
    (6, 2): {"value": "2",
             "desc": "Number of Performance reviews/evaluation conducted",
             "timeline": "June & December 2026",
             "mov": "Signed Copies of IPCRF and PMCF\nSigned Division Memo on Mid-Year Performance Review\nSigned Copy of Memo on Year-End Performance Evaluation\nSigned Copies of Final IPCRF\nPictures"},
    (7, 0): {"timeline": "Within the rating period",
             "mov": "Quarterly Accomplishment Reports"},
    (8, 0): {"timeline": "Within the rating period",
             "mov": "Citizen’s Charter\nSGOD Operations Manual\nMonthly Customer Feedback Results"},
    (9, 0): {"timeline": "Within the rating period",
             "mov": "Monthly Customer Feedback Results"},
}


def _apply_kra_meta(kra, kra_index):
    meta = IRC8A_SEED_KRA_META.get(kra_index, {})
    kra.gaa_program = meta.get("gaa")
    kra.bedp_pillars = meta.get("bedp")
    kra.admin_agenda = meta.get("agenda")


def _apply_objective_meta(objective, kra_index, obj_index):
    meta = IRC8A_SEED_OBJECTIVE_META.get((kra_index, obj_index), {})
    objective.target_value = meta.get("value")
    objective.target_description = meta.get("desc")
    objective.mov_required = meta.get("mov")
    # The Timeline printed on the form is only a starting value: once the
    # rater has typed their own, a re-sync never overwrites it.
    if not (objective.timeline or "").strip():
        objective.timeline = meta.get("timeline")


def _seed_shape_matches(locked_kras):
    """True when the locked KRAs already in the database have the same
    structure (KRA count, part, and objectives per KRA) as IRC8A_SEED_KRAS."""
    if len(locked_kras) != len(IRC8A_SEED_KRAS):
        return False
    for kra, kra_seed in zip(locked_kras, IRC8A_SEED_KRAS):
        if kra.part != kra_seed["part"] or len(kra.objectives) != len(kra_seed["objectives"]):
            return False
    return True


# Years already synced in this process, so the (cheap but non-zero) sync
# below runs once per year per server start instead of on every request.
_IRC8A_SYNCED_YEARS = set()


def _sync_indicators(objective, indicators_seed):
    """Makes `objective`'s rubric indicators exactly match the seed. Only ever
    called for locked (Part I-A / I-C) objectives, whose indicators the UI
    can't edit. Ratings are stored on the objective itself, so changing an
    indicator's label never touches a rater's selected rating."""
    wanted = {
        (cat, rate): label
        for cat, levels in indicators_seed.items()
        for rate, label in levels.items()
    }
    existing = {(i.category, i.rate): i for i in objective.indicators}
    for key, indicator in existing.items():
        if key not in wanted:
            db.session.delete(indicator)
    for (cat, rate), label in wanted.items():
        indicator = existing.get((cat, rate))
        if indicator is None:
            db.session.add(IRC8AIndicator(
                objective_id=objective.id, category=cat, rate=rate, label=label,
            ))
        elif indicator.label != label:
            indicator.label = label


def seed_irc8a_defaults(year):
    """Creates -- or brings up to date -- the fixed Part I-A / Part I-C
    KRA + Objective + rubric-indicator skeleton for a year.

    Idempotent and non-destructive: existing locked KRAs/objectives are
    matched by position and only their text / weight / rubric indicators
    are corrected to the PDF. Ratings, MOV links, actual results and
    timeline entered by the rater are never touched. Runs once per year per
    process (see _IRC8A_SYNCED_YEARS).
    """
    if year in _IRC8A_SYNCED_YEARS:
        return

    locked_kras = (
        IRC8AKra.query
        .filter(IRC8AKra.year == year, IRC8AKra.part != IRC8A_PART_B)
        .order_by(IRC8AKra.sort_order.asc(), IRC8AKra.id.asc())
        .all()
    )

    if locked_kras and not _seed_shape_matches(locked_kras):
        # The stored Part I-A / I-C structure is from a different edition of
        # the form (different KRAs / objectives). Its ratings belong to
        # objectives that no longer exist, so drop it and seed the form
        # fresh below. Part I-B KRAs (user-built) are never touched.
        for stale in locked_kras:
            db.session.delete(stale)
        db.session.commit()
        locked_kras = []

    if locked_kras:
        # Existing seed with the same shape (possibly from an older version
        # of this file) -- correct it in place.
        for kra_index, (kra, kra_seed) in enumerate(zip(locked_kras, IRC8A_SEED_KRAS)):
            kra.text = kra_seed["text"]
            kra.weight = kra_seed["weight"]
            kra.part = kra_seed["part"]
            _apply_kra_meta(kra, kra_index)
            objectives = sorted(kra.objectives, key=lambda o: (o.sort_order, o.id))
            if len(objectives) != len(kra_seed["objectives"]):
                continue  # unexpected shape -- leave this KRA alone
            for obj_index, (objective, obj_seed) in enumerate(zip(objectives, kra_seed["objectives"])):
                objective.text = obj_seed["text"]
                objective.weight = obj_seed["weight"]
                _apply_objective_meta(objective, kra_index, obj_index)
                _sync_indicators(objective, obj_seed["indicators"])
        db.session.commit()
        _IRC8A_SYNCED_YEARS.add(year)
        return

    sort_order = db.session.query(db.func.max(IRC8AKra.sort_order)).filter_by(year=year).scalar() or 0
    for kra_index, kra_seed in enumerate(IRC8A_SEED_KRAS):
        sort_order += 1
        kra = IRC8AKra(
            year=year,
            part=kra_seed["part"],
            text=kra_seed["text"],
            weight=kra_seed["weight"],
            sort_order=sort_order,
        )
        _apply_kra_meta(kra, kra_index)
        db.session.add(kra)
        db.session.flush()  # assigns kra.id for the objectives below

        obj_order = 0
        for obj_index, obj_seed in enumerate(kra_seed["objectives"]):
            obj_order += 1
            objective = IRC8AObjective(
                kra_id=kra.id,
                text=obj_seed["text"],
                weight=obj_seed["weight"],
                sort_order=obj_order,
            )
            _apply_objective_meta(objective, kra_index, obj_index)
            db.session.add(objective)
            db.session.flush()
            _sync_indicators(objective, obj_seed["indicators"])

    db.session.commit()
    _IRC8A_SYNCED_YEARS.add(year)



# ---------------------------------------------------------------------------
# IRC8D -- Part IV: Improvement and Development Plans
#
# One row per (year, part, position) -- there's no add/delete here, just six
# permanent plan rows (three per table) the ratee and rater fill in together.
#
#   Part IV-A (Office Improvement Plan) columns, all free text:
#     gap_analysis (Gap Analysis (SWOT)), improvement_area, objective
#     (General Objective), intervention (Recommended Improvement
#     Intervention), timeline, resources (Resources Needed)
#
#   Part IV-B (Individual Development Plan) columns:
#     strength_ref (Strengths) and dev_needs_ref (Improvement Needs) are
#     *pointers* to something already rated elsewhere, not freehand text:
#       "o:<id>"  -> an IRC8AObjective id
#       "c:<key>" -> an IRC8B subsection key (IRC8B has no
#                    per-subsection DB row of its own, so the key is all
#                    there is to reference)
#     objective (Learning Objective), intervention (Recommended
#     Developmental Intervention), timeline and resources are free text.
#
# Deliberately NOT resolved/validated here: which items currently rank in
# the "top 5" is a moving target, and turning a ref into a display label is
# left to irc8d.js, which already fetches /irc/irc8a/data and
# /irc/irc8b/data directly -- this table only remembers *which* ref the
# user picked.
# ---------------------------------------------------------------------------
class IRC8DRow(db.Model):
    __tablename__ = "irc8d_rows"
    __table_args__ = (
        db.UniqueConstraint("year", "part", "position", name="uq_irc8d_year_part_position"),
    )

    id = db.Column(db.Integer, primary_key=True)

    year = db.Column(db.Integer, nullable=False, index=True)
    part = db.Column(db.String(1), nullable=False)  # IRC8D_PARTS
    position = db.Column(db.Integer, nullable=False)  # IRC8D_POSITIONS

    # Part IV-A only
    gap_analysis = db.Column(db.Text, nullable=True)
    improvement_area = db.Column(db.Text, nullable=True)

    # Part IV-B only -- refs, see section comment above
    strength_ref = db.Column(db.String(64), nullable=True)
    dev_needs_ref = db.Column(db.String(64), nullable=True)

    # Shared by both parts (General Objective / Learning Objective, and
    # Recommended Improvement / Developmental Intervention)
    objective = db.Column(db.Text, nullable=True)
    intervention = db.Column(db.Text, nullable=True)
    timeline = db.Column(db.Text, nullable=True)
    resources = db.Column(db.Text, nullable=True)

    # One lock per row: the single edit-toggle button in the row's leading
    # column unlocks (and re-locks + saves) every cell in the row together.
    is_locked = db.Column(db.Boolean, nullable=False, default=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "year": self.year,
            "part": self.part,
            "position": self.position,
            "gapAnalysis": self.gap_analysis,
            "improvementArea": self.improvement_area,
            "strengthRef": self.strength_ref,
            "devNeedsRef": self.dev_needs_ref,
            "objective": self.objective,
            "intervention": self.intervention,
            "timeline": self.timeline,
            "resources": self.resources,
            "isLocked": self.is_locked,
        }


# One "Feedback:" box per table (Part IV-A / Part IV-B) per year.
class IRC8DFeedback(db.Model):
    __tablename__ = "irc8d_feedback"
    __table_args__ = (
        db.UniqueConstraint("year", "part", name="uq_irc8d_feedback_year_part"),
    )

    id = db.Column(db.Integer, primary_key=True)
    year = db.Column(db.Integer, nullable=False, index=True)
    part = db.Column(db.String(1), nullable=False)  # IRC8D_PARTS
    text = db.Column(db.Text, nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---------------------------------------------------------------------------
# Report signatory -- "Prepared by" name/position shown at the bottom of
# every IRC1a-IRC8d report page (see base.html's report-signatory footer).
# Single global row (not year-scoped, no uploaded_file_id): it's set once
# from the Home page and intentionally untouched by any tab's Reset, since
# it's not part of any report's data -- just who's signing it.
#
# "Checked by" is NOT stored here -- it's a fixed name/position that never
# changes, so it's hardcoded directly in base.html's footer instead.
# ---------------------------------------------------------------------------
class ReportPreparer(db.Model):
    __tablename__ = "report_preparer"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False, default="")
    position = db.Column(db.String(255), nullable=False, default="")

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---------------------------------------------------------------------------
# IRC8A's own third signatory -- "Approving Authority" name shown alongside
# "Prepared by"/"Checked by" in the report-signatory footer, but only on the
# IRC8A page itself (see base.html's active_tab.id == 'irc8a' check).
# Single global row, same pattern as ReportPreparer above.
#
# Position is stored too (it is editable on IRC8a / IRC8d).
# ---------------------------------------------------------------------------
class IRC8AApprovingAuthority(db.Model):
    __tablename__ = "irc8a_approving_authority"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False, default="")
    # Editable on OPCRF Part I / Part IV (IRC8a / IRC8d).
    position = db.Column(db.String(255), nullable=False, default="", server_default="")

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---------------------------------------------------------------------------
# IRC8A's printed-report header block -- the "Name of Rater / Position",
# "Name of Employee / Position", "Bureau/Center/Service/Division", and
# "Rating Period" / "Date of Review" fields that appear across the top of
# the official DEPED RPMS "Individual Performance Commitment and Review
# Form" (IPCRF) sheet. These are distinct from IRC8AApprovingAuthority and
# the report-signatory footer -- those are the *signature line* at the
# bottom of the form; this is the identifying header info at the top.
#
# Single global row, lazily created on first access -- not year-scoped, and
# never touched by IRC8A's own Reset, since this is identity/period
# metadata, not KRA/objective report data.
# ---------------------------------------------------------------------------
class IRC8AReportHeader(db.Model):
    __tablename__ = "irc8a_report_header"

    id = db.Column(db.Integer, primary_key=True)

    name_of_rater = db.Column(db.String(255), nullable=False, default="")
    position_of_rater = db.Column(db.String(255), nullable=False, default="")
    name_of_employee = db.Column(db.String(255), nullable=False, default="")
    position_of_employee = db.Column(db.String(255), nullable=False, default="")
    bureau = db.Column(db.String(255), nullable=False, default="")  # "Bureau/Center/Service/Division"
    rating_period = db.Column(db.String(255), nullable=False, default="")
    date_of_review = db.Column(db.Date, nullable=True)
    # Printed in the "Statement of Purpose" row of the OPCRF header block.
    statement_of_purpose = db.Column(db.Text, nullable=False, default="", server_default="")

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "nameOfRater": self.name_of_rater,
            "positionOfRater": self.position_of_rater,
            "nameOfEmployee": self.name_of_employee,
            "positionOfEmployee": self.position_of_employee,
            "bureau": self.bureau,
            "ratingPeriod": self.rating_period,
            "dateOfReview": self.date_of_review.isoformat() if self.date_of_review else None,
            "statementOfPurpose": self.statement_of_purpose or "",
        }


# ---------------------------------------------------------------------------
# Date shown under each signatory's position in the report-signatory footer
# (see base.html), one calendar-picked date per (tab, role) pair -- e.g.
# irc1a's "Prepared by" date is independent of irc1b's "Prepared by" date,
# even though both pages currently show the same preparer name (see
# ReportPreparer above). This is what makes the date "per report page"
# rather than a single shared value like the preparer name/position are.
#
# role is one of SIGNATORY_ROLES in app.py: "prepared_by", "checked_by", or
# "approving_authority" (the last one only ever appears on irc8a, matching
# base.html's active_tab.id == 'irc8a' check). Not year-scoped and never
# touched by any tab's own Reset, same convention as ReportPreparer /
# IRC8AApprovingAuthority -- it's signatory metadata, not report data.
# ---------------------------------------------------------------------------
class ReportSignatoryDate(db.Model):
    __tablename__ = "report_signatory_date"

    id = db.Column(db.Integer, primary_key=True)
    tab_id = db.Column(db.String(20), nullable=False)
    role = db.Column(db.String(30), nullable=False)
    date = db.Column(db.Date, nullable=True)

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint("tab_id", "role", name="uq_report_signatory_date_tab_role"),
    )