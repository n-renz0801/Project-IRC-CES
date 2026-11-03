(function () {
  const tab = document.getElementById("irc8d-tab");
  if (!tab) return;

  // ------------------------------------------------------------------
  // Layout of the two tables. Part IV-A is all free text. Part IV-B's
  // first two columns (Strengths / Improvement Needs) are picks from the
  // top-rated / lowest-rated items in EOPCRF I (objectives) and EOPCRF II
  // (competency subsections); everything else is free text.
  // Part IV-A has 3 fixed rows; Part IV-B has 4. In Part IV-B, rows 1-2
  // pick from EOPCRF I objectives (all KRAs A-C pooled) and rows 3-4 pick
  // from EOPCRF II subsections (II-A and II-B pooled); each dropdown offers
  // the top 3 (Strengths) or lowest 3 (Improvement Needs) of its pool.
  // ------------------------------------------------------------------
  const PARTS = {
    A: {
      bodyId: "irc8d-table-body-a",
      positions: [1, 2, 3],
      columns: [
        {
          field: "gapAnalysis",
          type: "text",
          label: "Gap Analysis (SWOT)",
        },
        { field: "improvementArea", type: "text", label: "Improvement Area" },
        { field: "objective", type: "text", label: "General Objective" },
        {
          field: "intervention",
          type: "text",
          label: "Recommended Improvement Intervention",
        },
        { field: "timeline", type: "text", label: "Timeline" },
        { field: "resources", type: "text", label: "Resources Needed" },
      ],
    },
    B: {
      bodyId: "irc8d-table-body-b",
      positions: [1, 2, 3, 4],
      columns: [
        {
          field: "strengthRef",
          type: "ref",
          direction: "highest",
          label: "Strengths",
        },
        {
          field: "devNeedsRef",
          type: "ref",
          direction: "lowest",
          label: "Improvement Needs",
        },
        {
          field: "objective",
          type: "text",
          label: "Learning Objective (based on the developmental intervention)",
        },
        {
          field: "intervention",
          type: "text",
          label: "Recommended Developmental Intervention",
        },
        { field: "timeline", type: "text", label: "Timeline" },
        { field: "resources", type: "text", label: "Resources Needed" },
      ],
    },
  };
  // Which pooled source a Part IV-B row's picks come from.
  const REF_SOURCE_BY_POSITION = { 1: "o", 2: "o", 3: "c", 4: "c" };
  const REF_SOURCE_LABELS = {
    o: "OPCRF Part I objectives (KRAs A–C)",
    c: "OPCRF Part II subsections (II-A & II-B)",
  };
  const PART_TITLES = { A: "Part IV-A", B: "Part IV-B" };
  const TOP_N = 3;

  // Friendly names for EOPCRF II's section keys, and known subsection
  // titles. Any subsection key not listed here falls back to a humanized
  // version of the key itself (e.g. "self_management" -> "Self Management").
  const IRC8B_SECTION_LABELS = {
    leadership: "Leadership Competencies",
    cbc: "Core Behavioral Competencies",
  };
  const IRC8B_TITLE_OVERRIDES = {
    self_management: "Self Management",
    teamwork: "Teamwork",
    professionalism_ethics: "Professionalism and Ethics",
    service_orientation: "Service Orientation",
    result_focus: "Result Focus",
    innovation: "Innovation",
  };

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  // rows: { "A1": { part, position, ...fields } }
  // edit: the row currently open in the edit modal -- { part, position, refs }
  //   (refs = in-progress dropdown picks; text fields are read from the form)
  // items: pooled, flattened candidate list rebuilt fresh on every load
  //   [{ id, main, source, average }] -- "top 5" is a live computation.
  const state = {
    year: null,
    rows: {},
    feedback: { A: "", B: "" },
    items: [],
    edit: null,
  };

  // ------------------------------------------------------------------
  // DOM refs
  // ------------------------------------------------------------------
  const bodies = {
    A: document.getElementById(PARTS.A.bodyId),
    B: document.getElementById(PARTS.B.bodyId),
  };
  const feedbackInputs = {
    A: document.getElementById("irc8d-feedback-a"),
    B: document.getElementById("irc8d-feedback-b"),
  };

  const editOverlay = document.getElementById("irc8d-edit-overlay");
  const editForm = document.getElementById("irc8d-edit-form");
  const editTitle = document.getElementById("irc8d-edit-title");
  const editSub = document.getElementById("irc8d-edit-sub");
  const editFields = document.getElementById("irc8d-edit-fields");
  const editError = document.getElementById("irc8d-edit-error");
  const editCancelBtn = document.getElementById("irc8d-edit-cancel");
  const editSubmitBtn = document.getElementById("irc8d-edit-submit");

  const resetBtn = document.getElementById("irc8d-reset-btn");
  const resetConfirmOverlay = document.getElementById(
    "irc8d-reset-confirm-overlay",
  );
  const resetConfirmCancelBtn = document.getElementById(
    "irc8d-reset-confirm-cancel",
  );
  const resetConfirmConfirmBtn = document.getElementById(
    "irc8d-reset-confirm-confirm",
  );

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : str;
    return div.innerHTML;
  }

  async function apiCall(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      throw new Error(
        "Network error — please check your connection and try again.",
      );
    }
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      // no/invalid JSON body
    }
    if (!res.ok) {
      throw new Error(
        (data && data.error) || "Something went wrong. Please try again.",
      );
    }
    return data;
  }

  function average(values) {
    const rated = values.filter(
      (v) => v !== null && v !== undefined && !isNaN(v),
    );
    if (rated.length === 0) return null;
    return rated.reduce((sum, v) => sum + Number(v), 0) / rated.length;
  }

  function humanize(key) {
    return String(key)
      .split("_")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  function rowKey(part, position) {
    return `${part}${position}`;
  }

  // ------------------------------------------------------------------
  // Ranking: rebuilt fresh from EOPCRF I / EOPCRF II data on every load.
  // Ref ids are prefixed so one pooled list can hold both kinds:
  //   "o:<objective id>"  -> EOPCRF I objective
  //   "c:<subsection key>" -> EOPCRF II subsection
  // ------------------------------------------------------------------
  function rankEopcrf1Objectives(data) {
    const items = [];
    (data.kras || []).forEach((kra) => {
      (kra.objectives || []).forEach((obj) => {
        if (obj.average === null || obj.average === undefined) return;
        items.push({
          id: `o:${obj.id}`,
          main: obj.text || "(untitled objective)",
          source: kra.text || "",
          average: obj.average,
        });
      });
    });
    return items;
  }

  function rankEopcrf2Subsections(data) {
    const ratings = data.ratings || {};
    const sections = data.sections || {};
    const items = [];
    Object.keys(ratings).forEach((key) => {
      const avg = average(Object.values(ratings[key] || {}));
      if (avg === null) return;
      items.push({
        id: `c:${key}`,
        main: IRC8B_TITLE_OVERRIDES[key] || humanize(key),
        source: IRC8B_SECTION_LABELS[sections[key]] || "EOPCRF II",
        average: avg,
      });
    });
    return items;
  }

  // Candidate pool for a dropdown: items whose id prefix matches the
  // row's source ("o:" = EOPCRF I objective, "c:" = EOPCRF II subsection).
  function poolFor(position) {
    const source = REF_SOURCE_BY_POSITION[position];
    return state.items.filter((it) => it.id.startsWith(`${source}:`));
  }

  function topN(items, n, direction) {
    return items
      .slice()
      .sort((a, b) =>
        direction === "highest" ? b.average - a.average : a.average - b.average,
      )
      .slice(0, n);
  }

  // ------------------------------------------------------------------
  // Loading
  // ------------------------------------------------------------------
  async function loadAll() {
    try {
      const data = await apiCall("GET", "/irc/irc8d/data");
      state.year = data.year;
      state.rows = {};
      data.rows.forEach((r) => (state.rows[rowKey(r.part, r.position)] = r));
      state.feedback = Object.assign({ A: "", B: "" }, data.feedback || {});

      const [irc8a, irc8b] = await Promise.all([
        apiCall("GET", `/irc/irc8a/data?year=${state.year}`),
        apiCall("GET", `/irc/irc8b/data?year=${state.year}`),
      ]);
      state.items = rankEopcrf1Objectives(irc8a).concat(
        rankEopcrf2Subsections(irc8b),
      );

      render();
    } catch (err) {
      ["A", "B"].forEach((part) => {
        bodies[part].innerHTML =
          `<tr class="irc8d-empty-row"><td colspan="7">Couldn't load this page: ${escapeHtml(err.message)}</td></tr>`;
      });
    }
  }

  // Ratee / Rater / Approving Authority are rendered and saved by the shared
  // `signatories` macro + static/js/signatories.js.

  // ------------------------------------------------------------------
  // Row persistence
  // ------------------------------------------------------------------
  async function saveRow(part, position, patch) {
    const updated = await apiCall("POST", "/irc/irc8d/row", {
      year: state.year,
      part,
      position,
      ...patch,
    });
    state.rows[rowKey(part, position)] = updated;
    return updated;
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  function render() {
    renderTable("A");
    renderTable("B");
    ["A", "B"].forEach((part) => {
      feedbackInputs[part].value = state.feedback[part] || "";
    });
  }

  // Used inside the edit modal only. `currentRef` is the in-progress pick.
  function renderRefDropdown(column, currentRef, position) {
    const { field, direction } = column;
    const items = poolFor(position);
    const candidates = topN(items, TOP_N, direction);

    // Always keep the currently-saved pick in the list, even if it has
    // fallen out of the top 5 since it was chosen, or -- if the item is
    // gone entirely -- show it as no-longer-available rather than
    // silently dropping the selection.
    let extra = null;
    if (currentRef && !candidates.some((c) => c.id === currentRef)) {
      const match = state.items.find((c) => c.id === currentRef);
      extra = match || {
        id: currentRef,
        main: "(previously selected — no longer available)",
        source: "",
        average: null,
        unavailable: true,
      };
    }

    const current = extra || state.items.find((c) => c.id === currentRef);
    const ranked = candidates.map((c, i) => ({ ...c, rank: i + 1 }));
    const allOptions = extra ? [{ ...extra, rank: null }, ...ranked] : ranked;

    const metaLine = (c) =>
      `${escapeHtml(c.source)}${c.source ? " &middot; " : ""}${c.average.toFixed(2)}`;

    const triggerInner = current
      ? `
        <span class="irc8d-ref-trigger-content">
          <span class="irc8d-ref-main">${escapeHtml(current.main)}</span>
          ${current.unavailable ? "" : `<span class="irc8d-ref-meta">${metaLine(current)}</span>`}
        </span>
      `
      : `<span class="irc8d-ref-trigger-text irc8d-ref-placeholder">— Select —</span>`;

    const rankClass =
      direction === "highest"
        ? "irc8d-ref-rank-positive"
        : "irc8d-ref-rank-negative";

    const optionsHtml = allOptions
      .map((c) => {
        const isSelected = c.id === currentRef;
        const metaHtml = c.unavailable
          ? ""
          : `<p class="irc8d-ref-meta">${metaLine(c)}</p>`;
        const rankHtml = c.rank
          ? `<span class="irc8d-ref-rank ${rankClass}">${c.rank}</span>`
          : `<span class="irc8d-ref-rank irc8d-ref-rank-neutral">&ndash;</span>`;
        return `
          <li role="option" class="irc8d-ref-option${isSelected ? " irc8d-ref-option-selected" : ""}" data-value="${escapeHtml(c.id)}" aria-selected="${isSelected}">
            ${rankHtml}
            <span class="irc8d-ref-option-text">
              <p class="irc8d-ref-main">${escapeHtml(c.main)}</p>
              ${metaHtml}
            </span>
          </li>
        `;
      })
      .join("");

    return `
      <div class="irc8d-ref-dropdown" data-field="${field}">
        <button type="button" class="irc8d-ref-trigger" aria-haspopup="listbox" aria-expanded="false">
          ${triggerInner}
          <span class="irc8d-ref-trigger-caret">&#9662;</span>
        </button>
        <ul class="irc8d-ref-listbox" role="listbox" hidden>
          <li role="option" class="irc8d-ref-option irc8d-ref-option-placeholder" data-value="" aria-selected="${!currentRef}">
            <p class="irc8d-ref-main">— Select —</p>
          </li>
          ${optionsHtml}
        </ul>
      </div>
    `;
  }

  // Table cells are always read-only; edits happen in the modal.
  function renderRefCell(row, column, cls) {
    const currentRef = row[column.field];
    if (!currentRef) return `<td class="${cls}"></td>`;
    const match = state.items.find((c) => c.id === currentRef);
    if (!match) {
      return `<td class="${cls}"><span class="irc8d-cell-empty">(previously selected — no longer available)</span></td>`;
    }
    return `
      <td class="${cls}">
        <p class="irc8d-ref-main">${escapeHtml(match.main)}</p>
        <p class="irc8d-ref-meta">${escapeHtml(match.source)}${match.source ? " &middot; " : ""}${match.average.toFixed(2)}</p>
      </td>
    `;
  }

  function renderTextCell(row, column, cls) {
    const value = row[column.field] || "";
    return `<td class="irc8d-cell-text ${cls}">${escapeHtml(value)}</td>`;
  }

  function renderCell(row, column) {
    const cls = "";
    return column.type === "ref"
      ? renderRefCell(row, column, cls)
      : renderTextCell(row, column, cls);
  }

  function renderTable(part) {
    const def = PARTS[part];
    bodies[part].innerHTML = def.positions
      .map((position) => {
        const row = state.rows[rowKey(part, position)] || { part, position };
        return `
        <tr data-part="${part}" data-position="${position}">
          <td class="irc8d-col-edit">
            <button type="button" class="irc8d-icon-btn irc8d-edit-btn" data-part="${part}" data-position="${position}" title="Edit this row" aria-label="Edit ${PART_TITLES[part]} row ${position}">
              &#9998;
            </button>
          </td>
          ${def.columns.map((col) => renderCell(row, col)).join("")}
        </tr>
      `;
      })
      .join("");
  }

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------
  // Edit button on a table row -> open the edit modal for that row.
  ["A", "B"].forEach((part) => {
    bodies[part].addEventListener("click", (e) => {
      const btn = e.target.closest(".irc8d-edit-btn");
      if (!btn) return;
      openEditModal(part, Number(btn.dataset.position));
    });
  });

  // ------------------------------------------------------------------
  // Edit modal
  //
  // Opens pre-filled with the row's current values. Nothing is saved
  // until Submit; Cancel / Escape discards the changes.
  // ------------------------------------------------------------------
  function closeAllDropdowns(exceptListbox) {
    editForm.querySelectorAll(".irc8d-ref-listbox").forEach((listbox) => {
      if (listbox === exceptListbox) return;
      listbox.hidden = true;
      const trigger = listbox.previousElementSibling;
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
  }

  // The list floats over the modal (position: fixed) instead of sitting in
  // the field flow, so opening it never changes the modal's height. Placed
  // under the trigger, or flipped above it when there isn't room below.
  function positionListbox(trigger, listbox) {
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const margin = 12;
    const below = window.innerHeight - rect.bottom - gap - margin;
    const above = rect.top - gap - margin;
    const openUp = below < 160 && above > below;
    const room = Math.max(120, openUp ? above : below);

    listbox.style.left = `${rect.left}px`;
    listbox.style.width = `${rect.width}px`;
    listbox.style.maxHeight = `${Math.min(280, room)}px`;
    if (openUp) {
      listbox.style.top = "auto";
      listbox.style.bottom = `${window.innerHeight - rect.top + gap}px`;
    } else {
      listbox.style.bottom = "auto";
      listbox.style.top = `${rect.bottom + gap}px`;
    }
  }

  function renderEditField(column, row) {
    const id = `irc8d-edit-${column.field}`;
    const label = escapeHtml(column.label || column.field);
    if (column.type === "ref") {
      const dir = column.direction === "highest" ? "Top" : "Lowest";
      const hint = `${dir} ${TOP_N} · ${REF_SOURCE_LABELS[REF_SOURCE_BY_POSITION[row.position]]}`;
      return `
        <div class="irc8d-edit-field">
          <span class="irc8d-edit-label">${label}<span class="irc8d-edit-hint">${escapeHtml(hint)}</span></span>
          ${renderRefDropdown(column, state.edit.refs[column.field], row.position)}
        </div>
      `;
    }
    return `
      <div class="irc8d-edit-field">
        <label class="irc8d-edit-label" for="${id}">${label}</label>
        <textarea id="${id}" class="irc8d-edit-input" data-field="${column.field}" rows="3">${escapeHtml(row[column.field] || "")}</textarea>
      </div>
    `;
  }

  function openEditModal(part, position) {
    const row = state.rows[rowKey(part, position)] || { part, position };
    const def = PARTS[part];

    state.edit = { part, position, refs: {} };
    def.columns.forEach((col) => {
      if (col.type === "ref") state.edit.refs[col.field] = row[col.field] || "";
    });

    editTitle.textContent = `Edit ${PART_TITLES[part]}`;
    editSub.textContent = `Row ${position}`;
    editFields.innerHTML = def.columns
      .map((col) => renderEditField(col, row))
      .join("");
    editError.hidden = true;
    editError.textContent = "";
    editSubmitBtn.disabled = false;
    editOverlay.classList.add("visible");

    const first = editFields.querySelector("textarea, .irc8d-ref-trigger");
    if (first) first.focus();
  }

  function closeEditModal() {
    editOverlay.classList.remove("visible");
    editFields.innerHTML = "";
    state.edit = null;
  }

  // Dropdown interactions inside the modal (picks update the draft only).
  editForm.addEventListener("click", (e) => {
    const trigger = e.target.closest(".irc8d-ref-trigger");
    if (trigger) {
      const listbox = trigger.nextElementSibling;
      const wasOpen = !listbox.hidden;
      closeAllDropdowns();
      listbox.hidden = wasOpen;
      if (!wasOpen) positionListbox(trigger, listbox);
      trigger.setAttribute("aria-expanded", String(!wasOpen));
      return;
    }

    const option = e.target.closest(".irc8d-ref-option");
    if (option && state.edit) {
      const dropdown = option.closest(".irc8d-ref-dropdown");
      const field = dropdown.dataset.field;
      state.edit.refs[field] = option.dataset.value;
      const column = PARTS[state.edit.part].columns.find(
        (c) => c.field === field,
      );
      dropdown.outerHTML = renderRefDropdown(
        column,
        option.dataset.value,
        state.edit.position,
      );
      return;
    }

    if (!e.target.closest(".irc8d-ref-dropdown")) closeAllDropdowns();
  });

  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.edit) return;
    const { part, position, refs } = state.edit;

    const patch = { isLocked: true, ...refs };
    editFields.querySelectorAll("textarea.irc8d-edit-input").forEach((ta) => {
      patch[ta.dataset.field] = ta.value;
    });

    editSubmitBtn.disabled = true;
    editCancelBtn.disabled = true;
    editError.hidden = true;
    try {
      await saveRow(part, position, patch);
      renderTable(part);
      closeEditModal();
    } catch (err) {
      editError.textContent = err.message;
      editError.hidden = false;
      editSubmitBtn.disabled = false;
    } finally {
      editCancelBtn.disabled = false;
    }
  });

  editCancelBtn.addEventListener("click", closeEditModal);

  // A floating list would drift away from its trigger if the field area
  // scrolls or the window resizes, so just close it.
  editFields.addEventListener("scroll", () => closeAllDropdowns());
  window.addEventListener("resize", () => closeAllDropdowns());

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !editOverlay.classList.contains("visible"))
      return;
    const open = editForm.querySelector(".irc8d-ref-listbox:not([hidden])");
    if (open) closeAllDropdowns();
    else closeEditModal();
  });

  // ------------------------------------------------------------------
  // Feedback boxes: saved when the box loses focus, or after a short
  // pause in typing.
  // ------------------------------------------------------------------
  const feedbackTimers = {};

  async function saveFeedback(part) {
    clearTimeout(feedbackTimers[part]);
    const text = feedbackInputs[part].value;
    if (text === (state.feedback[part] || "")) return;
    try {
      const saved = await apiCall("POST", "/irc/irc8d/feedback", {
        year: state.year,
        part,
        text,
      });
      state.feedback[part] = saved.text || "";
    } catch (err) {
      alert(err.message);
    }
  }

  ["A", "B"].forEach((part) => {
    const input = feedbackInputs[part];
    input.addEventListener("input", () => {
      clearTimeout(feedbackTimers[part]);
      feedbackTimers[part] = setTimeout(() => saveFeedback(part), 1000);
    });
    input.addEventListener("blur", () => saveFeedback(part));
  });

  // ------------------------------------------------------------------
  // Reset-page confirmation modal
  //
  // Single scope, no options -- everything on this page is the six fixed
  // plan rows plus the two Feedback boxes, so there's no "values only" vs
  // "everything" split.
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
      await apiCall("DELETE", `/irc/irc8d/reset?year=${state.year}`);
      await loadAll();
    } catch (err) {
      alert(err.message || "Could not reset the data. Please try again.");
    } finally {
      resetConfirmConfirmBtn.disabled = false;
      closeResetConfirm();
    }
  });

  // ------------------------------------------------------------------
  // Print / Save as PDF
  //
  // Builds a print-only copy of Part IV (Part IV-A, Part IV-B, Feedback
  // boxes, signatories) laid out like the OPCRF sheet's page 4, then calls
  // window.print(). Styling is in irc8d_print.css (long bond, landscape).
  // The root is moved to <body> so the print stylesheet can hide the rest
  // of the page.
  // ------------------------------------------------------------------
  const printRoot = document.getElementById("irc8d-print-root");
  const printBtn = document.getElementById("irc8d-print-btn");
  const printCache = { header: {}, authority: { name: "" } };
  if (printRoot) document.body.appendChild(printRoot);

  const pText = (v) => escapeHtml(v == null ? "" : String(v));

  // Same column widths for both tables so they line up, as on the sheet.
  const PRINT_COLGROUP =
    '<colgroup><col style="width:17%"><col style="width:16%"><col style="width:18%"><col style="width:17%"><col style="width:16%"><col style="width:16%"></colgroup>';

  const PRINT_HEADS = {
    A: [
      'Gap Analysis<br><span class="r-sub">(SWOT)</span>',
      "Improvement Area",
      "General Objective",
      "Recommended Improvement Intervention",
      "Timeline",
      "Resources Needed",
    ],
    B: [
      "Strengths",
      "Improvement Needs",
      'Learning Objective<br><span class="r-sub">(based on the developmental intervention)</span>',
      "Recommended Developmental Intervention",
      "Timeline",
      "Resources Needed",
    ],
  };

  function printRefCell(row, column) {
    const ref = row[column.field];
    if (!ref) return "<td></td>";
    const match = state.items.find((c) => c.id === ref);
    if (!match) return "<td></td>";
    const meta = `${match.source ? match.source + " · " : ""}${match.average.toFixed(2)}`;
    return `<td><div class="r-ref-main">${pText(match.main)}</div><div class="r-ref-meta">${pText(meta)}</div></td>`;
  }

  function printPart(part) {
    const def = PARTS[part];
    const heads = PRINT_HEADS[part].map((t) => `<th>${t}</th>`).join("");
    const rows = def.positions
      .map((position) => {
        const row = state.rows[rowKey(part, position)] || {};
        const cells = def.columns
          .map((col) =>
            col.type === "ref"
              ? printRefCell(row, col)
              : `<td>${pText(row[col.field])}</td>`,
          )
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");
    // Feedback reads the live textarea so unsaved typing still prints.
    const feedback = feedbackInputs[part]
      ? feedbackInputs[part].value
      : state.feedback[part] || "";
    return `<div class="r-part">
      <h3>${PART_TITLES[part]}: ${part === "A" ? "Office Improvement Plan" : "Individual Development Plan"}</h3>
      <table class="r-table r-table-${part.toLowerCase()}">
        ${PRINT_COLGROUP}
        <thead>
          <tr class="r-band"><th></th><th></th><th colspan="2">Action Plan</th><th></th><th></th></tr>
          <tr class="r-cols">${heads}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="r-feedback"><span class="r-feedback-label">Feedback:</span>${pText(feedback)}</div>
    </div>`;
  }

  function buildPrintHtml() {
    const h = printCache.header || {};
    const a = printCache.authority || {};
    const up = (v) => (v == null ? "" : String(v).toUpperCase());
    const sign = (name, role) =>
      `<div class="r-sign"><div class="r-sign-name">${pText(up(name))}</div><div class="r-sign-role">${role}</div></div>`;
    return `
      <div class="r-page-label">DepEd OPCRF (ver.Feb2025), page 4 of 4</div>
      <div class="r-title">Part IV: Improvement and Development Plans</div>
      ${printPart("A")}
      ${printPart("B")}
      <div class="r-signs">
        ${sign(h.nameOfEmployee, "RATEE")}
        ${sign(h.nameOfRater, "RATER")}
        ${sign(a.name, "APPROVING AUTHORITY")}
      </div>`;
  }

  function refreshPrintRoot() {
    if (printRoot) printRoot.innerHTML = buildPrintHtml();
  }

  // Ratee / Rater / Approving Authority names are the ones kept on EOPCRF I.
  async function loadPrintExtras() {
    const [h, a] = await Promise.allSettled([
      apiCall("GET", "/api/irc8a/report-header"),
      apiCall("GET", "/api/irc8a/approving-authority"),
    ]);
    if (h.status === "fulfilled") printCache.header = h.value;
    if (a.status === "fulfilled") printCache.authority = a.value;
  }

  if (printBtn && printRoot) {
    printBtn.addEventListener("click", async () => {
      printBtn.disabled = true;
      try {
        await loadPrintExtras();
        refreshPrintRoot();
        window.print();
      } finally {
        printBtn.disabled = false;
      }
    });
    // Ctrl+P / browser menu print gets the same layout from cached data.
    window.addEventListener("beforeprint", refreshPrintRoot);
  }

  // ------------------------------------------------------------------
  // Initial load
  // ------------------------------------------------------------------
  loadAll();
})();
