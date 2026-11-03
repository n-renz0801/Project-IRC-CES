(function () {
  const tab = document.getElementById("irc6-tab");
  if (!tab) return;

  // Entries are persisted server-side (see /irc/irc6/data, /irc/irc6/entry,
  // and models.IRC6Entry). `entries` here is just a client-side cache of
  // whatever the server returned, refreshed on load and kept in sync after
  // every save/delete -- ids, and the Goal/Outcome seed rows themselves,
  // always come from the server (see app.py's _ensure_irc6_seed).
  //
  // Each entry: { id, kind: 'goal' | 'outcome' | 'output', title,
  //   objectives, indicators, definition,
  //   dcSource, dcPerson, dcFreq,
  //   daUsed, daPerson, daFreq,
  //   users, repComm, repFreq }
  //
  // 'title' is only meaningful for kind === 'output'. Goal and Outcome
  // are always present, and are edit-only (no delete, no title field) —
  // the label itself is fixed. Outputs are numbered by their position
  // among kind === 'output' entries at render time, so deleting one
  // automatically renumbers the rest; nothing is stored.
  const YEAR = new Date().getFullYear();
  let entries = [];
  let editingId = null; // id of entry currently being edited, or null for "add"
  let pendingDeleteId = null;

  // ------------------------------------------------------------------
  // DOM refs
  // ------------------------------------------------------------------
  const tableBody = document.getElementById("irc6-table-body");

  const addBtn = document.getElementById("irc6-add-btn");
  const modalOverlay = document.getElementById("irc6-modal-overlay");
  const modalTitle = document.getElementById("irc6-modal-title");
  const modalClose = document.getElementById("irc6-modal-close");
  const cancelBtn = document.getElementById("irc6-cancel-btn");
  const form = document.getElementById("irc6-form");

  const titleField = document.getElementById("irc6-title-field");
  const fTitleLabel = document.getElementById("irc6-f-title-label");
  const fTitle = document.getElementById("irc6-f-title");
  const fTitleHint = document.getElementById("irc6-f-title-hint");

  const fObjectives = document.getElementById("irc6-f-objectives");
  const fIndicators = document.getElementById("irc6-f-indicators");
  const fDefinition = document.getElementById("irc6-f-definition");
  const fDcSource = document.getElementById("irc6-f-dcsource");
  const fDcPerson = document.getElementById("irc6-f-dcperson");
  const fDcFreq = document.getElementById("irc6-f-dcfreq");
  const fDaUsed = document.getElementById("irc6-f-daused");
  const fDaPerson = document.getElementById("irc6-f-daperson");
  const fDaFreq = document.getElementById("irc6-f-dafreq");
  const fUsers = document.getElementById("irc6-f-users");
  const fRepComm = document.getElementById("irc6-f-repcomm");
  const fRepFreq = document.getElementById("irc6-f-repfreq");

  const AUTOSIZE_TEXTAREAS = [
    fObjectives,
    fIndicators,
    fDefinition,
    fDcSource,
    fDaUsed,
    fUsers,
    fRepComm,
  ];
  const TEXTAREA_MIN_HEIGHT = 44; // px, must match the CSS default height

  const confirmOverlay = document.getElementById("irc6-confirm-overlay");
  const confirmCancelBtn = document.getElementById("irc6-confirm-cancel");
  const confirmDeleteBtn = document.getElementById("irc6-confirm-delete");

  const resetBtn = document.getElementById("irc6-reset-btn");
  const resetConfirmOverlay = document.getElementById(
    "irc6-reset-confirm-overlay",
  );
  const resetConfirmCancelBtn = document.getElementById(
    "irc6-reset-confirm-cancel",
  );
  const resetConfirmConfirmBtn = document.getElementById(
    "irc6-reset-confirm-confirm",
  );

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : str;
    return div.innerHTML;
  }

  // Server fields come back with nulls for anything never filled in;
  // normalize those into "" so the rest of this file (which always dealt
  // in trimmed strings from form submissions) doesn't need to special-case
  // null vs "".
  function normalizeEntry(e) {
    return {
      id: e.id,
      kind: e.kind,
      title: e.title || "",
      objectives: e.objectives || "",
      indicators: e.indicators || "",
      definition: e.definition || "",
      dcSource: e.dcSource || "",
      dcPerson: e.dcPerson || "",
      dcFreq: e.dcFreq || "",
      daUsed: e.daUsed || "",
      daPerson: e.daPerson || "",
      daFreq: e.daFreq || "",
      users: e.users || "",
      repComm: e.repComm || "",
      repFreq: e.repFreq || "",
    };
  }

  async function loadEntries() {
    try {
      const res = await fetch(`/irc/irc6/data?year=${YEAR}`);
      if (!res.ok) throw new Error("Failed to load entries");
      const data = await res.json();
      entries = (data.entries || []).map(normalizeEntry);
    } catch (err) {
      console.error("Failed to load IRC6 entries:", err);
      entries = [];
    }
    renderTable();
  }

  function autosizeTextarea(el) {
    el.style.height = "auto";
    const newHeight = Math.max(el.scrollHeight, TEXTAREA_MIN_HEIGHT);
    el.style.height = `${newHeight}px`;
  }

  // Next output number = count of existing outputs + 1. Used both for
  // the "Add" modal hint and for labeling rows at render time.
  function outputNumberFor(entry) {
    let n = 0;
    for (const en of entries) {
      if (en.kind === "output") {
        n += 1;
        if (en.id === entry.id) return n;
      }
    }
    return n;
  }

  function nextOutputNumber() {
    return entries.filter((en) => en.kind === "output").length + 1;
  }

  AUTOSIZE_TEXTAREAS.forEach((el) => {
    el.addEventListener("input", () => autosizeTextarea(el));
  });

  // ------------------------------------------------------------------
  // Modal open / close
  // ------------------------------------------------------------------
  function resetForm() {
    form.reset();
    AUTOSIZE_TEXTAREAS.forEach((el) => {
      el.style.height = `${TEXTAREA_MIN_HEIGHT}px`;
    });
  }

  function configureTitleFieldFor(kind) {
    if (kind === "goal" || kind === "outcome") {
      titleField.style.display = "none";
      fTitle.required = false;
    } else {
      titleField.style.display = "";
      fTitleLabel.textContent = "Output Title";
      fTitle.required = true;
      fTitle.placeholder = "e.g. Mid-Year Performance Review";
    }
  }

  function openModalForAdd() {
    editingId = null;
    const n = nextOutputNumber();
    modalTitle.textContent = "Add Output";
    resetForm();
    configureTitleFieldFor("output");
    fTitleHint.textContent = `This will be labeled "OUTPUT ${n}: <your title>".`;
    modalOverlay.classList.add("visible");
    fTitle.focus();
  }

  function kindDisplayName(kind) {
    if (kind === "goal") return "Goal";
    if (kind === "outcome") return "Outcome";
    return "Output";
  }

  function openModalForEdit(entry) {
    editingId = entry.id;
    modalTitle.textContent = `Edit ${kindDisplayName(entry.kind)}`;
    resetForm();
    configureTitleFieldFor(entry.kind);

    if (entry.kind === "output") {
      fTitle.value = entry.title;
      fTitleHint.textContent = `Labeled as "OUTPUT ${outputNumberFor(
        entry,
      )}: <your title>".`;
    } else {
      fTitleHint.textContent = "";
    }

    fObjectives.value = entry.objectives;
    fIndicators.value = entry.indicators;
    fDefinition.value = entry.definition;
    fDcSource.value = entry.dcSource;
    fDcPerson.value = entry.dcPerson;
    fDcFreq.value = entry.dcFreq;
    fDaUsed.value = entry.daUsed;
    fDaPerson.value = entry.daPerson;
    fDaFreq.value = entry.daFreq;
    fUsers.value = entry.users;
    fRepComm.value = entry.repComm;
    fRepFreq.value = entry.repFreq;

    AUTOSIZE_TEXTAREAS.forEach((el) => autosizeTextarea(el));

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
  // Delete confirmation modal (outputs only)
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
        const res = await fetch(`/irc/irc6/entry/${pendingDeleteId}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Delete failed");
        entries = entries.filter((en) => en.id !== pendingDeleteId);
        renderTable();
      } catch (err) {
        console.error("Failed to delete IRC6 output:", err);
        alert("Could not delete this output. Please try again.");
      }
    }
    closeDeleteConfirm();
  });

  // --- Save to PDF ---
  // Uses the browser's native print-to-PDF instead of a screenshot
  // library: the print stylesheet (see the "Print / Save-to-PDF"
  // section in irc6.css) hides the logo bar, navbar, this page's
  // header action buttons, the Add Output button, and the Actions
  // column, sizes the page to 8.5x13in "long" paper, and un-clips
  // anything that only scrolls on screen (the table wrapper).
  // document.title is swapped briefly since most browsers suggest it
  // as the default "Save as PDF" filename. Same approach as IRC1a's,
  // IRC3's, and IRC5's saveToPdf().
  const pdfBtn = document.getElementById("irc6-pdf-btn");

  function saveToPdf() {
    const previousTitle = document.title;
    document.title = `IRC6 Monitoring and Evaluation Plan ${YEAR}`;

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
  // Unlike a plain "delete everything" table, the Goal and Outcome rows
  // here are edit-only and can't be deleted (see delete_irc6_entry in
  // app.py). So resetting means: delete every Output entry, AND blank
  // out Goal/Outcome's own fields via the normal save endpoint (id
  // included, kind stays fixed server-side) rather than removing them --
  // mirroring how IRC4's reset respects its own "at least 3 objectives"
  // invariant instead of deleting past it.
  // ------------------------------------------------------------------
  const BLANK_IRC6_FIELDS = {
    objectives: "",
    indicators: "",
    definition: "",
    dcSource: "",
    dcPerson: "",
    dcFreq: "",
    daUsed: "",
    daPerson: "",
    daFreq: "",
    users: "",
    repComm: "",
    repFreq: "",
  };

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
      const outputs = entries.filter((en) => en.kind === "output");
      const keepers = entries.filter((en) => en.kind !== "output");

      await Promise.all([
        ...outputs.map((en) =>
          fetch(`/irc/irc6/entry/${en.id}`, { method: "DELETE" }).catch(
            () => {},
          ),
        ),
        ...keepers.map((en) =>
          fetch("/irc/irc6/entry", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: en.id,
              year: YEAR,
              ...BLANK_IRC6_FIELDS,
            }),
          }).catch(() => {}),
        ),
      ]);
    } finally {
      await loadEntries();
      resetConfirmConfirmBtn.disabled = false;
      closeResetConfirm();
    }
  });

  // ------------------------------------------------------------------
  // Table rendering
  // ------------------------------------------------------------------
  function renderTitleCell(entry) {
    if (entry.kind === "goal") {
      return `<div class="irc6-title-cell"><span class="irc6-kind-badge goal">Goal</span></div>`;
    }
    if (entry.kind === "outcome") {
      return `<div class="irc6-title-cell"><span class="irc6-kind-badge outcome">Outcome</span></div>`;
    }
    const n = outputNumberFor(entry);
    const titleText = entry.title
      ? escapeHtml(entry.title)
      : `<span style="color:#9ca3af;">Untitled output</span>`;
    return `
      <div class="irc6-title-cell">
        <span class="irc6-kind-badge output">Output ${n}</span>
        <div class="irc6-output-title">${titleText}</div>
      </div>
    `;
  }

  function cell(value) {
    const text = escapeHtml(value);
    return text
      ? `<td class="irc6-cell-text">${text}</td>`
      : `<td class="irc6-cell-text"><span class="irc6-empty-value">&ndash;</span></td>`;
  }

  function renderTable() {
    tableBody.innerHTML = "";

    entries.forEach((entry, index) => {
      const tr = document.createElement("tr");
      const canDelete = entry.kind === "output";

      tr.innerHTML = `
        <td>${index + 1}</td>
        <td class="irc6-cell-title">${renderTitleCell(entry)}</td>
        ${cell(entry.objectives)}
        ${cell(entry.indicators)}
        ${cell(entry.definition)}
        ${cell(entry.dcSource)}
        ${cell(entry.dcPerson)}
        ${cell(entry.dcFreq)}
        ${cell(entry.daUsed)}
        ${cell(entry.daPerson)}
        ${cell(entry.daFreq)}
        ${cell(entry.users)}
        ${cell(entry.repComm)}
        ${cell(entry.repFreq)}
        <td>
          <div class="irc6-actions-cell">
            <button type="button" class="irc6-icon-btn irc6-edit-btn" data-id="${
              entry.id
            }" title="Edit">&#9998;</button>
            <button type="button" class="irc6-icon-btn irc6-delete-btn" data-id="${
              entry.id
            }" title="${
              canDelete ? "Delete" : "Goal and Outcome cannot be deleted"
            }" ${canDelete ? "" : "disabled"}>&#128465;</button>
          </div>
        </td>
      `;

      tableBody.appendChild(tr);
    });
  }

  tableBody.addEventListener("click", (e) => {
    const editBtn = e.target.closest(".irc6-edit-btn");
    const deleteBtn = e.target.closest(".irc6-delete-btn");

    if (editBtn) {
      const entry = entries.find((en) => en.id === Number(editBtn.dataset.id));
      if (entry) openModalForEdit(entry);
    }

    if (deleteBtn && !deleteBtn.disabled) {
      openDeleteConfirm(Number(deleteBtn.dataset.id));
    }
  });

  // ------------------------------------------------------------------
  // Form submit
  // ------------------------------------------------------------------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const kind =
      editingId === null
        ? "output"
        : entries.find((en) => en.id === editingId).kind;

    const entryData = {
      id: editingId,
      year: YEAR,
      title: kind === "output" ? fTitle.value.trim() : "",
      objectives: fObjectives.value.trim(),
      indicators: fIndicators.value.trim(),
      definition: fDefinition.value.trim(),
      dcSource: fDcSource.value.trim(),
      dcPerson: fDcPerson.value.trim(),
      dcFreq: fDcFreq.value.trim(),
      daUsed: fDaUsed.value.trim(),
      daPerson: fDaPerson.value.trim(),
      daFreq: fDaFreq.value.trim(),
      users: fUsers.value.trim(),
      repComm: fRepComm.value.trim(),
      repFreq: fRepFreq.value.trim(),
    };

    try {
      const res = await fetch("/irc/irc6/entry", {
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
      console.error("Failed to save IRC6 entry:", err);
      alert("Could not save this entry. Please try again.");
    }
  });

  // ------------------------------------------------------------------
  // Initial load
  // ------------------------------------------------------------------
  loadEntries();
})();
