(function () {
  const table = document.getElementById("irc7-table");
  if (!table) return;

  const wrapper = table.closest(".irc7-table-wrapper") || table.parentElement;
  const colgroup = document.getElementById("irc7-colgroup");
  const groupRow = document.getElementById("irc7-group-row");
  const colRow = document.getElementById("irc7-col-row");
  const tbody = document.getElementById("irc7-tbody");
  const totalsRow = document.getElementById("irc7-totals-row");

  // Sticky header lives in its own table, separate from #irc7-table --
  // see the "Sticky header (separate table)" comment in irc7.css for why.
  const stickyHeader = document.getElementById("irc7StickyHeader");
  const stickyHeaderClip = document.getElementById("irc7StickyHeaderClip");
  const headerTable = document.getElementById("irc7-header-table");
  const headerColgroup = document.getElementById("irc7-header-colgroup");
  // Dual horizontal scrollbar elements (sticky top duplicate + the real one).
  const tableScroll = document.getElementById("irc7TableScroll") || wrapper;
  const topScrollbar = document.getElementById("irc7TopScrollbar");
  const topScrollbarInner = document.getElementById("irc7TopScrollbarInner");
  const bottomSentinel = document.getElementById("irc7BottomSentinel");

  const addColumnBtn = document.getElementById("addColumnBtn");
  const addColumnBtnLabel = document.getElementById("addColumnBtnLabel");
  const addColumnBtnIcon = document.getElementById("addColumnBtnIcon");
  const modal = document.getElementById("addColumnModal");
  const modalTitle = document.getElementById("irc7ModalTitle");
  const modalClose = document.getElementById("irc7ModalClose");
  const modalCancel = document.getElementById("irc7ModalCancel");
  const modalOverlay = document.getElementById("irc7ModalOverlay");
  const modalSubmit = document.getElementById("irc7ModalSubmit");
  const manageList = document.getElementById("irc7-columns-manage-list");
  const addStandaloneBtn = document.getElementById("irc7AddStandaloneBtn");
  const addGroupBtn = document.getElementById("irc7AddGroupBtn");

  const deleteConfirmOverlay = document.getElementById(
    "irc7-delete-confirm-overlay",
  );
  const deleteConfirmTitle = document.getElementById(
    "irc7-delete-confirm-title",
  );
  const deleteConfirmMessage = document.getElementById(
    "irc7-delete-confirm-message",
  );
  const deleteConfirmCancelBtn = document.getElementById(
    "irc7-delete-confirm-cancel",
  );
  const deleteConfirmConfirmBtn = document.getElementById(
    "irc7-delete-confirm-confirm",
  );

  const pdfBtn = document.getElementById("irc7-pdf-btn");

  const resetBtn = document.getElementById("irc7-reset-btn");
  const resetConfirmOverlay = document.getElementById(
    "irc7-reset-confirm-overlay",
  );
  const resetConfirmCancelBtn = document.getElementById(
    "irc7-reset-confirm-cancel",
  );
  const resetConfirmConfirmBtn = document.getElementById(
    "irc7-reset-confirm-confirm",
  );
  const resetScopeRadios = document.querySelectorAll(
    'input[name="irc7-reset-scope"]',
  );
  const resetConfirmWarning = document.getElementById(
    "irc7-reset-confirm-warning",
  );

  // Minimum pixel width for each column type. Every added column (grouped
  // or standalone) gets a <col data-min-width="..."> using one of these.
  const ADDED_COLUMN_MIN_WIDTH = {
    text: 140,
    number: 100,
    paragraph: 220,
    checkbox: 80,
  };

  // ---------- Data model for added groups/columns ----------
  //
  // Columns/values are persisted server-side (see /irc/irc7/data,
  // /irc/irc7/columns, /irc/irc7/column/<id>, /irc/irc7/group/<name>, and
  // /irc/irc7/cell). `columns` here is a client-side cache using the
  // server's real integer ids.
  //
  // A "group" has no separate identity in the schema -- it's just the
  // group_name shared by however many IRC7Column rows have it (see
  // models.py). But the UI still needs to know exactly which *rendered
  // header block* a click came from (two separate "Add Columns" batches
  // could reuse the same group name and would then render as two
  // side-by-side header blocks) -- `columnBlocks` gives each rendered
  // block its own client-only token for that purpose, while `groupName`
  // is what's actually sent to the backend. Renaming/deleting "a group"
  // therefore affects every block sharing that name, matching what
  // actually happens server-side -- see renameGroup/removeGroup below.
  const columnBlocks = new Map(); // blockToken -> { groupName, columnIds: Set<number> }
  const colIdToBlock = new Map(); // colId -> blockToken
  let blockCounter = 0;
  let columns = []; // ordered array of { id, name, type, groupName|null }
  let rowsData = []; // fixed reference rows (schools/offerings) from the server
  let cellValues = {}; // "rowId:colId" -> value, for the current year

  const YEAR = new Date().getFullYear();

  // ================= FLUID-UNTIL-MINIMUM COLUMN LAYOUT =================
  // Every <col> in #irc7-colgroup carries a data-min-width (px). Whenever
  // columns change (or the wrapper is resized), recalcLayout() decides:
  //  - if the sum of all minimums fits inside the wrapper: stretch the
  //    table to 100% and give each column a percentage share of that
  //    width proportional to its minimum (fluid — fills the table).
  //  - otherwise: pin the table width to the sum of minimums (px) and
  //    give each column exactly its minimum (px) — columns stop
  //    shrinking, and the wrapper's overflow-x: auto makes it scroll.
  function recalcLayout() {
    const cols = Array.from(colgroup.children);
    if (cols.length > 0) {
      const minWidths = cols.map((c) => parseFloat(c.dataset.minWidth) || 100);
      const totalMin = minWidths.reduce((sum, w) => sum + w, 0);
      const available = tableScroll.clientWidth;

      if (totalMin <= available) {
        table.style.width = "100%";
        cols.forEach((c, i) => {
          c.style.width = (minWidths[i] / totalMin) * 100 + "%";
        });
      } else {
        table.style.width = totalMin + "px";
        cols.forEach((c, i) => {
          c.style.width = minWidths[i] + "px";
        });
      }
    }

    // The sticky header lives in its own <table> (see irc7.css), so its
    // width and <col> widths need to be mirrored here on every layout
    // pass -- otherwise its columns would drift out of alignment with
    // the real (scrolling) table's as columns are added/removed/resized.
    if (headerTable && headerColgroup) {
      headerTable.style.width = table.style.width;
      headerColgroup.innerHTML = colgroup.innerHTML;
    }

    // Column widths above (and header height, if wrapping changed)
    // affect both the sticky offsets and the duplicate top scrollbar,
    // so keep them in lockstep with every layout pass rather than
    // hunting down every call site that changes the table's shape.
    updateStickyOffsets();
    updateFrozenOffsets();
    syncTopScrollbarWidth();
  }

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(recalcLayout, 100);
  });

  // ================= STICKY HEADER + DUAL HORIZONTAL SCROLLBAR =================
  //
  // #irc7StickyHeader (the header, in its own table -- see the "Sticky
  // header (separate table)" comment in irc7.css) and #irc7TopScrollbar
  // are both sticky via CSS alone (position: sticky; top: 0 / top:
  // var(--irc7-thead-height)). #irc7-table-card uses `overflow: clip`
  // rather than `hidden` specifically so it doesn't become an accidental
  // scroll container that would trap that stickiness instead of letting
  // it resolve against .content (the page's real scroll container) --
  // see the comment on that rule in irc7.css. What needs JS:
  //  1. Measuring the sticky header's actual height (it changes as
  //     columns wrap or are added/removed) so the duplicate top
  //     scrollbar sticks immediately below it.
  //  2. Keeping the duplicate top scrollbar's inner width matched to the
  //     real table width, and keeping all three of #irc7TableScroll (the
  //     real, native scrollbar), #irc7TopScrollbar (the duplicate), and
  //     #irc7StickyHeaderClip (the sticky header's horizontal clip --
  //     not natively scrollable, just has its scrollLeft driven by JS)
  //     in sync with whichever one the user just scrolled.
  //  3. Showing only one of the two *visible* scrollbars at a time: the
  //     top one hides itself whenever the real one (at the scroll
  //     container's true bottom edge, marked by #irc7BottomSentinel) is
  //     already visible on-screen.

  function updateStickyOffsets() {
    if (!stickyHeader) return;
    document.documentElement.style.setProperty(
      "--irc7-thead-height",
      stickyHeader.offsetHeight + "px",
    );
  }

  // ================= FROZEN REFERENCE COLUMNS =================
  //
  // The six reference columns (School ID -> School Classification) are
  // pinned to the left edge with position: sticky while the added
  // indicator columns scroll past them. CSS does the pinning; the only
  // thing it can't know is each frozen column's `left` offset, because
  // recalcLayout() sizes every column dynamically. So the cumulative
  // widths are measured here and published as CSS variables on the
  // wrapper, which the .irc7-frozen-col[data-frozen-index] rules read.
  //
  // Widths are taken from the sticky header table's own frozen cells:
  // its colgroup is mirrored 1:1 from the body table's (see
  // recalcLayout), so both tables' frozen columns are identical widths,
  // and the header row is always present even before any data rows have
  // been rendered.
  const FROZEN_COLUMN_COUNT = 6;

  function updateFrozenOffsets() {
    const frozenHeaderCells = groupRow.querySelectorAll("th.irc7-frozen-col");
    if (frozenHeaderCells.length === 0) return;

    let offset = 0;
    frozenHeaderCells.forEach((th, i) => {
      // Index 0 is pinned at left: 0 by a static rule; publishing the
      // rest keeps the variable names aligned with data-frozen-index.
      if (i > 0) {
        wrapper.style.setProperty(`--irc7-frozen-left-${i}`, offset + "px");
      }
      offset += th.getBoundingClientRect().width;
    });

    // Total width of the frozen block, in case anything else needs it.
    wrapper.style.setProperty("--irc7-frozen-width", offset + "px");
  }

  // The boundary shadow is only meaningful once the table has actually
  // been scrolled sideways -- see .irc7-is-hscrolled in irc7.css.
  function updateHScrollState(left) {
    wrapper.classList.toggle("irc7-is-hscrolled", left > 0);
  }

  function syncTopScrollbarWidth() {
    if (!topScrollbarInner || !topScrollbar || !tableScroll) return;
    topScrollbarInner.style.width = table.scrollWidth + "px";
    const hasOverflow = table.scrollWidth > tableScroll.clientWidth + 1;
    topScrollbar.classList.toggle("irc7-top-scrollbar--noscroll", !hasOverflow);
  }

  if (topScrollbar && tableScroll) {
    let syncingScroll = false;

    // Applies `left` to whichever of the three horizontal-scroll
    // surfaces didn't just trigger this (the `source` element already
    // has that scrollLeft -- re-setting it is harmless, but skipping it
    // avoids a redundant native "scroll" event on some browsers).
    function syncScrollLeft(left, source) {
      syncingScroll = true;
      if (source !== tableScroll) tableScroll.scrollLeft = left;
      if (source !== topScrollbar) topScrollbar.scrollLeft = left;
      if (stickyHeaderClip) stickyHeaderClip.scrollLeft = left;
      syncingScroll = false;
      updateHScrollState(left);
    }

    topScrollbar.addEventListener("scroll", () => {
      if (syncingScroll) return;
      syncScrollLeft(topScrollbar.scrollLeft, topScrollbar);
    });

    tableScroll.addEventListener("scroll", () => {
      if (syncingScroll) return;
      syncScrollLeft(tableScroll.scrollLeft, tableScroll);
    });
  }

  // Only one horizontal scrollbar visible at a time: hide the sticky
  // top scrollbar the instant the real one (at the bottom edge of
  // #irc7TableScroll) scrolls into view, and show it again once that
  // edge scrolls back out of view.
  if (bottomSentinel && topScrollbar && "IntersectionObserver" in window) {
    const bottomScrollbarObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          topScrollbar.classList.toggle(
            "irc7-top-scrollbar--hidden",
            entry.isIntersecting,
          );
        });
      },
      { threshold: 0 },
    );
    bottomScrollbarObserver.observe(bottomSentinel);
  }

  // Header height changes whenever columns wrap differently or are
  // added/removed -- ResizeObserver catches all of that without needing
  // every call site to remember to re-measure.
  if (stickyHeader && "ResizeObserver" in window) {
    const theadObserver = new ResizeObserver(() => updateStickyOffsets());
    theadObserver.observe(stickyHeader);
  } else {
    updateStickyOffsets();
  }

  // ================= LOADING FIXED ROWS + SAVED COLUMNS/VALUES =================

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : str;
    return div.innerHTML;
  }

  // The six leading columns (School ID, Name, Curricular Offering, DLC,
  // Status, Classification) used to be hardcoded directly into
  // irc7.html's <tbody>. They now come from IRC7Row (seeded once via
  // storage.seed_irc7_rows()), so the tbody starts empty and this
  // builds those rows from the fetched data instead.
  //
  // irc7-frozen-col + data-frozen-index mirror the matching header cells
  // in irc7.html, pinning these six to the left edge on horizontal
  // scroll -- see "Frozen reference columns" in irc7.css.
  function renderFixedRows(rows) {
    tbody.innerHTML = "";
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.dataset.rowId = row.id;
      tr.innerHTML = `
        <td class="irc7-frozen-col" data-frozen-index="0">${escapeHtml(row.schoolIdCode)}</td>
        <td class="irc7-frozen-col" data-frozen-index="1">${escapeHtml(row.schoolName)}</td>
        <td class="irc7-frozen-col" data-frozen-index="2">${escapeHtml(row.curricularOffering)}</td>
        <td class="irc7-frozen-col" data-frozen-index="3">${escapeHtml(row.dlc)}</td>
        <td class="irc7-frozen-col" data-frozen-index="4">${escapeHtml(row.dedpStatus)}</td>
        <td class="irc7-frozen-col irc7-frozen-col--last" data-frozen-index="5">${escapeHtml(row.classification)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function loadData() {
    try {
      const res = await fetch(`/irc/irc7/data?year=${YEAR}`);
      if (!res.ok) throw new Error("Failed to load data");
      const data = await res.json();

      rowsData = data.rows || [];
      cellValues = data.values || {};
      renderFixedRows(rowsData);

      const sortedColumns = (data.columns || [])
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder);
      renderColumnsBatch(sortedColumns);
    } catch (err) {
      console.error("Failed to load IRC7 data:", err);
      recalcLayout();
      updateAddColumnButtonUI();
    }
  }

  // ================= ADD / EDIT COLUMNS MODAL =================
  //
  // One button + one modal handles the whole column lifecycle now:
  //  - No columns yet: the toolbar button reads "Add Column" and the modal
  //    opens empty, ready for new standalone columns / groups.
  //  - Columns already exist: the button reads "Edit Columns" and the same
  //    modal opens pre-populated with every existing standalone column and
  //    group, each renamable in place and removable (with confirmation).
  // See updateAddColumnButtonUI()/populateManageModal() below.

  const TRASH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`;
  const PLUS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"></path></svg>`;
  const PENCIL_ICON_PATH = `<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>`;
  const PLUS_ICON_PATH = `<path d="M12 5v14M5 12h14"></path>`;

  // Swaps the toolbar button between "Add Column" (nothing added yet) and
  // "Edit Columns" (at least one column/group exists), and keeps the
  // modal's own title in sync so it reads correctly however it was opened.
  function updateAddColumnButtonUI() {
    const has = columns.length > 0;
    addColumnBtnLabel.textContent = has ? "Edit Columns" : "Add Column";
    addColumnBtnIcon.innerHTML = has ? PENCIL_ICON_PATH : PLUS_ICON_PATH;
    modalTitle.textContent = has ? "Edit Columns" : "Add Columns";
  }

  // ---------- Delete confirmation (custom modal, not window.confirm) ----------
  //
  // Promise-based so callers can just `await confirmDelete(...)`. Sits on
  // top of the Add/Edit Columns modal (see irc7-delete-confirm-overlay's
  // z-index in irc7.css) so it reads as a confirmation step rather than
  // replacing the modal underneath it.
  function confirmDelete(title, message) {
    return new Promise((resolve) => {
      deleteConfirmTitle.textContent = title;
      deleteConfirmMessage.textContent = message;
      deleteConfirmOverlay.classList.add("visible");

      function cleanup(result) {
        deleteConfirmOverlay.classList.remove("visible");
        deleteConfirmConfirmBtn.removeEventListener("click", onConfirm);
        deleteConfirmCancelBtn.removeEventListener("click", onCancel);
        deleteConfirmOverlay.removeEventListener("click", onOverlay);
        resolve(result);
      }
      function onConfirm() {
        cleanup(true);
      }
      function onCancel() {
        cleanup(false);
      }
      function onOverlay(e) {
        if (e.target === deleteConfirmOverlay) cleanup(false);
      }

      deleteConfirmConfirmBtn.addEventListener("click", onConfirm);
      deleteConfirmCancelBtn.addEventListener("click", onCancel);
      deleteConfirmOverlay.addEventListener("click", onOverlay);
    });
  }

  // ---------- Row/block builders ----------
  //
  // Both are used for existing (already-saved) and brand-new (unsaved)
  // entries alike: `col`/`groupName` are filled in for the former and
  // omitted for the latter. Existing rows/blocks carry data-col-id /
  // data-block-token so the Save handler knows to PUT a rename instead of
  // POSTing a new column, and so their remove buttons know to call the
  // server (with a confirmation) instead of just deleting a draft.
  //
  // Values are assigned via DOM properties rather than interpolated into
  // an innerHTML string, since names are free text and may contain quotes
  // or markup that would otherwise break out of an attribute.

  function buildColumnRow(col) {
    const row = document.createElement("div");
    row.className = "irc7-column-row";
    if (col) row.dataset.colId = col.id;

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "irc7-column-name-input";
    nameInput.placeholder = "Column name";
    if (col) nameInput.value = col.name;

    const typeSelect = document.createElement("select");
    typeSelect.className = "irc7-column-type-select";
    typeSelect.innerHTML = `
      <option value="text">Text</option>
      <option value="number">Number</option>
      <option value="paragraph">Paragraph</option>
      <option value="checkbox">Checkbox</option>
    `;
    typeSelect.value = col ? col.type : "text";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "irc7-remove-column-btn";
    removeBtn.title = "Remove column";
    removeBtn.innerHTML = TRASH_SVG;
    removeBtn.addEventListener("click", () => handleRemoveColumnRow(row));

    row.append(nameInput, typeSelect, removeBtn);
    return row;
  }

  function buildGroupBlock(blockToken, groupName) {
    const block = document.createElement("div");
    block.className = "irc7-group-block";
    if (blockToken) block.dataset.blockToken = blockToken;

    const header = document.createElement("div");
    header.className = "irc7-group-block-header";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "irc7-group-name-input";
    nameInput.placeholder = "Group name";
    if (groupName) nameInput.value = groupName;

    const removeGroupBtn = document.createElement("button");
    removeGroupBtn.type = "button";
    removeGroupBtn.className = "irc7-remove-group-btn";
    removeGroupBtn.title = "Remove group";
    removeGroupBtn.innerHTML = TRASH_SVG;
    removeGroupBtn.addEventListener("click", () =>
      handleRemoveGroupBlock(block),
    );

    header.append(nameInput, removeGroupBtn);

    const columnsList = document.createElement("div");
    columnsList.className = "irc7-columns-list";

    const addColBtn = document.createElement("button");
    addColBtn.type = "button";
    addColBtn.className = "irc7-add-column-btn";
    addColBtn.innerHTML = `${PLUS_SVG} Add Column within Group`;
    addColBtn.addEventListener("click", () => {
      columnsList.appendChild(buildColumnRow(null));
    });

    block.append(header, columnsList, addColBtn);
    return block;
  }

  // ---------- Remove handlers (fire immediately, not deferred to Save) ----------
  //
  // A brand-new, unsaved row/block just gets torn out of the modal's DOM.
  // An existing one is a real delete: confirm, hit the server (reusing
  // removeColumn/removeGroup so the live table updates too), then drop it
  // from the modal.

  async function handleRemoveColumnRow(row) {
    const colId = row.dataset.colId ? Number(row.dataset.colId) : null;
    if (colId == null) {
      row.remove();
      return;
    }

    const col = columns.find((c) => c.id === colId);
    const name = col ? col.name : "this column";
    const ok = await confirmDelete(
      "Remove Column",
      `Remove the column "${name}"? This cannot be undone.`,
    );
    if (!ok) return;

    const groupBlock = row.closest(".irc7-group-block");
    await removeColumn(colId);
    row.remove();

    // If that was the last existing column in its group, the group is
    // gone server-side too -- drop the now-empty block from the modal.
    if (
      groupBlock &&
      groupBlock.dataset.blockToken &&
      !columnBlocks.has(groupBlock.dataset.blockToken)
    ) {
      groupBlock.remove();
    }
  }

  async function handleRemoveGroupBlock(block) {
    const blockToken = block.dataset.blockToken;
    if (!blockToken) {
      block.remove();
      return;
    }

    const b = columnBlocks.get(blockToken);
    const groupName = b ? b.groupName : "this group";
    const ok = await confirmDelete(
      "Remove Group",
      `Remove the group "${groupName}" and all its columns? This cannot be undone.`,
    );
    if (!ok) return;

    await removeGroup(blockToken);

    // Deleting a group removes every rendered block sharing its name
    // server-side, not just the one clicked -- clean up any others here.
    manageList
      .querySelectorAll(".irc7-group-block[data-block-token]")
      .forEach((el) => {
        if (!columnBlocks.has(el.dataset.blockToken)) el.remove();
      });
  }

  // ---------- Populate / open / close ----------

  // Rebuilds the modal's contents from the current `columns`, in the same
  // order they're stored (== chronological / sort_order) -- standalone
  // rows and group blocks are appended into one shared list as they're
  // encountered, rather than split into separate sections, so the modal
  // reads top-to-bottom in the order things were actually added. Grouped
  // entries are batched into the same block using the table's own
  // colIdToBlock/columnBlocks mapping, so a block clicked for
  // rename/delete here is exactly the block it represents on-screen.
  function populateManageModal() {
    manageList.innerHTML = "";

    const blockEls = new Map(); // blockToken -> columnsList element

    columns.forEach((col) => {
      if (!col.groupName) {
        manageList.appendChild(buildColumnRow(col));
        return;
      }

      const blockToken = colIdToBlock.get(col.id);
      let columnsList = blockEls.get(blockToken);
      if (!columnsList) {
        const block = buildGroupBlock(blockToken, col.groupName);
        manageList.appendChild(block);
        columnsList = block.querySelector(".irc7-columns-list");
        blockEls.set(blockToken, columnsList);
      }
      columnsList.appendChild(buildColumnRow(col));
    });
  }

  function showAddModal() {
    populateManageModal();
    updateAddColumnButtonUI();
    modal.style.display = "flex";
  }

  function hideAddModal() {
    modal.style.display = "none";
  }

  addColumnBtn.addEventListener("click", showAddModal);
  modalClose.addEventListener("click", hideAddModal);
  modalCancel.addEventListener("click", hideAddModal);
  modalOverlay.addEventListener("click", hideAddModal);
  document
    .querySelector("#addColumnModal .irc7-modal-content")
    .addEventListener("click", (e) => e.stopPropagation());

  // New items always join the end of the single chronological list.
  addStandaloneBtn.addEventListener("click", () => {
    manageList.appendChild(buildColumnRow(null));
  });

  addGroupBtn.addEventListener("click", () => {
    const block = buildGroupBlock(null, null);
    block.querySelector(".irc7-columns-list").appendChild(buildColumnRow(null));
    manageList.appendChild(block);
  });

  // ---------- Save: renames existing items, then creates new ones ----------

  async function renameGroup(blockToken, newName) {
    const b = columnBlocks.get(blockToken);
    if (!b) return;
    const oldName = b.groupName;

    const res = await fetch(`/irc/irc7/group/${encodeURIComponent(oldName)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    if (!res.ok) throw new Error("Rename failed");

    // The backend renames every column sharing oldName, across every
    // rendered block -- mirror that here, not just the block clicked.
    columnBlocks.forEach((blk, token) => {
      if (blk.groupName === oldName) {
        blk.groupName = newName;
        const th = groupRow.querySelector(`th[data-group-id="${token}"]`);
        if (th) th.textContent = newName;
      }
    });
    columns.forEach((c) => {
      if (c.groupName === oldName) c.groupName = newName;
    });
  }

  async function saveColumnEdit(col, newName, newType) {
    const typeChanged = col.type !== newType;
    // The server wipes a column's stored values when it switches to or
    // from "checkbox" (see edit_irc7_column), so mirror that locally.
    const crossesCheckbox =
      typeChanged && (col.type === "checkbox" || newType === "checkbox");

    const res = await fetch(`/irc/irc7/column/${col.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, type: newType }),
    });
    if (!res.ok) throw new Error("Save failed");

    col.name = newName;
    col.type = newType;

    // Standalone headers live in groupRow (rowSpan 2), grouped ones in
    // colRow -- check both rather than assuming which.
    const th =
      colRow.querySelector(`th[data-col-id="${col.id}"]`) ||
      groupRow.querySelector(`th[data-col-id="${col.id}"]`);
    if (th) th.textContent = newName;

    if (crossesCheckbox) {
      Object.keys(cellValues).forEach((key) => {
        if (key.endsWith(`:${col.id}`)) delete cellValues[key];
      });
    }

    if (typeChanged) {
      const colEl = colgroup.querySelector(`col[data-col-id="${col.id}"]`);
      if (colEl) {
        colEl.dataset.minWidth =
          ADDED_COLUMN_MIN_WIDTH[newType] || ADDED_COLUMN_MIN_WIDTH.text;
      }

      tbody.querySelectorAll(`td[data-col-id="${col.id}"]`).forEach((td) => {
        const tr = td.closest("tr");
        const rowId = Number(tr.dataset.rowId);
        const oldInput = td.querySelector("input");
        const oldVal =
          !crossesCheckbox && oldInput ? getCellInputValue(oldInput) : "";
        const keepValue =
          newType !== "number" ||
          oldVal === "" ||
          !Number.isNaN(parseFloat(oldVal));
        td.innerHTML = "";
        const input = buildCellInput(
          newType,
          rowId,
          col.id,
          keepValue ? oldVal : "",
        );
        td.appendChild(input);
      });

      const totalsCell = totalsRow.querySelector(`td[data-col-id="${col.id}"]`);
      if (totalsCell) {
        totalsCell.textContent = computeTotalText(col.id, newType);
      }

      recalcLayout();
    }
  }

  modalSubmit.addEventListener("click", async () => {
    const groupBlocks = Array.from(
      manageList.querySelectorAll(".irc7-group-block"),
    );
    const allRows = Array.from(manageList.querySelectorAll(".irc7-column-row"));

    // Validate before touching the server: every group needs a name, and
    // an existing column can't be renamed down to nothing.
    for (const block of groupBlocks) {
      if (!block.querySelector(".irc7-group-name-input").value.trim()) {
        alert(
          "Every group needs a name. Remove the group instead if you don't want it.",
        );
        return;
      }
    }
    for (const row of allRows) {
      if (
        row.dataset.colId &&
        !row.querySelector(".irc7-column-name-input").value.trim()
      ) {
        alert("Existing columns can't be left with an empty name.");
        return;
      }
    }

    modalSubmit.disabled = true;
    try {
      // 1. Rename existing groups whose name input changed.
      for (const block of groupBlocks) {
        const blockToken = block.dataset.blockToken;
        if (!blockToken) continue;
        const b = columnBlocks.get(blockToken);
        if (!b) continue;
        const newName = block
          .querySelector(".irc7-group-name-input")
          .value.trim();
        if (newName !== b.groupName) await renameGroup(blockToken, newName);
      }

      // 2. Rename/retype existing columns whose fields changed.
      for (const row of allRows) {
        if (!row.dataset.colId) continue;
        const col = columns.find((c) => c.id === Number(row.dataset.colId));
        if (!col) continue;
        const newName = row
          .querySelector(".irc7-column-name-input")
          .value.trim();
        const newType = row.querySelector(".irc7-column-type-select").value;
        if (newName !== col.name || newType !== col.type) {
          await saveColumnEdit(col, newName, newType);
        }
      }

      // 3. Collect brand-new columns (standalone + inside any group,
      // existing or new) and create them all in one batch, walking
      // manageList's direct children in DOM order so standalone rows and
      // group blocks are interleaved exactly as they were added -- not
      // "all standalone first, then all groups". populateManageModal()
      // and the add-standalone/add-group handlers above both append to
      // this same list in chronological order, so DOM order here *is*
      // the order the user added things in.
      const newColumns = [];

      Array.from(manageList.children).forEach((el) => {
        if (el.classList.contains("irc7-column-row")) {
          // Standalone row, direct child of the shared list.
          if (el.dataset.colId) return;
          const name = el.querySelector(".irc7-column-name-input").value.trim();
          const type = el.querySelector(".irc7-column-type-select").value;
          if (name) newColumns.push({ name, type, groupName: null });
          return;
        }

        if (el.classList.contains("irc7-group-block")) {
          const groupName = el
            .querySelector(".irc7-group-name-input")
            .value.trim();
          el.querySelectorAll(".irc7-column-row").forEach((row) => {
            if (row.dataset.colId) return;
            const name = row
              .querySelector(".irc7-column-name-input")
              .value.trim();
            const type = row.querySelector(".irc7-column-type-select").value;
            if (name) newColumns.push({ name, type, groupName });
          });
        }
      });

      if (newColumns.length > 0) {
        const res = await fetch("/irc/irc7/columns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ columns: newColumns }),
        });
        if (!res.ok) throw new Error("Save failed");
        const data = await res.json();

        if (data.allColumns) {
          // Adding to an existing group renumbers sort_order server-side,
          // so new columns can land anywhere rather than just the end --
          // re-render from the full authoritative ordering.
          rerenderAllColumns(data.allColumns);
        } else {
          renderColumnsBatch(data.columns);
        }
      }

      hideAddModal();
    } catch (err) {
      console.error("Failed to save IRC7 columns:", err);
      alert("Could not save these changes. Please try again.");
    } finally {
      modalSubmit.disabled = false;
    }
  });

  // Tears every added column out of the DOM and rebuilds them from the
  // given ordering. Typed values survive because they're already saved
  // server-side and mirrored in `cellValues`, which appendCellToRows
  // reads when it builds each input.
  function rerenderAllColumns(allColumns) {
    removeAllAddedColumnsInPlace(false); // keep cellValues — nothing was deleted
    const sorted = allColumns.slice().sort((a, b) => a.sortOrder - b.sortOrder);
    renderColumnsBatch(sorted);
  }

  // ================= BUILDING COLUMNS INTO THE TABLE =================
  //
  // Used both for the initial load (the full saved column list, in
  // sort_order) and for a freshly-added batch (just the columns the
  // server handed back from POST /irc/irc7/columns) -- either way, the
  // list is already in the order it should render in.
  function renderColumnsBatch(newColumns) {
    let i = 0;
    while (i < newColumns.length) {
      const col = newColumns[i];

      if (col.groupName) {
        let j = i;
        const batch = [];
        while (
          j < newColumns.length &&
          newColumns[j].groupName === col.groupName
        ) {
          batch.push(newColumns[j]);
          j++;
        }

        const blockToken = "blk" + ++blockCounter;
        columnBlocks.set(blockToken, {
          groupName: col.groupName,
          columnIds: new Set(batch.map((c) => c.id)),
        });
        batch.forEach((c) => colIdToBlock.set(c.id, blockToken));

        const groupTh = buildGroupHeaderCell(
          blockToken,
          col.groupName,
          batch.length,
        );
        groupRow.appendChild(groupTh);

        batch.forEach((c) => {
          columns.push({
            id: c.id,
            name: c.name,
            type: c.type,
            groupName: c.groupName,
          });

          const th = buildColumnHeaderCell(c.id, c.name);
          colRow.appendChild(th);
          colgroup.appendChild(buildColElement(c.id, c.type));
          appendCellToRows(c.id, c.type);
        });

        i = j;
      } else {
        columns.push({
          id: col.id,
          name: col.name,
          type: col.type,
          groupName: null,
        });

        const th = buildColumnHeaderCell(col.id, col.name);
        th.rowSpan = 2;
        groupRow.appendChild(th);
        colgroup.appendChild(buildColElement(col.id, col.type));
        appendCellToRows(col.id, col.type);
        i++;
      }
    }

    recalcLayout();
    updateAddColumnButtonUI();
  }

  // <col> element carrying this column's minimum width.
  function buildColElement(colId, type) {
    const colEl = document.createElement("col");
    colEl.dataset.colId = colId;
    colEl.dataset.minWidth =
      ADDED_COLUMN_MIN_WIDTH[type] || ADDED_COLUMN_MIN_WIDTH.text;
    return colEl;
  }

  // Header cell for a top-row group (spans the columns beneath it).
  function buildGroupHeaderCell(groupId, name, colSpan) {
    const th = document.createElement("th");
    th.className = "irc7-group-header irc7-added-header";
    th.colSpan = colSpan;
    th.dataset.groupId = groupId;
    th.textContent = name;
    return th;
  }

  // Header cell for an individual column (grouped or standalone).
  function buildColumnHeaderCell(colId, name) {
    const th = document.createElement("th");
    th.className = "irc7-sub-header irc7-added-header irc7-fixed-col";
    th.dataset.colId = colId;
    th.textContent = name;
    return th;
  }

  function appendCellToRows(colId, type) {
    tbody.querySelectorAll("tr").forEach((tr) => {
      const rowId = Number(tr.dataset.rowId);
      const td = document.createElement("td");
      td.className = "irc7-editable-cell";
      td.dataset.colId = colId;

      const existingValue = cellValues[`${rowId}:${colId}`];
      const input = buildCellInput(type, rowId, colId, existingValue);
      td.appendChild(input);
      tr.appendChild(td);
    });

    // One totals cell per added column, built after this column's data
    // cells above so its initial sum (for "number" columns) reflects any
    // values already loaded from the server.
    totalsRow.appendChild(buildTotalsCell(colId, type));
  }

  // A checkbox cell's "value" is its checked state, stored as "1" /
  // "" (the same empty-string-clears convention every other type uses).
  function getCellInputValue(input) {
    if (input.type === "checkbox") return input.checked ? "1" : "";
    return input.value;
  }

  function buildCellInput(type, rowId, colId, initialValue) {
    const input = document.createElement("input");
    input.type =
      type === "number" ? "number" : type === "checkbox" ? "checkbox" : "text";
    input.className = "irc7-cell-input irc7-cell-input--" + type;
    if (type === "number") input.step = "any";
    if (type === "paragraph") input.placeholder = "Enter text...";
    if (type === "checkbox") {
      input.checked = initialValue === "1" || initialValue === "true";
    } else if (initialValue !== undefined && initialValue !== null) {
      input.value = initialValue;
    }

    input.addEventListener("change", () => {
      saveCellValue(rowId, colId, getCellInputValue(input));
      updateColumnTotal(colId);
    });

    return input;
  }

  async function saveCellValue(rowId, colId, value) {
    try {
      const res = await fetch("/irc/irc7/cell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowId, columnId: colId, year: YEAR, value }),
      });
      if (!res.ok) throw new Error("Save failed");
      cellValues[`${rowId}:${colId}`] = value === "" ? null : value;
    } catch (err) {
      console.error("Failed to save IRC7 cell:", err);
    }
  }

  // ================= TOTALS ROW (number columns only) =================
  //
  // Sums are computed straight from each column's <input> values already
  // in the DOM, not from `cellValues` -- that keeps the running total in
  // sync with whatever's currently typed the instant a "change" event
  // fires, without waiting on saveCellValue's fetch to resolve.

  function formatSum(n) {
    // Round to 2 decimals to shake off floating-point noise (e.g.
    // 0.1 + 0.2), then drop a trailing ".00"/".50"-style zero tail.
    const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
    return String(rounded);
  }

  function computeColumnSum(colId) {
    let sum = 0;
    tbody
      .querySelectorAll(`td[data-col-id="${colId}"] input`)
      .forEach((input) => {
        const v = parseFloat(input.value);
        if (!isNaN(v)) sum += v;
      });
    return sum;
  }

  // Number of ticked checkboxes in a checkbox column.
  function computeColumnCheckedCount(colId) {
    return tbody.querySelectorAll(
      `td[data-col-id="${colId}"] input[type="checkbox"]:checked`,
    ).length;
  }

  // Text shown in a column's totals cell: a running sum for "number"
  // columns, a count of ticked boxes for "checkbox" columns, blank otherwise.
  function computeTotalText(colId, type) {
    if (type === "number") return formatSum(computeColumnSum(colId));
    if (type === "checkbox") return String(computeColumnCheckedCount(colId));
    return "";
  }

  function buildTotalsCell(colId, type) {
    const td = document.createElement("td");
    td.className = "irc7-totals-cell";
    td.dataset.colId = colId;
    td.textContent = computeTotalText(colId, type);
    return td;
  }

  function updateColumnTotal(colId) {
    const col = columns.find((c) => c.id === colId);
    if (!col || (col.type !== "number" && col.type !== "checkbox")) return;
    const cell = totalsRow.querySelector(`td[data-col-id="${colId}"]`);
    if (!cell) return;
    cell.textContent = computeTotalText(colId, col.type);
  }

  // Clicking anywhere in a checkbox column's cell (not just on the tiny
  // box itself) toggles that row's checkbox. Delegated on tbody so it also
  // covers rows/columns added later and cells rebuilt by a type change.
  tbody.addEventListener("click", (e) => {
    const td = e.target.closest("td.irc7-editable-cell");
    if (!td || !tbody.contains(td)) return;
    const input = td.querySelector('input[type="checkbox"]');
    // Clicks on the box itself already toggle natively.
    if (!input || e.target === input) return;
    input.checked = !input.checked;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  // ================= REMOVE COLUMN / GROUP =================
  //
  // Shared by the manage-columns modal (see handleRemoveColumnRow /
  // handleRemoveGroupBlock above, which confirm() before calling these)
  // and by rerenderAllColumns's teardown path. Both hit the server first
  // and only patch the live table once the delete is confirmed to have
  // succeeded.

  async function removeColumn(colId) {
    const col = columns.find((c) => c.id === colId);
    if (!col) return;

    try {
      const res = await fetch(`/irc/irc7/column/${colId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
    } catch (err) {
      console.error("Failed to delete IRC7 column:", err);
      alert("Could not delete this column. Please try again.");
      return;
    }

    const th =
      colRow.querySelector(`th[data-col-id="${colId}"]`) ||
      groupRow.querySelector(`th[data-col-id="${colId}"]`);
    if (th) th.remove();

    const colEl = colgroup.querySelector(`col[data-col-id="${colId}"]`);
    if (colEl) colEl.remove();

    tbody
      .querySelectorAll(`td[data-col-id="${colId}"]`)
      .forEach((td) => td.remove());

    const totalsCell = totalsRow.querySelector(`td[data-col-id="${colId}"]`);
    if (totalsCell) totalsCell.remove();

    const blockToken = colIdToBlock.get(colId);
    if (blockToken) {
      const block = columnBlocks.get(blockToken);
      block.columnIds.delete(colId);
      colIdToBlock.delete(colId);

      const groupTh = groupRow.querySelector(
        `th[data-group-id="${blockToken}"]`,
      );
      if (block.columnIds.size === 0) {
        if (groupTh) groupTh.remove();
        columnBlocks.delete(blockToken);
      } else if (groupTh) {
        groupTh.colSpan = block.columnIds.size;
      }
    }

    columns = columns.filter((c) => c.id !== colId);
    recalcLayout();
    updateAddColumnButtonUI();
  }

  async function removeGroup(blockToken) {
    const block = columnBlocks.get(blockToken);
    if (!block) return;
    const groupName = block.groupName;

    try {
      const res = await fetch(
        `/irc/irc7/group/${encodeURIComponent(groupName)}`,
        {
          method: "DELETE",
        },
      );
      if (!res.ok) throw new Error("Delete failed");
    } catch (err) {
      console.error("Failed to delete IRC7 group:", err);
      alert("Could not delete this group. Please try again.");
      return;
    }

    // The backend deletes every column sharing this group name, across
    // every rendered block -- remove all of them here too, not just the
    // block that was clicked.
    const blocksToRemove = [];
    columnBlocks.forEach((b, token) => {
      if (b.groupName === groupName) blocksToRemove.push(token);
    });

    blocksToRemove.forEach((token) => {
      const b = columnBlocks.get(token);
      const groupTh = groupRow.querySelector(`th[data-group-id="${token}"]`);
      if (groupTh) groupTh.remove();

      b.columnIds.forEach((colId) => {
        const th = colRow.querySelector(`th[data-col-id="${colId}"]`);
        if (th) th.remove();
        const colEl = colgroup.querySelector(`col[data-col-id="${colId}"]`);
        if (colEl) colEl.remove();
        tbody
          .querySelectorAll(`td[data-col-id="${colId}"]`)
          .forEach((td) => td.remove());
        const totalsCell = totalsRow.querySelector(
          `td[data-col-id="${colId}"]`,
        );
        if (totalsCell) totalsCell.remove();
        colIdToBlock.delete(colId);
      });

      columnBlocks.delete(token);
    });

    columns = columns.filter((c) => c.groupName !== groupName);
    recalcLayout();
    updateAddColumnButtonUI();
  }

  // ================= SAVE TO PDF =================
  // Same approach as IRC1a: the browser's native print-to-PDF, driven by
  // the print stylesheet (see the "Print / Save-to-PDF" section in
  // irc7.css) rather than a screenshot library. That stylesheet hides the
  // logo bar/navbar and this page's header/toolbar buttons, un-sticks and
  // un-clips the table's sticky header/top-scrollbar/frozen columns (all
  // screen-only conveniences that don't mean anything on paper), sizes
  // the page to 13x8.5in "long" bond paper in landscape, and scales
  // fonts/padding down to fit. document.title is swapped briefly since
  // most browsers suggest it as the default "Save as PDF" filename.
  function saveToPdf() {
    const previousTitle = document.title;
    document.title = `IRC7 SGOD Dashboard Data ${new Date().getFullYear()}`;

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

  // ---------- Print-time column widths ----------
  // recalcLayout() (above) sizes every column for the ON-SCREEN
  // #irc7TableScroll's clientWidth: if the combined minimums fit, it's
  // fluid (%); otherwise it pins every column to its raw px minimum and
  // lets the wrapper scroll horizontally. A printed page never scrolls
  // and has its own fixed, known width that has nothing to do with the
  // browser window -- browsers' print/Save-as-PDF pipeline doesn't
  // reliably re-run that on-screen measurement against the print page,
  // so whatever mode the screen happened to be in (especially the
  // "doesn't fit, scroll instead" px mode, which only gets more likely
  // the more columns are added) leaks straight into the PDF instead of
  // fitting the page. That's what was producing misaligned/oversized
  // columns once several columns were added.
  //
  // Fix: right before printing, force every column back into fluid mode
  // regardless of what the screen decided -- same proportional-to-
  // minimum formula recalcLayout() already uses, just applied
  // unconditionally -- and mirror it onto the header table's colgroup
  // the same way recalcLayout() always does, so the two tables stay
  // aligned. The on-screen widths are restored afterward so nothing
  // about the live page changes.
  let preprintColumnState = null;

  function applyPrintColumnWidths() {
    const cols = Array.from(colgroup.children);
    if (cols.length === 0) return;

    preprintColumnState = {
      tableWidth: table.style.width,
      headerTableWidth: headerTable ? headerTable.style.width : "",
      colWidths: cols.map((c) => c.style.width),
    };

    const minWidths = cols.map((c) => parseFloat(c.dataset.minWidth) || 100);
    const totalMin = minWidths.reduce((sum, w) => sum + w, 0) || 1;

    table.style.width = "100%";
    cols.forEach((c, i) => {
      c.style.width = (minWidths[i] / totalMin) * 100 + "%";
    });

    if (headerTable && headerColgroup) {
      headerTable.style.width = "100%";
      headerColgroup.innerHTML = colgroup.innerHTML;
    }
  }

  function restorePrintColumnWidths() {
    if (!preprintColumnState) return;

    const cols = Array.from(colgroup.children);
    cols.forEach((c, i) => {
      c.style.width = preprintColumnState.colWidths[i] || "";
    });
    table.style.width = preprintColumnState.tableWidth;
    if (headerTable)
      headerTable.style.width = preprintColumnState.headerTableWidth;
    if (headerColgroup) headerColgroup.innerHTML = colgroup.innerHTML;

    preprintColumnState = null;
    recalcLayout();
  }

  // "beforeprint"/"afterprint" fire for window.print() the same as for
  // the browser's own Ctrl+P, so this covers both the button above and
  // a manual print.
  window.addEventListener("beforeprint", applyPrintColumnWidths);
  window.addEventListener("afterprint", restorePrintColumnWidths);

  // ================= RESET: VALUES ONLY, OR ENTIRE TABLE =================
  //
  // Two scopes, chosen via the modal's radio buttons and sent as
  // ?scope=values|all to the shared /irc/irc7/reset endpoint:
  //
  //  - "values" (default): only IRC7CellValue rows are wiped server-side.
  //    IRC7's added-column *values* live in their own table separate
  //    from the columns/groups themselves (IRC7Column), so columns,
  //    groups, and their titles are never touched -- only what's typed
  //    into each cell disappears.
  //  - "all": every IRC7Column is deleted outright, which cascades to
  //    its cell values too (see reset_irc7_data() in app.py) -- the
  //    table goes back to just its 6 fixed reference columns.
  const RESET_WARNINGS = {
    values:
      "This will clear all entered values in every column, but keeps the columns and their titles. This cannot be undone.",
    all: "This will remove every added column and group, along with everything typed into them. This cannot be undone.",
  };

  function getSelectedResetScope() {
    const checked = document.querySelector(
      'input[name="irc7-reset-scope"]:checked',
    );
    return checked ? checked.value : "values";
  }

  function updateResetWarning() {
    const scope = getSelectedResetScope();
    resetConfirmWarning.textContent =
      RESET_WARNINGS[scope] || RESET_WARNINGS.values;
    resetConfirmWarning.classList.toggle(
      "irc7-reset-warning--danger",
      scope === "all",
    );
  }

  resetScopeRadios.forEach((radio) => {
    radio.addEventListener("change", updateResetWarning);
  });

  function openResetConfirm() {
    // Always reopen on the safer "values only" option rather than
    // remembering whatever was picked last time.
    const valuesRadio = document.getElementById("irc7-reset-scope-values");
    if (valuesRadio) valuesRadio.checked = true;
    updateResetWarning();
    resetConfirmOverlay.classList.add("visible");
  }

  function closeResetConfirm() {
    resetConfirmOverlay.classList.remove("visible");
  }

  function clearAllCellValuesInPlace() {
    // Clear every cell input in place -- columns/headers already in the
    // DOM are left completely alone.
    cellValues = {};
    tbody.querySelectorAll(".irc7-cell-input").forEach((input) => {
      if (input.type === "checkbox") input.checked = false;
      else input.value = "";
    });

    // Every number column's sum drops to 0 now that its inputs are
    // empty -- recompute in place rather than assuming "0" everywhere,
    // in case a future change makes the sum ignore truly-empty cells.
    columns.forEach((col) => {
      if (col.type === "number" || col.type === "checkbox")
        updateColumnTotal(col.id);
    });
  }

  // `clearValues` is true for the "reset entire table" path (the values
  // really are gone server-side) and false when re-rendering after an
  // add, where every saved value must survive into the rebuilt inputs.
  function removeAllAddedColumnsInPlace(clearValues = true) {
    // Group-spanning headers and standalone column headers both carry
    // "irc7-added-header" and both live in groupRow; grouped sub-headers
    // (colRow) are always 100% added, so it's cleared outright.
    groupRow
      .querySelectorAll(".irc7-added-header")
      .forEach((th) => th.remove());
    colRow.innerHTML = "";

    // Remove every added <col>, leaving the 6 fixed ones (they carry no
    // data-col-id) untouched.
    colgroup
      .querySelectorAll("col[data-col-id]")
      .forEach((col) => col.remove());

    // Remove every added data cell from each row, leaving the 6 fixed tds.
    tbody.querySelectorAll("td[data-col-id]").forEach((td) => td.remove());

    // Remove every totals cell, leaving only the "Total" label cell.
    totalsRow.querySelectorAll("td[data-col-id]").forEach((td) => td.remove());

    columns = [];
    columnBlocks.clear();
    colIdToBlock.clear();
    if (clearValues) cellValues = {};
    updateAddColumnButtonUI();
  }

  resetBtn.addEventListener("click", openResetConfirm);
  resetConfirmCancelBtn.addEventListener("click", closeResetConfirm);
  resetConfirmOverlay.addEventListener("click", (e) => {
    if (e.target === resetConfirmOverlay) closeResetConfirm();
  });

  resetConfirmConfirmBtn.addEventListener("click", async () => {
    const scope = getSelectedResetScope();
    resetConfirmConfirmBtn.disabled = true;
    try {
      const res = await fetch(`/irc/irc7/reset?scope=${scope}&year=${YEAR}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Reset failed");

      if (scope === "all") {
        removeAllAddedColumnsInPlace();
        recalcLayout();
      } else {
        clearAllCellValuesInPlace();
      }
    } catch (err) {
      console.error("Failed to reset IRC7 data:", err);
      alert("Could not reset the data. Please try again.");
    } finally {
      resetConfirmConfirmBtn.disabled = false;
      closeResetConfirm();
    }
  });

  // ---------- Initial load ----------
  loadData();

  // Fonts finishing their load can shift header text wrapping (and
  // therefore header height) after the initial measurement above.
  window.addEventListener("load", () => {
    updateStickyOffsets();
    syncTopScrollbarWidth();
  });
})();
