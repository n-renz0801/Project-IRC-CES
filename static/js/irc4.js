/* IRC4 - TA Catch-up Plan - JS */

(function () {
  "use strict";

  const MIN_OBJECTIVES = 3;
  const MAX_SUGGESTIONS = 8;

  // Master school list + DEDP-priority set, fetched once from the School
  // table on init (see loadSchools()) instead of being hardcoded here —
  // this keeps IRC4 in sync with IRC2a/IRC2b/the rest of the app by
  // construction, rather than by manually copy-pasting the roster.
  // A school may be selected into more than one group (e.g. it receives
  // TA in two different months) — no exclusivity here.
  let SCHOOLS = [];
  let DEDP_PRIORITY = new Set();

  // School name -> count of IRC2b months marked "provided" this year.
  // Fetched fresh every time the Add/Edit Group modal opens (see
  // refreshTaStatus()); schools with no TA yet simply have no entry.
  let taStatusMap = {};

  const MONTH_LABELS = {
    Jan: "January",
    Feb: "February",
    Mar: "March",
    Apr: "April",
    May: "May",
    Jun: "June",
    Jul: "July",
    Aug: "August",
    Sep: "September",
    Oct: "October",
    Nov: "November",
    Dec: "December",
  };

  /**
   * Single-activity state (only one activity per plan), mirroring
   * IRC4Plan.to_dict() on the server. `id` fields below are the database
   * row ids returned by /irc/irc4/*, not locally-generated ones — every
   * objective/group is persisted (and assigned its real id) at the point
   * it's created, not just when the page is later saved as a whole.
   * {
   *   activity: string,
   *   objectives: Array<{ id, text }>,
   *   groups: Array<{ id, schools: string[], schedule: string }>,
   *   taReceiver: string,
   *   movs: string,
   * }
   */
  let data = {
    activity: "",
    objectives: [],
    groups: [],
    taReceiver: "",
    movs: "",
  };

  // Working copy edited inside the modal; only committed to `data.groups`
  // on Save. `editingGroupId` is null while adding a brand-new group.
  let modalDraft = { editingGroupId: null, schools: [], schedule: "" };

  const els = {};

  // ---- server fetch helpers -------------------------------------------

  async function loadSchools() {
    try {
      const res = await fetch("/irc/schools");
      const payload = await res.json();
      const list = (payload && payload.schools) || [];
      SCHOOLS = list
        .map((s) => ({ name: s.name, level: s.level }))
        .sort((a, b) => a.name.localeCompare(b.name));
      DEDP_PRIORITY = new Set(
        list.filter((s) => s.is_dedp_priority).map((s) => s.name),
      );
    } catch (e) {
      SCHOOLS = [];
      DEDP_PRIORITY = new Set();
    }
  }

  // Fetched once when the Add/Edit Group modal opens (see openModal), so
  // the indicator reflects however up-to-date IRC2b's records are at the
  // moment the modal is used, without re-fetching on every keystroke.
  async function refreshTaStatus() {
    try {
      const res = await fetch("/irc/irc4/school-ta-status");
      taStatusMap = (await res.json()) || {};
    } catch (e) {
      taStatusMap = {};
    }
  }

  async function loadPlan() {
    try {
      const res = await fetch("/irc/irc4/data");
      const payload = await res.json();
      data = {
        activity: payload.activity || "",
        objectives: payload.objectives || [],
        groups: payload.groups || [],
        taReceiver: payload.taReceiver || "",
        movs: payload.movs || "",
      };
    } catch (e) {
      /* Falls back to the blank baseline declared above. */
    }
  }

  function savePlanField(field, value) {
    fetch("/irc/irc4/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    }).catch(() => {
      /* Best-effort, same as IRC2b's per-checkbox save: the field already
         reflects the change locally; a failed save just risks stale data
         on the next reload. */
    });
  }

  function debounce(fn, waitMs) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), waitMs);
    };
  }

  function letterLabel(index) {
    const letter = String.fromCharCode(97 + (index % 26)); // 'a'..'z'
    const repeat = Math.floor(index / 26) + 1;
    return letter.repeat(repeat);
  }

  function getSchoolMeta(name) {
    return SCHOOLS.find((s) => s.name === name) || null;
  }

  function isDedpSchool(name) {
    return DEDP_PRIORITY.has(name);
  }

  function monthEntries() {
    return Object.keys(MONTH_LABELS).map((code) => ({
      code,
      label: MONTH_LABELS[code],
    }));
  }

  // `activeDropdown` tracks whichever ONE of the two dropdowns (school
  // search or schedule combobox) is currently open, so scroll/resize can
  // reposition it and a click outside of it can close it.
  let activeDropdown = null; // { inputEl, dropdownEl, onOutsideClick } | null

  function positionFixedDropdown(inputEl, dropdownEl) {
    const rect = inputEl.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    // Generous cap so many more rows are visible than the old in-modal
    // panel allowed, but still bounded by actual remaining viewport space.
    const maxHeight = Math.max(160, Math.min(360, spaceBelow));

    dropdownEl.style.position = "fixed";
    dropdownEl.style.left = `${rect.left}px`;
    dropdownEl.style.top = `${rect.bottom + 4}px`;
    dropdownEl.style.width = `${rect.width}px`;
    dropdownEl.style.maxHeight = `${maxHeight}px`;
  }

  // `onOutsideClick` is whichever "hide" function (hideSuggestions /
  // hideScheduleSuggestions, or a small wrapper around one of those) is
  // right for the given dropdown — it's what actually gets called when
  // the person clicks somewhere outside the input + panel. See the
  // document-level "mousedown" listener below.
  function trackDropdown(inputEl, dropdownEl, onOutsideClick) {
    activeDropdown = { inputEl, dropdownEl, onOutsideClick };
    positionFixedDropdown(inputEl, dropdownEl);
  }

  function untrackDropdown(dropdownEl) {
    if (activeDropdown && activeDropdown.dropdownEl === dropdownEl) {
      activeDropdown = null;
    }
  }

  function repositionActiveDropdown() {
    if (!activeDropdown) return;
    positionFixedDropdown(activeDropdown.inputEl, activeDropdown.dropdownEl);
  }

  // Capture phase so this also fires for scrolling inside the modal body,
  // not just the window itself.
  window.addEventListener("scroll", repositionActiveDropdown, true);
  window.addEventListener("resize", repositionActiveDropdown);

  // Closes whichever dropdown is open when the person clicks/mousedowns
  // anywhere outside of its input + panel.
  //
  // This REPLACES the old blur+setTimeout approach on purpose: a plain
  // `blur` listener on the input fires any time the input loses focus for
  // ANY reason — including the browser window itself losing focus, which
  // is exactly what happens when opening devtools (via right-click
  // "Inspect" or a keyboard shortcut) to look at the dropdown. That made
  // the panel disappear the instant someone tried to inspect it. A real
  // click/mousedown somewhere else on the page is the only thing that
  // should close it, so that's the only thing listened for here.
  //
  // A suggestion item's own "mousedown" handler (see
  // buildSchoolSuggestionItem / renderScheduleSuggestions) runs first —
  // DOM events reach the actual click target before bubbling up to
  // document — so selecting an item already hides its dropdown (clearing
  // activeDropdown) before this listener ever has to act.
  document.addEventListener("mousedown", (e) => {
    if (!activeDropdown) return;
    const { inputEl, dropdownEl, onOutsideClick } = activeDropdown;
    if (inputEl.contains(e.target) || dropdownEl.contains(e.target)) return;
    onOutsideClick();
  });

  function cacheEls() {
    els.root = document.getElementById("irc4-tab");

    els.activityField = document.getElementById("irc4ActivityField");
    els.taReceiverField = document.getElementById("irc4TaReceiverField");
    els.movsField = document.getElementById("irc4MovsField");

    els.activityActionBtn = document.getElementById("irc4ActivityActionBtn");
    els.taReceiverActionBtn = document.getElementById(
      "irc4TaReceiverActionBtn",
    );
    els.movsActionBtn = document.getElementById("irc4MovsActionBtn");

    // Generic Add/Edit modal shared by Activity, TA Receiver, and MOV's.
    els.fieldModal = document.getElementById("irc4FieldModal");
    els.fieldModalOverlay = document.getElementById("irc4FieldModalOverlay");
    els.fieldModalTitle = document.getElementById("irc4FieldModalTitle");
    els.fieldModalClose = document.getElementById("irc4FieldModalClose");
    els.fieldModalLabel = document.getElementById("irc4FieldModalLabel");
    els.fieldModalInput = document.getElementById("irc4FieldModalInput");
    els.fieldModalDelete = document.getElementById("irc4FieldModalDelete");
    els.fieldModalCancel = document.getElementById("irc4FieldModalCancel");
    els.fieldModalSave = document.getElementById("irc4FieldModalSave");

    els.objectivesList = document.getElementById("irc4ObjectivesList");
    els.objectivesActionBtn = document.getElementById(
      "irc4ObjectivesActionBtn",
    );
    els.objectivesWarning = document.getElementById("irc4ObjectivesWarning");

    // Add/Edit Objectives modal.
    els.objectivesModal = document.getElementById("irc4ObjectivesModal");
    els.objectivesModalOverlay = document.getElementById(
      "irc4ObjectivesModalOverlay",
    );
    els.objectivesModalClose = document.getElementById(
      "irc4ObjectivesModalClose",
    );
    els.objectivesModalList = document.getElementById(
      "irc4ObjectivesModalList",
    );
    els.objectivesModalAddRow = document.getElementById(
      "irc4ObjectivesModalAddRow",
    );
    els.objectivesModalWarning = document.getElementById(
      "irc4ObjectivesModalWarning",
    );
    els.objectivesModalCancel = document.getElementById(
      "irc4ObjectivesModalCancel",
    );
    els.objectivesModalSave = document.getElementById(
      "irc4ObjectivesModalSave",
    );
    els.objectiveRowTemplate = document.getElementById(
      "irc4-objective-row-template",
    );

    // Delete-confirmation dialog for a single row inside the modal above.
    els.objectiveDeleteConfirm = document.getElementById(
      "irc4ObjectiveDeleteConfirm",
    );
    els.objectiveDeleteCancel = document.getElementById(
      "irc4ObjectiveDeleteCancel",
    );
    els.objectiveDeleteConfirmBtn = document.getElementById(
      "irc4ObjectiveDeleteConfirmBtn",
    );

    els.groupsList = document.getElementById("irc4GroupsList");
    els.groupsEmpty = document.getElementById("irc4GroupsEmpty");
    els.addGroupBtn = document.getElementById("irc4AddGroupBtn");

    els.objectiveTemplate = document.getElementById("irc4-objective-template");
    els.groupViewTemplate = document.getElementById("irc4-group-view-template");
    els.chipTemplate = document.getElementById("irc4-chip-template");

    // Modal
    els.modal = document.getElementById("irc4GroupModal");
    els.modalOverlay = document.getElementById("irc4ModalOverlay");
    els.modalTitle = document.getElementById("irc4ModalTitle");
    els.modalClose = document.getElementById("irc4ModalClose");
    els.modalCancel = document.getElementById("irc4ModalCancel");
    els.modalSave = document.getElementById("irc4ModalSave");
    els.modalSchoolSearch = document.getElementById("irc4ModalSchoolSearch");
    els.modalSchoolSuggestions = document.getElementById(
      "irc4ModalSchoolSuggestions",
    );
    els.modalSchoolChips = document.getElementById("irc4ModalSchoolChips");
    els.modalSchoolEmptyHint = document.getElementById(
      "irc4ModalSchoolEmptyHint",
    );
    els.modalScheduleInput = document.getElementById("irc4ModalScheduleInput");
    els.modalScheduleSuggestions = document.getElementById(
      "irc4ModalScheduleSuggestions",
    );

    // Save to PDF button — see saveToPdf() near the bottom of this file.
    els.pdfBtn = document.getElementById("irc4PdfBtn");

    // Reset button + its confirmation modal (separate from the Add/Edit
    // Group modal above — no shared state).
    els.resetBtn = document.getElementById("irc4ResetBtn");
    els.resetModal = document.getElementById("irc4ResetModal");
    els.resetModalCancel = document.getElementById("irc4ResetModalCancel");
    els.resetModalConfirm = document.getElementById("irc4ResetModalConfirm");

    // Delete-confirmation dialog for a single group card.
    els.groupDeleteConfirm = document.getElementById("irc4GroupDeleteConfirm");
    els.groupDeleteCancel = document.getElementById("irc4GroupDeleteCancel");
    els.groupDeleteConfirmBtn = document.getElementById(
      "irc4GroupDeleteConfirmBtn",
    );
  }

  // Textareas are non-resizable (CSS: resize: none) and grow purely with
  // their content, so there is never a manual drag handle. Safe to call on
  // any textarea at any time — it just measures and re-applies height.
  function autoGrow(textarea) {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  // ============================================================
  // Read-only display field (Activity, TA Receiver, MOV's)
  //
  // These three no longer edit inline: the field just shows the current
  // text (or its placeholder). All changes happen through the header
  // action button, which opens the shared Add/Edit modal below.
  // ============================================================

  function initDisplayField(fieldEl, initialValue) {
    const textEl = fieldEl.querySelector('[data-role="text"]');
    const placeholder = textEl.dataset.placeholder || "";
    let value = initialValue || "";

    function refreshView() {
      if (value.trim()) {
        textEl.textContent = value;
        textEl.classList.remove("is-placeholder");
      } else {
        textEl.textContent = placeholder;
        textEl.classList.add("is-placeholder");
      }
    }

    function setValue(val) {
      value = val || "";
      refreshView();
    }

    function getValue() {
      return value;
    }

    refreshView();

    return { getValue, setValue };
  }

  // ============================================================
  // Objectives
  //
  // The main page only ever shows a read-only list (see
  // irc4-objective-template — no edit/save/remove controls in that
  // markup at all). Every add/edit/remove happens inside
  // irc4ObjectivesModal instead, against a local `objectivesDraft`
  // that's only committed to the server (and back into `data.objectives`
  // + the main-page list) when "Save Objectives" is clicked; Cancel just
  // throws the draft away. See openObjectivesModal / saveObjectivesModal
  // below.
  // ============================================================

  function relabelObjectives(listEl) {
    listEl.querySelectorAll(".irc4-objective-item").forEach((li, idx) => {
      li.querySelector(".irc4-objective-label").textContent =
        `${letterLabel(idx)}.`;
    });
  }

  function updateObjectivesWarning() {
    els.objectivesWarning.hidden = data.objectives.length >= MIN_OBJECTIVES;
  }

  // Header button reads "Add Objective" until at least one objective
  // actually has text in it, then switches to "Edit Objectives" — same
  // hasValue convention as updateFieldActionLabel() for Activity/TA
  // Receiver/MOV's.
  function updateObjectivesActionLabel() {
    const label = els.objectivesActionBtn.querySelector(
      '[data-role="action-label"]',
    );
    if (!label) return;
    const hasValue = data.objectives.some((o) => o.text && o.text.trim());
    label.textContent = hasValue ? "Edit Objectives" : "Add Objective";
  }

  function buildObjectiveViewNode(obj) {
    const frag = els.objectiveTemplate.content.cloneNode(true);
    const li = frag.querySelector(".irc4-objective-item");
    li.dataset.objId = obj.id;
    const textEl = li.querySelector('[data-role="text"]');
    const placeholder = textEl.dataset.placeholder || "";
    if (obj.text && obj.text.trim()) {
      textEl.textContent = obj.text;
      textEl.classList.remove("is-placeholder");
    } else {
      textEl.textContent = placeholder;
      textEl.classList.add("is-placeholder");
    }
    return li;
  }

  // Renders whatever's currently in data.objectives — used at init (after
  // loadPlan()) and again after the modal is saved.
  function renderObjectivesFromData() {
    els.objectivesList.innerHTML = "";
    data.objectives.forEach((obj) => {
      els.objectivesList.appendChild(buildObjectiveViewNode(obj));
    });
    relabelObjectives(els.objectivesList);
    updateObjectivesWarning();
    updateObjectivesActionLabel();
  }

  // "Add Objective" (used only by resetPlan()'s re-seeding, now that the
  // main list itself is read-only) creates the row server-side first, so
  // it gets a real id before anything tries to reference it.
  async function addObjective() {
    let obj;
    try {
      const res = await fetch("/irc/irc4/objective", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "" }),
      });
      obj = await res.json();
    } catch (e) {
      return; // Can't track an objective that was never actually saved.
    }

    data.objectives.push(obj);
    els.objectivesList.appendChild(buildObjectiveViewNode(obj));
    relabelObjectives(els.objectivesList);
    updateObjectivesWarning();
  }

  // ---- Add/Edit Objectives modal ---------------------------------------

  // Working copy edited inside the modal; each entry is
  // { id: <existing id> | null, text: string }. Only committed to
  // data.objectives (and the server) on Save — see saveObjectivesModal().
  let objectivesDraft = [];
  // Ids of objectives that existed on the server and were removed inside
  // the modal; DELETEd only when Save actually goes through, so Cancel
  // leaves the server untouched.
  let objectivesDeletedIds = [];
  // Index (into objectivesDraft) pending removal while the delete
  // confirmation dialog is open; null otherwise.
  let pendingRemoveIndex = null;

  function renderObjectivesModalRows() {
    els.objectivesModalList.innerHTML = "";
    objectivesDraft.forEach((entry, idx) => {
      const frag = els.objectiveRowTemplate.content.cloneNode(true);
      const li = frag.querySelector(".irc4-objective-item");
      const input = li.querySelector('[data-role="input"]');
      input.value = entry.text || "";

      input.addEventListener("input", () => {
        autoGrow(input);
        entry.text = input.value;
      });

      li.querySelector('[data-role="remove-btn"]').addEventListener(
        "click",
        () => {
          pendingRemoveIndex = idx;
          els.objectiveDeleteConfirm.style.display = "flex";
        },
      );

      els.objectivesModalList.appendChild(li);
    });
    relabelObjectives(els.objectivesModalList);
    els.objectivesModalList
      .querySelectorAll(".irc4-objective-input")
      .forEach(autoGrow);
    els.objectivesModalWarning.hidden =
      objectivesDraft.length >= MIN_OBJECTIVES;
  }

  function openObjectivesModal() {
    objectivesDraft = data.objectives.map((o) => ({ id: o.id, text: o.text }));
    objectivesDeletedIds = [];
    pendingRemoveIndex = null;
    renderObjectivesModalRows();
    els.objectivesModal.style.display = "flex";
  }

  function closeObjectivesModal() {
    els.objectivesModal.style.display = "none";
    objectivesDraft = [];
    objectivesDeletedIds = [];
    pendingRemoveIndex = null;
  }

  function addObjectiveDraftRow() {
    objectivesDraft.push({ id: null, text: "" });
    renderObjectivesModalRows();
    const inputs = els.objectivesModalList.querySelectorAll(
      ".irc4-objective-input",
    );
    const last = inputs[inputs.length - 1];
    if (last) last.focus();
  }

  function closeObjectiveDeleteConfirm() {
    els.objectiveDeleteConfirm.style.display = "none";
    pendingRemoveIndex = null;
  }

  // Only actually removes the row from the draft once the person confirms
  // in irc4ObjectiveDeleteConfirm — nothing is deleted on the first click.
  function confirmRemoveObjectiveDraftRow() {
    if (pendingRemoveIndex === null) return;
    const [removed] = objectivesDraft.splice(pendingRemoveIndex, 1);
    if (removed && removed.id) objectivesDeletedIds.push(removed.id);
    closeObjectiveDeleteConfirm();
    renderObjectivesModalRows();
  }

  // Persists the whole draft: deletes anything removed, updates anything
  // that already had an id, and creates anything new — then reflects the
  // final result back into data.objectives and the read-only main list.
  async function saveObjectivesModal() {
    els.objectivesModalSave.disabled = true;
    try {
      await Promise.all(
        objectivesDeletedIds.map((id) =>
          fetch(`/irc/irc4/objective/${encodeURIComponent(id)}`, {
            method: "DELETE",
          }).catch(() => {}),
        ),
      );

      const saved = await Promise.all(
        objectivesDraft.map(async (entry) => {
          try {
            const res = await fetch("/irc/irc4/objective", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: entry.id, text: entry.text }),
            });
            return await res.json();
          } catch (e) {
            // Best-effort: fall back to the local draft entry so this
            // objective doesn't just vanish from the page on a network
            // hiccup (it will simply re-sync on the next successful save
            // or page load).
            return { id: entry.id, text: entry.text };
          }
        }),
      );

      data.objectives = saved;
      renderObjectivesFromData();
      closeObjectivesModal();
    } finally {
      els.objectivesModalSave.disabled = false;
    }
  }

  // ============================================================
  // School + Schedule groups — read-only cards on the page, all editing
  // happens through the Add/Edit Group modal.
  // ============================================================

  function updateGroupsEmptyState() {
    els.groupsEmpty.hidden = data.groups.length !== 0;
  }

  function groupTitle(group) {
    if (!group.schedule) return "No month selected";
    return `${MONTH_LABELS[group.schedule] || group.schedule} Schedule`;
  }

  function buildGroupViewNode(group) {
    const frag = els.groupViewTemplate.content.cloneNode(true);
    const card = frag.querySelector(".irc4-group-view");
    card.dataset.groupId = group.id;

    const title = card.querySelector('[data-role="title"]');
    title.textContent = groupTitle(group);
    title.classList.toggle("is-unset", !group.schedule);

    const list = card.querySelector('[data-role="school-list"]');
    list.innerHTML = "";
    if (group.schools.length === 0) {
      const li = document.createElement("li");
      li.className = "irc4-group-view-empty";
      li.textContent = "No schools selected";
      list.appendChild(li);
    } else {
      group.schools.forEach((name) => {
        const meta = getSchoolMeta(name);
        const li = document.createElement("li");
        li.className = "irc4-group-school-item";
        if (meta) li.dataset.level = meta.level;

        const nameSpan = document.createElement("span");
        nameSpan.className = "irc4-group-school-name";
        nameSpan.textContent = name;
        li.appendChild(nameSpan);

        if (isDedpSchool(name)) {
          const badge = document.createElement("span");
          badge.className = "irc4-badge irc4-badge--dedp";
          badge.textContent = "DEDP";
          li.appendChild(badge);
        }

        list.appendChild(li);
      });
    }

    return card;
  }

  function renderGroupView(group) {
    const existing = els.groupsList.querySelector(
      `.irc4-group-view[data-group-id="${CSS.escape(String(group.id))}"]`,
    );
    const node = buildGroupViewNode(group);
    if (existing) {
      existing.replaceWith(node);
    } else {
      els.groupsList.appendChild(node);
    }
  }

  function removeGroup(groupId) {
    const idx = data.groups.findIndex((g) => String(g.id) === String(groupId));
    if (idx === -1) return;
    data.groups.splice(idx, 1);

    const card = els.groupsList.querySelector(
      `.irc4-group-view[data-group-id="${CSS.escape(String(groupId))}"]`,
    );
    if (card) card.remove();

    updateGroupsEmptyState();

    fetch(`/irc/irc4/group/${encodeURIComponent(groupId)}`, {
      method: "DELETE",
    }).catch(() => {
      /* Best-effort, same as everywhere else in this file. */
    });
  }

  function findGroup(groupId) {
    return data.groups.find((g) => String(g.id) === String(groupId)) || null;
  }

  // Id of the group pending deletion while irc4GroupDeleteConfirm is open;
  // null otherwise. Nothing is removed until the person confirms.
  let pendingDeleteGroupId = null;

  function openGroupDeleteConfirm(groupId) {
    pendingDeleteGroupId = groupId;
    els.groupDeleteConfirm.style.display = "flex";
  }

  function closeGroupDeleteConfirm() {
    els.groupDeleteConfirm.style.display = "none";
    pendingDeleteGroupId = null;
  }

  function confirmDeleteGroup() {
    if (pendingDeleteGroupId === null) return;
    removeGroup(pendingDeleteGroupId);
    closeGroupDeleteConfirm();
  }

  function onGroupsClick(e) {
    const deleteBtn = e.target.closest(".irc4-group-delete-btn");
    if (deleteBtn) {
      const card = deleteBtn.closest(".irc4-group-view");
      if (card) openGroupDeleteConfirm(card.dataset.groupId);
      return;
    }

    const editBtn = e.target.closest(".irc4-group-edit-btn");
    if (editBtn) {
      const card = editBtn.closest(".irc4-group-view");
      if (card) openEditGroupModal(card.dataset.groupId);
      return;
    }
  }

  // ---- modal: TA-provided indicator (sourced from IRC2b, via taStatusMap) --
  //
  // Shown only inside the modal (search dropdown + selected chips) — never
  // on the main page's read-only group cards. Always renders the box
  // (school's level color), but only fills in the check + count when
  // taStatusMap has a > 0 entry for that school; otherwise it's an empty
  // colored strip of the same fixed width.

  function buildTaIndicatorBox(name, meta) {
    const box = document.createElement("span");
    box.className = "irc4-ta-indicator";
    if (meta && meta.level) box.dataset.level = meta.level;

    const count = taStatusMap[name] || 0;
    if (count > 0) {
      // Explicit width/height attributes (not just the CSS class) so the
      // icon can't be resized by some unrelated global "svg { ... }" rule
      // elsewhere in the app — same belt-and-suspenders reasoning as the
      // #irc4GroupModal-scoped CSS this box relies on (see irc4.css).
      box.innerHTML =
        '<svg class="irc4-ta-indicator-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="20 6 9 17 4 12"></polyline></svg>' +
        `<span class="irc4-ta-indicator-label">TA<br>${count}X</span>`;
    }

    return box;
  }

  // ---- modal: school search + selected list --------------------------

  function renderModalChips() {
    els.modalSchoolChips.innerHTML = "";
    modalDraft.schools.forEach((name) => {
      const frag = els.chipTemplate.content.cloneNode(true);
      const row = frag.querySelector(".irc4-school-row");
      row.dataset.school = name;

      const meta = getSchoolMeta(name);
      if (meta) row.dataset.level = meta.level;

      // Flush against the row's left edge, ahead of everything else.
      row.insertBefore(buildTaIndicatorBox(name, meta), row.firstChild);

      row.querySelector(".irc4-school-row-name").textContent = name;

      if (isDedpSchool(name)) {
        // Reverted: badge is inserted directly into the row (a plain flex
        // sibling next to the name and remove button), spread apart via
        // justify-content: space-between on .irc4-school-row-content — not
        // grouped into a wrapper next to the remove button.
        //
        // IMPORTANT: the remove button lives inside .irc4-school-row-content
        // (a grandchild of `row`, not a direct child — see the
        // #irc4-chip-template markup in irc4.html), so insertBefore has to
        // be called ON that content element, not on `row` itself. Calling
        // row.insertBefore(badge, <a node two levels deep>) throws
        // "the node before which the new node is to be inserted is not a
        // child of this node" — which, thrown from inside this forEach,
        // silently aborted rendering of this row AND every school after it
        // in the list the moment a DEDP school was reached. That's why only
        // the schools added before the first DEDP one ever showed up in the
        // modal, even though every school (DEDP or not) was still being
        // saved correctly to modalDraft.schools and sent to the server.
        const content = row.querySelector(".irc4-school-row-content");
        const badge = document.createElement("span");
        badge.className = "irc4-badge irc4-badge--dedp";
        badge.textContent = "DEDP";
        content.insertBefore(badge, content.querySelector(".irc4-chip-remove"));
      }

      els.modalSchoolChips.appendChild(row);
    });
    els.modalSchoolEmptyHint.hidden = modalDraft.schools.length !== 0;
  }

  function hideSuggestions() {
    els.modalSchoolSuggestions.hidden = true;
    els.modalSchoolSuggestions.innerHTML = "";
    untrackDropdown(els.modalSchoolSuggestions);
  }

  function buildSchoolSuggestionItem(school) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "irc4-school-suggestion-item";
    item.dataset.name = school.name;
    if (school.level) item.dataset.level = school.level;

    // Flush against the item's left edge, ahead of everything else.
    item.appendChild(buildTaIndicatorBox(school.name, school));

    const content = document.createElement("span");
    content.className = "irc4-school-suggestion-content";

    const nameSpan = document.createElement("span");
    nameSpan.className = "irc4-school-suggestion-name";
    nameSpan.textContent = school.name;
    content.appendChild(nameSpan);

    if (isDedpSchool(school.name)) {
      const badge = document.createElement("span");
      badge.className = "irc4-badge irc4-badge--dedp";
      badge.textContent = "DEDP";
      content.appendChild(badge);
    }

    item.appendChild(content);

    // mousedown + preventDefault so the search input never blurs before
    // the click is registered (avoids a focus/blur race condition).
    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      addSchoolToDraft(school.name);
    });

    return item;
  }

  // With no query, show every not-yet-selected school (the panel scrolls,
  // so there's no need to truncate the full list) — this is the "default"
  // dropdown view that opens on click/focus. Once there's a query, narrow
  // it down and cap it so the list stays easy to scan.
  function renderSuggestions(query) {
    const q = query.trim().toLowerCase();
    const available = SCHOOLS.filter(
      (s) => !modalDraft.schools.includes(s.name),
    );
    const matches = q
      ? available
          .filter((s) => s.name.toLowerCase().includes(q))
          .slice(0, MAX_SUGGESTIONS)
      : available;

    if (matches.length === 0) {
      hideSuggestions();
      return;
    }

    els.modalSchoolSuggestions.innerHTML = "";
    matches.forEach((s) => {
      els.modalSchoolSuggestions.appendChild(buildSchoolSuggestionItem(s));
    });
    els.modalSchoolSuggestions.hidden = false;
    trackDropdown(
      els.modalSchoolSearch,
      els.modalSchoolSuggestions,
      hideSuggestions,
    );
  }

  function addSchoolToDraft(name) {
    if (!name) return;
    if (!modalDraft.schools.includes(name)) {
      modalDraft.schools.push(name);
    }
    els.modalSchoolSearch.value = "";
    hideSuggestions();
    renderModalChips();
    els.modalSchoolSearch.focus();
  }

  function removeSchoolFromDraft(name) {
    const idx = modalDraft.schools.indexOf(name);
    if (idx === -1) return;
    modalDraft.schools.splice(idx, 1);
    renderModalChips();
  }

  function onModalChipsClick(e) {
    const removeBtn = e.target.closest(".irc4-chip-remove");
    if (!removeBtn) return;
    const row = removeBtn.closest(".irc4-school-row");
    if (row) removeSchoolFromDraft(row.dataset.school);
  }

  function onModalSchoolSearchInput(e) {
    renderSuggestions(e.target.value);
  }

  function onModalSchoolSearchKeydown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const firstItem = els.modalSchoolSuggestions.querySelector(
        ".irc4-school-suggestion-item",
      );
      if (firstItem) addSchoolToDraft(firstItem.dataset.name);
    } else if (e.key === "Escape") {
      hideSuggestions();
    }
  }

  // Opening the field (by focusing or clicking it) always shows the full
  // dropdown of remaining schools, regardless of whatever text happens to
  // be sitting in the input. It only narrows once the person actually
  // types (see onModalSchoolSearchInput) — so re-clicking a field never
  // feels "stuck" in plain typing mode with no options visible.
  //
  // `suppressNextSchoolOpen` guards the one case where we focus() the
  // field ourselves (right when the modal opens) — that shouldn't pop the
  // dropdown open before the person has actually asked for it.
  let suppressNextSchoolOpen = false;

  function onModalSchoolSearchOpen() {
    if (suppressNextSchoolOpen) {
      suppressNextSchoolOpen = false;
      return;
    }
    renderSuggestions("");
  }

  // ---- modal: schedule combobox ---------------------------------------
  //
  // Same interaction pattern as the school search above: clicking/focusing
  // the field opens a dropdown of all twelve months so it can be picked
  // with the mouse, and typing filters that list down (by name or 3-letter
  // code) so it can be reached from the keyboard too. It also uses the
  // same fixed-position tracking (trackDropdown/untrackDropdown) as the
  // school search, so it escapes the modal's clipped bounds in exactly
  // the same way, and closes the same way too (click outside — see the
  // document-level "mousedown" listener above).

  function hideScheduleSuggestions() {
    els.modalScheduleSuggestions.hidden = true;
    els.modalScheduleSuggestions.innerHTML = "";
    untrackDropdown(els.modalScheduleSuggestions);
  }

  function renderScheduleSuggestions(query) {
    const q = query.trim().toLowerCase();
    const all = monthEntries();
    const matches = q
      ? all.filter(
          (m) =>
            m.label.toLowerCase().includes(q) ||
            m.code.toLowerCase().includes(q),
        )
      : all;

    if (matches.length === 0) {
      hideScheduleSuggestions();
      return;
    }

    els.modalScheduleSuggestions.innerHTML = "";
    matches.forEach((m) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "irc4-school-suggestion-item";
      item.dataset.code = m.code;

      const content = document.createElement("span");
      content.className = "irc4-school-suggestion-content";
      content.textContent = m.label;
      item.appendChild(content);

      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectScheduleMonth(m.code);
      });
      els.modalScheduleSuggestions.appendChild(item);
    });
    els.modalScheduleSuggestions.hidden = false;
    trackDropdown(
      els.modalScheduleInput,
      els.modalScheduleSuggestions,
      // Unlike the school search, closing this one also needs to
      // reconcile whatever's sitting in the text input with a real month
      // (see resolveScheduleInput) — clicking a suggestion item already
      // does that via selectScheduleMonth, but clicking away without
      // picking one needs the same fallback the old blur handler had.
      () => {
        resolveScheduleInput();
        hideScheduleSuggestions();
      },
    );
  }

  function selectScheduleMonth(code) {
    modalDraft.schedule = code;
    els.modalScheduleInput.value = MONTH_LABELS[code] || "";
    hideScheduleSuggestions();
    els.modalScheduleInput.focus();
  }

  // Reconciles whatever text is currently sitting in the input with a real
  // month. The schedule is a fixed enum, so free text that doesn't match
  // anything falls back to the last confirmed selection instead of being
  // saved as-is.
  function resolveScheduleInput() {
    const typed = els.modalScheduleInput.value.trim().toLowerCase();

    if (!typed) {
      modalDraft.schedule = "";
      els.modalScheduleInput.value = "";
      return;
    }

    const match = monthEntries().find(
      (m) => m.label.toLowerCase() === typed || m.code.toLowerCase() === typed,
    );

    if (match) {
      modalDraft.schedule = match.code;
      els.modalScheduleInput.value = match.label;
    } else {
      els.modalScheduleInput.value = MONTH_LABELS[modalDraft.schedule] || "";
    }
  }

  function onModalScheduleInput(e) {
    renderScheduleSuggestions(e.target.value);
  }

  // Opening the field (focus or click) always shows all twelve months,
  // even if a month was already picked and its label is sitting in the
  // input — otherwise re-clicking a filled-in field just filters the list
  // down to the one already-selected match. Only actual typing narrows it
  // (see onModalScheduleInput).
  function onModalScheduleOpen() {
    renderScheduleSuggestions("");
  }

  function onModalScheduleKeydown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const firstItem = els.modalScheduleSuggestions.querySelector(
        ".irc4-school-suggestion-item",
      );
      if (firstItem) {
        selectScheduleMonth(firstItem.dataset.code);
      } else {
        resolveScheduleInput();
        hideScheduleSuggestions();
      }
    } else if (e.key === "Escape") {
      resolveScheduleInput();
      hideScheduleSuggestions();
    }
  }

  // ---- modal: open / close / save -------------------------------------

  async function openModal() {
    els.modalSchoolSearch.value = "";
    hideSuggestions();
    els.modalScheduleInput.value = MONTH_LABELS[modalDraft.schedule] || "";
    hideScheduleSuggestions();

    els.modal.style.display = "flex";
    suppressNextSchoolOpen = true;
    els.modalSchoolSearch.focus();

    // Render immediately with whatever TA-status data is already cached
    // (empty on the very first open this session), then fetch a fresh
    // copy and re-render so the indicator reflects IRC2b's current
    // records rather than a stale snapshot from an earlier modal open.
    renderModalChips();
    await refreshTaStatus();
    renderModalChips();
  }

  async function openAddGroupModal() {
    modalDraft = { editingGroupId: null, schools: [], schedule: "" };
    els.modalTitle.textContent = "Add Group";
    els.modalSave.textContent = "Save Group";
    await openModal();
  }

  async function openEditGroupModal(groupId) {
    const group = findGroup(groupId);
    if (!group) return;
    modalDraft = {
      editingGroupId: group.id,
      schools: group.schools.slice(),
      schedule: group.schedule,
    };
    els.modalTitle.textContent = "Edit Group";
    els.modalSave.textContent = "Save Changes";
    await openModal();
  }

  function closeModal() {
    els.modal.style.display = "none";
    hideSuggestions();
    hideScheduleSuggestions();
  }

  async function saveModal() {
    // Resolve any schedule text the user typed but never blurred out of
    // (e.g. they typed a month then clicked Save directly).
    resolveScheduleInput();

    const payload = {
      schools: modalDraft.schools.slice(),
      schedule: modalDraft.schedule || null,
    };
    if (modalDraft.editingGroupId) payload.id = modalDraft.editingGroupId;

    let saved;
    try {
      const res = await fetch("/irc/irc4/group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      saved = await res.json();
    } catch (e) {
      closeModal();
      return; // Nothing persisted, nothing to render.
    }

    const group = {
      id: saved.id,
      schools: saved.schools || [],
      schedule: saved.schedule || "",
    };

    if (modalDraft.editingGroupId) {
      const idx = data.groups.findIndex(
        (g) => String(g.id) === String(group.id),
      );
      if (idx !== -1) data.groups[idx] = group;
      else data.groups.push(group);
    } else {
      data.groups.push(group);
    }

    renderGroupView(group);
    updateGroupsEmptyState();
    closeModal();
  }

  // ============================================================
  // Add/Edit single-field modal — shared by Activity, TA Receiver, and
  // MOV's. Each has a header action button that reads "Add" when the
  // field is empty and "Edit" once it holds a value; either way it opens
  // this same modal, pre-filled with whatever's already there.
  // ============================================================

  const FIELD_MODAL_CONFIG = {
    activity: {
      title: "Activity",
      label: "Specify the activity and project title",
      apiKey: "activityFieldApi",
      btnKey: "activityActionBtn",
      saveField: "activity",
    },
    taReceiver: {
      title: "TA Receiver",
      label: "Identify the individuals who will be provided with TA",
      apiKey: "taReceiverFieldApi",
      btnKey: "taReceiverActionBtn",
      saveField: "taReceiver",
    },
    movs: {
      title: "MOV\u2019s",
      label: "List down the evidences",
      apiKey: "movsFieldApi",
      btnKey: "movsActionBtn",
      saveField: "movs",
    },
  };

  // Which field the modal is currently open for, so Apply/Delete know
  // where to write back to. Null while the modal is closed.
  let fieldModalKey = null;

  // Keeps a header action button's label in sync with whether its field
  // currently holds a value ("Add" when blank, "Edit" once filled).
  function updateFieldActionLabel(key) {
    const config = FIELD_MODAL_CONFIG[key];
    const btn = els[config.btnKey];
    if (!btn) return;
    const label = btn.querySelector('[data-role="action-label"]');
    const api = els[config.apiKey];
    const hasValue = !!(api && api.getValue().trim());
    if (label) label.textContent = hasValue ? "Edit" : "Add";
  }

  function openFieldModal(key) {
    const config = FIELD_MODAL_CONFIG[key];
    if (!config) return;
    fieldModalKey = key;

    const api = els[config.apiKey];
    const currentValue = api ? api.getValue() : "";

    els.fieldModalTitle.textContent = config.title;
    els.fieldModalLabel.textContent = config.label;
    els.fieldModalInput.value = currentValue;
    // Nothing to delete yet if the field is already empty.
    els.fieldModalDelete.hidden = !currentValue.trim();

    els.fieldModal.style.display = "flex";
    els.fieldModalInput.focus();
  }

  function closeFieldModal() {
    els.fieldModal.style.display = "none";
    fieldModalKey = null;
  }

  function applyFieldModal() {
    if (!fieldModalKey) return;
    const config = FIELD_MODAL_CONFIG[fieldModalKey];
    const val = els.fieldModalInput.value;

    data[config.saveField] = val;
    if (els[config.apiKey]) els[config.apiKey].setValue(val);
    savePlanField(config.saveField, val);
    updateFieldActionLabel(fieldModalKey);
    closeFieldModal();
  }

  function deleteFieldModal() {
    if (!fieldModalKey) return;
    const config = FIELD_MODAL_CONFIG[fieldModalKey];

    data[config.saveField] = "";
    if (els[config.apiKey]) els[config.apiKey].setValue("");
    savePlanField(config.saveField, "");
    updateFieldActionLabel(fieldModalKey);
    closeFieldModal();
  }

  // ============================================================
  // Reset — wipes the entire plan (Activity, Objectives, Groups, TA
  // Receiver, MOV's) back to a blank slate, after the person confirms in
  // irc4ResetModal. Built entirely out of the same per-field/per-item
  // endpoints the rest of the page already uses (savePlanField, the
  // objective/group DELETE routes, addObjective) rather than a new
  // dedicated "wipe everything" server route.
  // ============================================================

  // --- Save to PDF ---
  // Uses the browser's native print-to-PDF instead of a screenshot
  // library: the print stylesheet (see the "Print / Save-to-PDF" section
  // in irc4.css) hides the logo bar, navbar, and this page's own header
  // action buttons, sizes the page to 8.5x13in "long" paper, and
  // un-clips anything that only scrolls on screen. document.title is
  // swapped briefly since most browsers suggest it as the default
  // "Save as PDF" filename. Same approach as irc1a.js's saveToPdf().
  function saveToPdf() {
    const previousTitle = document.title;
    document.title = `IRC4 TA Catch-up Plan ${new Date().getFullYear()}`;

    const restoreTitle = () => {
      document.title = previousTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };
    window.addEventListener("afterprint", restoreTitle);

    window.print();
  }

  function openResetModal() {
    els.resetModal.style.display = "flex";
  }

  function closeResetModal() {
    els.resetModal.style.display = "none";
  }

  async function resetPlan() {
    els.resetModalConfirm.disabled = true;

    // Blank the three free-text fields, both on screen and server-side.
    data.activity = "";
    data.taReceiver = "";
    data.movs = "";
    if (els.activityFieldApi) els.activityFieldApi.setValue("");
    if (els.taReceiverFieldApi) els.taReceiverFieldApi.setValue("");
    if (els.movsFieldApi) els.movsFieldApi.setValue("");
    updateFieldActionLabel("activity");
    updateFieldActionLabel("taReceiver");
    updateFieldActionLabel("movs");
    savePlanField("activity", "");
    savePlanField("taReceiver", "");
    savePlanField("movs", "");

    // Delete every existing group and objective server-side in parallel,
    // same best-effort fetch pattern used by removeGroup/removeObjective.
    const deletes = [
      ...data.groups.map((g) =>
        fetch(`/irc/irc4/group/${encodeURIComponent(g.id)}`, {
          method: "DELETE",
        }).catch(() => {}),
      ),
      ...data.objectives.map((o) =>
        fetch(`/irc/irc4/objective/${encodeURIComponent(o.id)}`, {
          method: "DELETE",
        }).catch(() => {}),
      ),
    ];
    await Promise.all(deletes);

    data.groups = [];
    data.objectives = [];
    els.groupsList.innerHTML = "";
    updateGroupsEmptyState();
    els.objectivesList.innerHTML = "";
    updateObjectivesWarning();
    updateObjectivesActionLabel();

    // Deleting every objective may itself cause the server to re-seed its
    // own baseline (the server guarantees at least three blank objectives
    // exist for a plan — see loadPlan()'s comment above). Re-fetch just
    // the objectives (not the whole plan via loadPlan(), which would risk
    // clobbering the activity/taReceiver/movs fields above with stale
    // values if their save requests haven't landed yet) and only top up
    // locally if the server came back with fewer than MIN_OBJECTIVES —
    // this avoids ending up with double the baseline (server's 3 + ours)
    // or none at all.
    try {
      const res = await fetch("/irc/irc4/data");
      const payload = await res.json();
      data.objectives = payload.objectives || [];
    } catch (e) {
      data.objectives = [];
    }
    renderObjectivesFromData();
    while (data.objectives.length < MIN_OBJECTIVES) {
      await addObjective();
    }

    els.resetModalConfirm.disabled = false;
    closeResetModal();
  }

  // ============================================================
  // Init
  // ============================================================

  async function init() {
    cacheEls();
    if (!els.root) return; // not on this page

    // Schools first (objectives/groups render against SCHOOLS metadata),
    // then the saved plan itself.
    await loadSchools();
    await loadPlan();

    // Field APIs are kept around (not just fired-and-forgotten) so
    // resetPlan() and the field modal can update them from the outside.
    els.activityFieldApi = initDisplayField(els.activityField, data.activity);
    els.taReceiverFieldApi = initDisplayField(
      els.taReceiverField,
      data.taReceiver,
    );
    els.movsFieldApi = initDisplayField(els.movsField, data.movs);

    // Header buttons read "Add" or "Edit" depending on whether the plan
    // already has a saved value for that field.
    updateFieldActionLabel("activity");
    updateFieldActionLabel("taReceiver");
    updateFieldActionLabel("movs");

    els.activityActionBtn.addEventListener("click", () =>
      openFieldModal("activity"),
    );
    els.taReceiverActionBtn.addEventListener("click", () =>
      openFieldModal("taReceiver"),
    );
    els.movsActionBtn.addEventListener("click", () => openFieldModal("movs"));

    els.fieldModalClose.addEventListener("click", closeFieldModal);
    els.fieldModalCancel.addEventListener("click", closeFieldModal);
    els.fieldModalOverlay.addEventListener("click", closeFieldModal);
    els.fieldModalSave.addEventListener("click", applyFieldModal);
    els.fieldModalDelete.addEventListener("click", deleteFieldModal);

    els.objectivesActionBtn.addEventListener("click", openObjectivesModal);
    els.objectivesModalClose.addEventListener("click", closeObjectivesModal);
    els.objectivesModalCancel.addEventListener("click", closeObjectivesModal);
    els.objectivesModalOverlay.addEventListener("click", closeObjectivesModal);
    els.objectivesModalAddRow.addEventListener("click", addObjectiveDraftRow);
    els.objectivesModalSave.addEventListener("click", saveObjectivesModal);

    els.objectiveDeleteCancel.addEventListener(
      "click",
      closeObjectiveDeleteConfirm,
    );
    els.objectiveDeleteConfirmBtn.addEventListener(
      "click",
      confirmRemoveObjectiveDraftRow,
    );
    // Same click-outside-the-box pattern as irc4ResetModal: the overlay
    // itself is the outer element, so only close if the click landed on
    // the backdrop, not the confirmation box or its buttons.
    els.objectiveDeleteConfirm.addEventListener("click", (e) => {
      if (e.target === els.objectiveDeleteConfirm) {
        closeObjectiveDeleteConfirm();
      }
    });

    els.addGroupBtn.addEventListener("click", openAddGroupModal);
    els.groupsList.addEventListener("click", onGroupsClick);

    els.modalClose.addEventListener("click", closeModal);
    els.modalCancel.addEventListener("click", closeModal);
    els.modalOverlay.addEventListener("click", closeModal);
    els.modalSave.addEventListener("click", saveModal);
    els.modalSchoolChips.addEventListener("click", onModalChipsClick);
    els.modalSchoolSearch.addEventListener("input", onModalSchoolSearchInput);
    els.modalSchoolSearch.addEventListener(
      "keydown",
      onModalSchoolSearchKeydown,
    );
    els.modalSchoolSearch.addEventListener("focus", onModalSchoolSearchOpen);
    // 'click' is needed too: if the field is already focused, clicking it
    // again fires no 'focus' event, so without this the dropdown would
    // stay closed until the person started typing.
    els.modalSchoolSearch.addEventListener("click", onModalSchoolSearchOpen);
    // No blur listener here on purpose — see the document-level
    // "mousedown" click-outside handler set up near trackDropdown() above.

    els.modalScheduleInput.addEventListener("input", onModalScheduleInput);
    els.modalScheduleInput.addEventListener("keydown", onModalScheduleKeydown);
    els.modalScheduleInput.addEventListener("focus", onModalScheduleOpen);
    els.modalScheduleInput.addEventListener("click", onModalScheduleOpen);

    if (els.pdfBtn) els.pdfBtn.addEventListener("click", saveToPdf);

    els.resetBtn.addEventListener("click", openResetModal);
    els.resetModalCancel.addEventListener("click", closeResetModal);
    // The overlay IS the outer confirm element here (single box, no
    // separate overlay layer) — same click-outside pattern as IRC5's
    // confirm dialog: only close if the click landed on the backdrop
    // itself, not on the box or its children.
    els.resetModal.addEventListener("click", (e) => {
      if (e.target === els.resetModal) closeResetModal();
    });
    els.resetModalConfirm.addEventListener("click", resetPlan);

    els.groupDeleteCancel.addEventListener("click", closeGroupDeleteConfirm);
    els.groupDeleteConfirmBtn.addEventListener("click", confirmDeleteGroup);
    // Same click-outside-the-box pattern as irc4ResetModal.
    els.groupDeleteConfirm.addEventListener("click", (e) => {
      if (e.target === els.groupDeleteConfirm) closeGroupDeleteConfirm();
    });

    // Objectives/groups were already loaded by loadPlan() above (the
    // server guarantees at least three blank objectives exist) — render
    // what came back instead of seeding it client-side.
    renderObjectivesFromData();
    data.groups.forEach(renderGroupView);
    updateGroupsEmptyState();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
