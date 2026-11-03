(function () {
  const tab = document.getElementById("irc5-tab");
  if (!tab) return;

  const MONTH_NAMES = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const WEEKDAY_COUNT = 7;
  const TEXTAREA_MIN_HEIGHT = 44; // px, must match the CSS default height

  // Entries are persisted server-side (see /irc/irc5/data, /irc/irc5/entry,
  // and models.IRC5Entry). `entries` here is just a client-side cache of
  // whatever the server returned, refreshed on load and kept in sync after
  // every save/delete -- ids always come from the server, never generated
  // locally.
  const YEAR = new Date().getFullYear();
  let entries = [];
  let editingId = null; // id of entry currently being edited, or null for "add"
  let pendingDeleteId = null; // id awaiting confirmation in the delete modal

  // Calendar state (scoped to whatever modal instance is open)
  let calViewYear;
  let calViewMonth; // 0-11
  let selectedDates = new Set(); // ISO "YYYY-MM-DD" strings
  let isDragging = false;
  let dragMode = "add"; // "add" | "remove", decided by the anchor cell's state

  // ------------------------------------------------------------------
  // DOM refs
  // ------------------------------------------------------------------
  const tableBody = document.getElementById("irc5-table-body");
  const tableWrapper = document.querySelector(".irc5-table-wrapper");
  const emptyState = document.getElementById("irc5-empty-state");

  const addBtn = document.getElementById("irc5-add-btn");
  const modalOverlay = document.getElementById("irc5-modal-overlay");
  const modalTitle = document.getElementById("irc5-modal-title");
  const modalClose = document.getElementById("irc5-modal-close");
  const cancelBtn = document.getElementById("irc5-cancel-btn");
  const form = document.getElementById("irc5-form");

  const fTitle = document.getElementById("irc5-f-title");
  const fNature = document.getElementById("irc5-f-nature");
  const fParticipants = document.getElementById("irc5-f-participants");
  const fRating = document.getElementById("irc5-f-rating");
  const fDescVal = document.getElementById("irc5-f-descval");
  const fIndicator = document.getElementById("irc5-f-indicator");
  const fCause = document.getElementById("irc5-f-cause");
  const fMeasures = document.getElementById("irc5-f-measures");

  const calPrevBtn = document.getElementById("irc5-cal-prev");
  const calNextBtn = document.getElementById("irc5-cal-next");
  const calLabel = document.getElementById("irc5-cal-label");
  const calGrid = document.getElementById("irc5-cal-grid");
  const calClearBtn = document.getElementById("irc5-cal-clear");
  const datePreviewText = document.getElementById("irc5-date-preview-text");

  const confirmOverlay = document.getElementById("irc5-confirm-overlay");
  const confirmCancelBtn = document.getElementById("irc5-confirm-cancel");
  const confirmDeleteBtn = document.getElementById("irc5-confirm-delete");

  const resetBtn = document.getElementById("irc5-reset-btn");
  const resetConfirmOverlay = document.getElementById(
    "irc5-reset-confirm-overlay",
  );
  const resetConfirmCancelBtn = document.getElementById(
    "irc5-reset-confirm-cancel",
  );
  const resetConfirmConfirmBtn = document.getElementById(
    "irc5-reset-confirm-confirm",
  );

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function isoDate(year, month, day) {
    const mm = String(month + 1).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  }

  function parseIso(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(date, n) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + n);
    return copy;
  }

  function toIso(date) {
    return isoDate(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function todayIso() {
    return toIso(new Date());
  }

  // Overall Rating -> Descriptive Value, per the fixed 0.75-wide bands:
  //   3.26 - 4.00  -> Strongly Agree
  //   2.51 - 3.25  -> Agree
  //   1.76 - 2.50  -> Disagree
  //   1.00 - 1.75  -> Strongly Disagree
  // Anything blank, non-numeric, or outside 1.00-4.00 yields "" so the
  // field just shows its "Enter a rating first" placeholder / stays
  // blank rather than a misleading label.
  function computeDescVal(ratingInput) {
    const val = parseFloat(ratingInput);
    if (isNaN(val)) return "";
    if (val >= 3.26 && val <= 4.0) return "Strongly Agree";
    if (val >= 2.51 && val <= 3.25) return "Agree";
    if (val >= 1.76 && val <= 2.5) return "Disagree";
    if (val >= 1.0 && val <= 1.75) return "Strongly Disagree";
    return "";
  }

  function descValClass(value) {
    switch (value) {
      case "Strongly Agree":
        return "sa";
      case "Agree":
        return "a";
      case "Disagree":
        return "d";
      case "Strongly Disagree":
        return "sd";
      default:
        return "";
    }
  }

  // ------------------------------------------------------------------
  // Dashboard: Funded vs Non-Funded donut + average overall rating
  // ------------------------------------------------------------------
  const DONUT_RADIUS = 64;
  const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

  const donutFundedCircle = document.getElementById("irc5-donut-funded");
  const donutNonfundedCircle = document.getElementById("irc5-donut-nonfunded");
  const donutTotalEl = document.getElementById("irc5-donut-total");
  const legendFundedEl = document.getElementById("irc5-legend-funded");
  const legendNonfundedEl = document.getElementById("irc5-legend-nonfunded");
  const avgRatingEl = document.getElementById("irc5-avg-rating");
  const avgDescEl = document.getElementById("irc5-avg-desc");

  // Rating Distribution (middle block): four bars keyed on the same
  // descriptive bands computeDescVal() uses, so a decimal rating like
  // 3.75 buckets under "Strongly Agree" alongside a 3.30 or a 4.00 --
  // there's no separate bar per raw value.
  const DIST_BANDS = ["sd", "d", "a", "sa"];
  const distCountEls = {};
  const distFillEls = {};
  DIST_BANDS.forEach((key) => {
    distCountEls[key] = document.getElementById(`irc5-dist-count-${key}`);
    distFillEls[key] = document.getElementById(`irc5-dist-fill-${key}`);
  });

  function renderDistribution() {
    const ratings = entries
      .map((e) => parseFloat(e.rating))
      .filter((v) => !Number.isNaN(v));

    const counts = { sd: 0, d: 0, a: 0, sa: 0 };
    ratings.forEach((val) => {
      const cls = descValClass(computeDescVal(val));
      if (cls && counts[cls] !== undefined) counts[cls] += 1;
    });

    const maxCount = Math.max(counts.sd, counts.d, counts.a, counts.sa, 1);

    DIST_BANDS.forEach((key) => {
      const count = counts[key];
      if (distCountEls[key]) distCountEls[key].textContent = count;
      if (distFillEls[key]) {
        distFillEls[key].style.height =
          count > 0 ? `${(count / maxCount) * 100}%` : "0%";
      }
    });
  }

  function renderDashboard() {
    const fundedCount = entries.filter((e) => e.nature === "Funded").length;
    const nonfundedCount = entries.filter(
      (e) => e.nature === "Non-Funded",
    ).length;
    const natureTotal = fundedCount + nonfundedCount;

    const fundedLen =
      natureTotal > 0 ? (fundedCount / natureTotal) * DONUT_CIRCUMFERENCE : 0;
    const nonfundedLen =
      natureTotal > 0
        ? (nonfundedCount / natureTotal) * DONUT_CIRCUMFERENCE
        : 0;

    if (donutFundedCircle) {
      donutFundedCircle.style.strokeDasharray = `${fundedLen} ${DONUT_CIRCUMFERENCE}`;
      donutFundedCircle.style.strokeDashoffset = "0";
    }
    if (donutNonfundedCircle) {
      donutNonfundedCircle.style.strokeDasharray = `${nonfundedLen} ${DONUT_CIRCUMFERENCE}`;
      donutNonfundedCircle.style.strokeDashoffset = `${-fundedLen}`;
    }

    if (donutTotalEl) donutTotalEl.textContent = entries.length;
    if (legendFundedEl) legendFundedEl.textContent = fundedCount;
    if (legendNonfundedEl) legendNonfundedEl.textContent = nonfundedCount;

    // Average overall rating, across every entry with a numeric rating.
    const ratings = entries
      .map((e) => parseFloat(e.rating))
      .filter((v) => !Number.isNaN(v));
    const avg = ratings.length
      ? ratings.reduce((a, b) => a + b, 0) / ratings.length
      : null;

    if (avgRatingEl)
      avgRatingEl.textContent = avg === null ? "—" : avg.toFixed(2);
    if (avgDescEl) {
      if (avg === null) {
        avgDescEl.textContent = "No data yet";
        avgDescEl.className = "irc5-badge-pill";
      } else {
        const desc = computeDescVal(avg);
        avgDescEl.textContent = desc || "—";
        avgDescEl.className = `irc5-badge-pill ${descValClass(desc)}`;
      }
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : str;
    return div.innerHTML;
  }

  // Server fields (year, nulls for unset rating/participants/etc.) are
  // normalized here into the same all-strings shape the rest of this file
  // already assumes -- entries built from form submissions always trimmed
  // strings, so keeping that shape means renderTable/openModalForEdit
  // don't need to special-case null vs "".
  function normalizeEntry(e) {
    return {
      id: e.id,
      title: e.title || "",
      nature: e.nature || "",
      dateIsoList: e.dateIsoList || [],
      dateDisplay: e.dateDisplay || "",
      participants: e.participants || "",
      rating:
        e.rating !== null && e.rating !== undefined ? String(e.rating) : "",
      descVal: e.descVal || "",
      indicator: e.indicator || "",
      cause: e.cause || "",
      measures: e.measures || "",
    };
  }

  async function loadEntries() {
    try {
      const res = await fetch(`/irc/irc5/data?year=${YEAR}`);
      if (!res.ok) throw new Error("Failed to load entries");
      const data = await res.json();
      entries = (data.entries || []).map(normalizeEntry);
    } catch (err) {
      console.error("Failed to load IRC5 entries:", err);
      entries = [];
    }
    renderTable();
  }

  // Grows a textarea to fit its content, but never shrinks below the
  // fixed default height. Called on input and whenever a field is
  // populated programmatically (e.g. opening the edit modal).
  function autosizeTextarea(el) {
    el.style.height = "auto";
    const newHeight = Math.max(el.scrollHeight, TEXTAREA_MIN_HEIGHT);
    el.style.height = `${newHeight}px`;
  }

  // ------------------------------------------------------------------
  // Overall Rating -> Descriptive Value (auto-fill)
  // ------------------------------------------------------------------
  fRating.addEventListener("input", () => {
    fDescVal.value = computeDescVal(fRating.value);
  });

  // ------------------------------------------------------------------
  // Hybrid date formatting
  //   Selected ISO dates -> "Dec. 11, 14-16, 2026" style string.
  //   Consecutive calendar days collapse into a "start-end" range.
  //   Ranges are grouped by month; a month name is written once per
  //   contiguous block of ranges in that month. If the selection spans
  //   multiple years, each month-group carries its own year and groups
  //   are separated with "; "; otherwise a single year is appended once
  //   at the end.
  // ------------------------------------------------------------------
  function formatDateSelection(datesSet) {
    if (datesSet.size === 0) return "";

    const dates = Array.from(datesSet)
      .map(parseIso)
      .sort((a, b) => a - b);

    // Collapse into consecutive-day runs, splitting a run whenever the
    // month or year changes so each run maps cleanly to one month-group.
    const runs = [];
    let runStart = dates[0];
    let runEnd = dates[0];

    for (let i = 1; i < dates.length; i++) {
      const prev = dates[i - 1];
      const curr = dates[i];
      const isConsecutive = toIso(addDays(prev, 1)) === toIso(curr);
      const sameMonth =
        prev.getMonth() === curr.getMonth() &&
        prev.getFullYear() === curr.getFullYear();

      if (isConsecutive && sameMonth) {
        runEnd = curr;
      } else {
        runs.push({ start: runStart, end: runEnd });
        runStart = curr;
        runEnd = curr;
      }
    }
    runs.push({ start: runStart, end: runEnd });

    // Group runs by month+year, preserving order.
    const monthGroups = [];
    runs.forEach((run) => {
      const key = `${run.start.getFullYear()}-${run.start.getMonth()}`;
      let group = monthGroups[monthGroups.length - 1];
      if (!group || group.key !== key) {
        group = {
          key,
          year: run.start.getFullYear(),
          month: run.start.getMonth(),
          ranges: [],
        };
        monthGroups.push(group);
      }
      group.ranges.push(run);
    });

    const years = new Set(monthGroups.map((g) => g.year));
    const singleYear = years.size === 1 ? monthGroups[0].year : null;

    const groupStrings = monthGroups.map((group) => {
      const rangeStrs = group.ranges.map((r) => {
        const startDay = r.start.getDate();
        const endDay = r.end.getDate();
        return startDay === endDay ? `${startDay}` : `${startDay}-${endDay}`;
      });
      const monthLabel = `${MONTH_NAMES[group.month]}.`;
      const base = `${monthLabel} ${rangeStrs.join(", ")}`;
      return singleYear === null ? `${base}, ${group.year}` : base;
    });

    return singleYear === null
      ? groupStrings.join("; ")
      : `${groupStrings.join(", ")}, ${singleYear}`;
  }

  // ------------------------------------------------------------------
  // Calendar rendering
  // ------------------------------------------------------------------
  function renderCalendar() {
    calLabel.textContent = `${MONTH_NAMES[calViewMonth]} ${calViewYear}`;
    calGrid.innerHTML = "";

    const firstOfMonth = new Date(calViewYear, calViewMonth, 1);
    const startOffset = firstOfMonth.getDay(); // 0 = Sunday
    const gridStart = addDays(firstOfMonth, -startOffset);

    const totalCells = 42; // 6 weeks, keeps grid height stable
    const today = todayIso();

    for (let i = 0; i < totalCells; i++) {
      const cellDate = addDays(gridStart, i);
      const iso = toIso(cellDate);
      const isOutside = cellDate.getMonth() !== calViewMonth;

      const cell = document.createElement("div");
      cell.className = "irc5-cal-day";
      cell.dataset.date = iso;
      cell.textContent = cellDate.getDate();

      if (isOutside) cell.classList.add("irc5-cal-outside");
      if (iso === today) cell.classList.add("irc5-cal-today");
      if (selectedDates.has(iso)) cell.classList.add("irc5-cal-selected");

      calGrid.appendChild(cell);
    }
  }

  function updatePreview() {
    const text = formatDateSelection(selectedDates);
    datePreviewText.textContent = text || "No dates selected";
  }

  function applyDragRange(anchorIso, currentIso, mode) {
    const anchor = parseIso(anchorIso);
    const current = parseIso(currentIso);
    const start = anchor < current ? anchor : current;
    const end = anchor < current ? current : anchor;

    let cursor = start;
    while (cursor <= end) {
      const iso = toIso(cursor);
      if (mode === "add") selectedDates.add(iso);
      else selectedDates.delete(iso);
      cursor = addDays(cursor, 1);
    }
  }

  function refreshCalendarSelectionClasses() {
    calGrid.querySelectorAll(".irc5-cal-day").forEach((cell) => {
      cell.classList.toggle(
        "irc5-cal-selected",
        selectedDates.has(cell.dataset.date),
      );
    });
    updatePreview();
  }

  calGrid.addEventListener("mousedown", (e) => {
    const cell = e.target.closest(".irc5-cal-day");
    if (!cell) return;
    e.preventDefault();

    const iso = cell.dataset.date;
    isDragging = true;
    dragMode = selectedDates.has(iso) ? "remove" : "add";
    applyDragRange(iso, iso, dragMode);
    calGrid.dataset.anchor = iso;
    refreshCalendarSelectionClasses();
  });

  calGrid.addEventListener(
    "mouseenter",
    (e) => {
      if (!isDragging) return;
      const cell = e.target.closest(".irc5-cal-day");
      if (!cell) return;
      const anchor = calGrid.dataset.anchor;
      if (!anchor) return;

      // Recompute from scratch each move so the preview range stays exact
      // even if the user drags back over already-visited days.
      applyDragRange(anchor, cell.dataset.date, dragMode);
      refreshCalendarSelectionClasses();
    },
    true,
  );

  document.addEventListener("mouseup", () => {
    isDragging = false;
    delete calGrid.dataset.anchor;
  });

  calPrevBtn.addEventListener("click", () => {
    calViewMonth -= 1;
    if (calViewMonth < 0) {
      calViewMonth = 11;
      calViewYear -= 1;
    }
    renderCalendar();
  });

  calNextBtn.addEventListener("click", () => {
    calViewMonth += 1;
    if (calViewMonth > 11) {
      calViewMonth = 0;
      calViewYear += 1;
    }
    renderCalendar();
  });

  calClearBtn.addEventListener("click", () => {
    selectedDates.clear();
    refreshCalendarSelectionClasses();
  });

  // ------------------------------------------------------------------
  // Textarea autosize wiring
  // ------------------------------------------------------------------
  fCause.addEventListener("input", () => autosizeTextarea(fCause));
  fMeasures.addEventListener("input", () => autosizeTextarea(fMeasures));

  // ------------------------------------------------------------------
  // Modal open / close
  // ------------------------------------------------------------------
  function resetForm() {
    form.reset();
    fDescVal.value = "";
    fCause.style.height = `${TEXTAREA_MIN_HEIGHT}px`;
    fMeasures.style.height = `${TEXTAREA_MIN_HEIGHT}px`;
    selectedDates = new Set();
    const now = new Date();
    calViewYear = now.getFullYear();
    calViewMonth = now.getMonth();
  }

  function openModalForAdd() {
    editingId = null;
    modalTitle.textContent = "Add Entry";
    resetForm();
    renderCalendar();
    updatePreview();
    modalOverlay.classList.add("visible");
  }

  function openModalForEdit(entry) {
    editingId = entry.id;
    modalTitle.textContent = "Edit Entry";

    fTitle.value = entry.title;
    fNature.value = entry.nature;
    fParticipants.value = entry.participants;
    fRating.value = entry.rating;
    // Recompute rather than trusting the stored value, so edited
    // entries always reflect the current rating -> descriptive value
    // mapping even if the field was populated programmatically.
    fDescVal.value = computeDescVal(entry.rating);
    fIndicator.value = entry.indicator;
    fCause.value = entry.cause;
    fMeasures.value = entry.measures;
    autosizeTextarea(fCause);
    autosizeTextarea(fMeasures);

    selectedDates = new Set(entry.dateIsoList);
    if (entry.dateIsoList.length > 0) {
      const first = parseIso(entry.dateIsoList[0]);
      calViewYear = first.getFullYear();
      calViewMonth = first.getMonth();
    } else {
      const now = new Date();
      calViewYear = now.getFullYear();
      calViewMonth = now.getMonth();
    }

    renderCalendar();
    updatePreview();
    modalOverlay.classList.add("visible");
  }

  function closeModal() {
    modalOverlay.classList.remove("visible");
    editingId = null;
  }

  addBtn.addEventListener("click", openModalForAdd);
  modalClose.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // ------------------------------------------------------------------
  // Delete confirmation modal
  // ------------------------------------------------------------------
  function openDeleteConfirm(id) {
    pendingDeleteId = id;
    confirmOverlay.classList.add("visible");
  }

  function closeDeleteConfirm() {
    pendingDeleteId = null;
    confirmOverlay.classList.remove("visible");
  }

  confirmCancelBtn.addEventListener("click", closeDeleteConfirm);
  confirmOverlay.addEventListener("click", (e) => {
    if (e.target === confirmOverlay) closeDeleteConfirm();
  });

  confirmDeleteBtn.addEventListener("click", async () => {
    if (pendingDeleteId !== null) {
      try {
        const res = await fetch(`/irc/irc5/entry/${pendingDeleteId}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Delete failed");
        entries = entries.filter((en) => en.id !== pendingDeleteId);
        renderTable();
      } catch (err) {
        console.error("Failed to delete IRC5 entry:", err);
        alert("Could not delete this entry. Please try again.");
      }
    }
    closeDeleteConfirm();
  });

  // --- Save to PDF ---
  // Uses the browser's native print-to-PDF instead of a screenshot
  // library: the print stylesheet (see the "Print / Save-to-PDF"
  // section in irc5.css) hides the logo bar, navbar, this page's
  // header action buttons, the Add Entry button, and the Actions
  // column, sizes the page to 8.5x13in "long" paper, and un-clips
  // anything that only scrolls on screen (the table wrapper).
  // document.title is swapped briefly since most browsers suggest it
  // as the default "Save as PDF" filename. Same approach as IRC1a's
  // and IRC3's saveToPdf().
  const pdfBtn = document.getElementById("irc5-pdf-btn");

  function saveToPdf() {
    const previousTitle = document.title;
    document.title = `IRC5 Post Program Evaluation Results ${YEAR}`;

    const restoreTitle = () => {
      document.title = previousTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };
    window.addEventListener("afterprint", restoreTitle);

    window.print();
  }

  if (pdfBtn) {
    pdfBtn.addEventListener("click", saveToPdf);
  }

  // ------------------------------------------------------------------
  // Reset-page confirmation modal
  //
  // Wipes every entry (there's no "minimum rows" invariant here like
  // IRC4's objectives, so this just empties the table -- nothing needs
  // to be re-seeded afterward). No bulk-delete endpoint exists, so this
  // fires one DELETE per existing entry, same as the single-row delete
  // above.
  // ------------------------------------------------------------------
  function openResetConfirm() {
    resetConfirmOverlay.classList.add("visible");
  }

  function closeResetConfirm() {
    resetConfirmOverlay.classList.remove("visible");
  }

  resetBtn.addEventListener("click", openResetConfirm);
  resetConfirmCancelBtn.addEventListener("click", closeResetConfirm);
  resetConfirmOverlay.addEventListener("click", (e) => {
    if (e.target === resetConfirmOverlay) closeResetConfirm();
  });

  resetConfirmConfirmBtn.addEventListener("click", async () => {
    resetConfirmConfirmBtn.disabled = true;
    try {
      await Promise.all(
        entries.map((en) =>
          fetch(`/irc/irc5/entry/${en.id}`, { method: "DELETE" }).catch(() => {
            /* Best-effort, same as everywhere else in this file -- a
                 failed delete just risks that row reappearing on
                 reload. */
          }),
        ),
      );
    } finally {
      entries = [];
      renderTable();
      resetConfirmConfirmBtn.disabled = false;
      closeResetConfirm();
    }
  });

  // ------------------------------------------------------------------
  // Table rendering
  // ------------------------------------------------------------------
  function renderTable() {
    renderDashboard();
    renderDistribution();

    tableBody.innerHTML = "";

    if (entries.length === 0) {
      emptyState.classList.add("visible");
      tableWrapper.classList.add("irc5-empty");
      return;
    }

    emptyState.classList.remove("visible");
    tableWrapper.classList.remove("irc5-empty");

    entries.forEach((entry, index) => {
      const tr = document.createElement("tr");
      const natureClass = entry.nature === "Funded" ? "funded" : "non-funded";
      const descClass = descValClass(entry.descVal);

      tr.innerHTML = `
        <td>${index + 1}</td>
        <td class="irc5-cell-title">${escapeHtml(entry.title)}</td>
        <td><span class="irc5-nature-badge ${natureClass}">${escapeHtml(
          entry.nature,
        )}</span></td>
        <td class="irc5-cell-text">${escapeHtml(entry.dateDisplay) || "N/A"}</td>
        <td class="irc5-cell-text">${escapeHtml(entry.participants) || "N/A"}</td>
        <td><span class="irc5-rating-value">${
          entry.rating !== "" ? escapeHtml(entry.rating) : "N/A"
        }</span></td>
        <td><span class="irc5-descval-badge ${descClass}">${escapeHtml(
          entry.descVal,
        )}</span></td>
        <td class="irc5-cell-text">${escapeHtml(entry.indicator) || "N/A"}</td>
        <td class="irc5-cell-text">${escapeHtml(entry.cause) || "N/A"}</td>
        <td class="irc5-cell-text">${escapeHtml(entry.measures) || "N/A"}</td>
        <td>
          <div class="irc5-actions-cell">
            <button type="button" class="irc5-icon-btn irc5-edit-btn" data-id="${
              entry.id
            }" title="Edit">&#9998;</button>
            <button type="button" class="irc5-icon-btn irc5-delete-btn" data-id="${
              entry.id
            }" title="Delete">&#128465;</button>
          </div>
        </td>
      `;

      tableBody.appendChild(tr);
    });
  }

  tableBody.addEventListener("click", (e) => {
    const editBtn = e.target.closest(".irc5-edit-btn");
    const deleteBtn = e.target.closest(".irc5-delete-btn");

    if (editBtn) {
      const entry = entries.find((en) => en.id === Number(editBtn.dataset.id));
      if (entry) openModalForEdit(entry);
    }

    if (deleteBtn) {
      openDeleteConfirm(Number(deleteBtn.dataset.id));
    }
  });

  // ------------------------------------------------------------------
  // Form submit
  // ------------------------------------------------------------------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const dateIsoList = Array.from(selectedDates).sort();
    const ratingText = fRating.value.trim();
    const entryData = {
      id: editingId,
      year: YEAR,
      title: fTitle.value.trim(),
      nature: fNature.value,
      dateIsoList,
      dateDisplay: formatDateSelection(selectedDates),
      participants: fParticipants.value.trim(),
      rating: ratingText === "" ? null : parseFloat(ratingText),
      descVal: fDescVal.value,
      indicator: fIndicator.value.trim(),
      cause: fCause.value.trim(),
      measures: fMeasures.value.trim(),
    };

    try {
      const res = await fetch("/irc/irc5/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entryData),
      });
      if (!res.ok) throw new Error("Save failed");
      const saved = normalizeEntry(await res.json());

      if (editingId !== null) {
        const idx = entries.findIndex((en) => en.id === editingId);
        if (idx !== -1) entries[idx] = saved;
      } else {
        entries.push(saved);
      }

      renderTable();
      closeModal();
    } catch (err) {
      console.error("Failed to save IRC5 entry:", err);
      alert("Could not save this entry. Please try again.");
    }
  });

  // ------------------------------------------------------------------
  // Initial load
  // ------------------------------------------------------------------
  loadEntries();
})();
