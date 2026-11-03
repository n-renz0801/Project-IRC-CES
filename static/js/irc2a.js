/* IRC2a - Number of Schools Provided with TA - JS */

(function () {
  "use strict";

  // Constant master list — do not add/remove here at runtime.
  // level: "elementary" | "secondary"
  // (Integrated schools now count as "secondary"; the SPED Center now
  // counts as "elementary" — there is no separate integrated/sped group.)
  const SCHOOLS = [
    { name: "Antipolo City Senior High School", level: "secondary" },
    { name: "Antipolo City SPED Center", level: "elementary" },
    { name: "Antipolo National Science and Technology HS", level: "secondary" },
    { name: "Antipolo NHS", level: "secondary" },
    { name: "Apia Integrated School", level: "secondary" },
    { name: "Bagong Nayon I ES", level: "elementary" },
    { name: "Bagong Nayon II ES", level: "elementary" },
    { name: "Bagong Nayon II NHS", level: "secondary" },
    { name: "Bagong Nayon IV ES", level: "elementary" },
    { name: "Binayoyo Integrated School", level: "secondary" },
    { name: "Cabading ES", level: "elementary" },
    { name: "Calawis ES", level: "elementary" },
    { name: "Calawis NHS", level: "secondary" },
    { name: "Canumay ES", level: "elementary" },
    { name: "Canumay NHS", level: "secondary" },
    { name: "Cupang ES", level: "elementary" },
    { name: "Cupang ES Annex", level: "elementary" },
    { name: "Cupang NHS", level: "secondary" },
    { name: "Dalig ES", level: "elementary" },
    { name: "Dalig NHS", level: "secondary" },
    { name: "Dela Paz ES", level: "elementary" },
    { name: "Dela Paz NHS", level: "secondary" },
    { name: "Inuman ES", level: "elementary" },
    { name: "Isaias S. Tapales ES", level: "elementary" },
    { name: "Jesus S. Cabarrus ES", level: "elementary" },
    { name: "Juan Sumulong ES", level: "elementary" },
    { name: "Kaila ES", level: "elementary" },
    { name: "Kaysakat ES", level: "elementary" },
    { name: "Kaysakat NHS", level: "secondary" },
    { name: "Knights of Columbus ES", level: "elementary" },
    { name: "Libis ES", level: "elementary" },
    { name: "Lores ES", level: "elementary" },
    { name: "Mambugan I ES", level: "elementary" },
    { name: "Mambugan II ES", level: "elementary" },
    { name: "Mambugan NHS", level: "secondary" },
    { name: "Marcelino M. Santos NHS", level: "secondary" },
    { name: "Maximo L. Gatlabayan MNHS", level: "secondary" },
    { name: "Mayamot ES", level: "elementary" },
    { name: "Mayamot NHS", level: "secondary" },
    { name: "Muntindilaw ES", level: "elementary" },
    { name: "Muntindilaw NHS", level: "secondary" },
    { name: "Nazarene Ville ES", level: "elementary" },
    { name: "Old Boso-Boso ES", level: "elementary" },
    { name: "Old Boso-Boso NHS", level: "secondary" },
    { name: "Paglitaw ES", level: "elementary" },
    { name: "Pantay ES", level: "elementary" },
    { name: "Peace Village ES", level: "elementary" },
    { name: "Peñafrancia ES", level: "elementary" },
    { name: "Peñafrancia ES Annex", level: "elementary" },
    { name: "Rizza ES", level: "elementary" },
    { name: "Rizza NHS", level: "secondary" },
    { name: "San Antonio Village ES", level: "elementary" },
    { name: "San Isidro ES", level: "elementary" },
    { name: "San Isidro NHS", level: "secondary" },
    { name: "San Jose NHS", level: "secondary" },
    { name: "San Joseph ES", level: "elementary" },
    { name: "San Juan NHS", level: "secondary" },
    { name: "San Luis ES", level: "elementary" },
    { name: "San Roque NHS", level: "secondary" },
    { name: "San Ysiro ES", level: "elementary" },
    { name: "Sapinit ES", level: "elementary" },
    { name: "Sta. Cruz ES", level: "elementary" },
    { name: "Sumilang ES", level: "elementary" },
    { name: "Taguete ES", level: "elementary" },
    { name: "Tanza ES", level: "elementary" },
    { name: "Teofila Z. Rovero MES", level: "elementary" },
    { name: "Upper Kilingan ES", level: "elementary" },
  ];

  // Schools tagged as DEDP Priority.
  const DEDP_PRIORITY = new Set([
    "Antipolo NHS",
    "Bagong Nayon I ES",
    "Bagong Nayon II ES",
    "Bagong Nayon II NHS",
    "Bagong Nayon IV ES",
    "Cupang ES",
    "Dalig NHS",
    "Dela Paz ES",
    "Jesus S. Cabarrus ES",
    "Juan Sumulong ES",
    "Kaysakat ES",
    "Lores ES",
    "Mambugan I ES",
    "Mambugan II ES",
    "Mambugan NHS",
    "Maximo L. Gatlabayan MNHS",
    "Mayamot ES",
    "Muntindilaw ES",
    "Peace Village ES",
    "Peñafrancia ES",
    "Rizza ES",
    "San Antonio Village ES",
    "San Isidro ES",
    "San Isidro NHS",
    "San Jose NHS",
    "Tanza ES",
  ]);

  const LEVEL_LABELS = {
    elementary: "ES",
    secondary: "Secondary",
  };

  /** @type {Record<string, "provided"|"unprovided">} */
  let state = {};

  /** @type {{ level: string, dedpOnly: boolean }} */
  let filters = { level: "all", dedpOnly: false };

  const els = {};

  function cacheEls() {
    els.root = document.getElementById("irc2a-tab");
    els.lists = {
      unprovided: document.getElementById("unprovided-list"),
      provided: document.getElementById("provided-list"),
    };
    els.empties = {
      unprovided: document.getElementById("unprovided-empty"),
      provided: document.getElementById("provided-empty"),
    };
    els.counts = {
      unprovided: document.getElementById("unprovided-count"),
      provided: document.getElementById("provided-count"),
    };
    els.searches = {
      unprovided: document.getElementById("unprovided-search"),
      provided: document.getElementById("provided-search"),
    };
    els.levelFilterGroup = document.getElementById("irc2a-level-filters");
    els.dedpToggle = document.getElementById("dedp-filter-toggle");
    els.pdfBtn = document.getElementById("irc2a-pdf-btn");
    els.resetAllBtn = document.getElementById("irc2aResetAllBtn");
    els.resetConfirmOverlay = document.getElementById(
      "irc2a-reset-confirm-overlay",
    );
    els.resetConfirmCancelBtn = document.getElementById(
      "irc2a-reset-confirm-cancel",
    );
    els.resetConfirmConfirmBtn = document.getElementById(
      "irc2a-reset-confirm-confirm",
    );

    els.stats = {
      dedpElementary: document.getElementById("stat-dedp-elementary"),
      dedpSecondary: document.getElementById("stat-dedp-secondary"),
      dedpTotal: document.getElementById("stat-dedp-total"),
      dedpPct: document.getElementById("stat-dedp-pct"),
      nonDedpElementary: document.getElementById("stat-nondedp-elementary"),
      nonDedpSecondary: document.getElementById("stat-nondedp-secondary"),
      nonDedpTotal: document.getElementById("stat-nondedp-total"),
      nonDedpPct: document.getElementById("stat-nondedp-pct"),
      overallPct: document.getElementById("stat-overall-pct"),
      overallFraction: document.getElementById("stat-overall-fraction"),
      overallElementary: document.getElementById("stat-overall-elementary"),
      overallSecondary: document.getElementById("stat-overall-secondary"),
    };
    els.bars = {
      dedpElementary: document.getElementById("dedp-bar-elementary"),
      dedpSecondary: document.getElementById("dedp-bar-secondary"),
      nonDedpElementary: document.getElementById("nondedp-bar-elementary"),
      nonDedpSecondary: document.getElementById("nondedp-bar-secondary"),
    };
  }

  function initState() {
    // Baseline: everyone starts as "unprovided" until loadPersistedState()
    // (called from init(), below) overlays whatever's actually saved in
    // the database for this year.
    state = {};
    SCHOOLS.forEach((s) => {
      state[s.name] = "unprovided";
    });
  }

  // Loads previously-saved statuses from the database and re-renders once
  // they're in, so a page reload shows the board as it was left instead of
  // resetting every school back to "Not Yet Provided" (see /irc/irc2a/data
  // in app.py).
  function loadPersistedState() {
    fetch("/irc/irc2a/data")
      .then((res) => res.json())
      .then((data) => {
        const statuses = data.statuses || {};
        Object.keys(statuses).forEach((name) => {
          if (Object.prototype.hasOwnProperty.call(state, name)) {
            state[name] = statuses[name];
          }
        });
        render(currentFilters());
      })
      .catch(() => {
        /* Board just stays at the "everyone unprovided" baseline. */
      });
  }

  function matchesFilters(school) {
    if (filters.level !== "all" && school.level !== filters.level) {
      return false;
    }
    if (filters.dedpOnly && !DEDP_PRIORITY.has(school.name)) {
      return false;
    }
    return true;
  }

  function makeItem(school, status) {
    const { name, level } = school;
    const isDedp = DEDP_PRIORITY.has(name);

    const li = document.createElement("li");
    li.className = "irc2a-item";
    li.dataset.school = name;
    li.dataset.level = level;
    li.tabIndex = 0;
    li.setAttribute("role", "button");

    const levelLabel = LEVEL_LABELS[level] || level;
    const ariaExtra = isDedp ? ", DEDP Priority" : "";
    li.setAttribute(
      "aria-label",
      status === "unprovided"
        ? `${name}, ${levelLabel}${ariaExtra}. Not yet provided with TA. Activate to mark as provided.`
        : `${name}, ${levelLabel}${ariaExtra}. Provided with TA. Activate to move back to not yet provided.`,
    );

    const nameSpan = document.createElement("span");
    nameSpan.className = "irc2a-item-name";
    nameSpan.textContent = name;
    li.appendChild(nameSpan);

    if (isDedp) {
      const dedpBadge = document.createElement("span");
      dedpBadge.className = "irc2a-badge irc2a-badge--dedp";
      dedpBadge.textContent = "DEDP";
      li.appendChild(dedpBadge);
    }

    const actionSpan = document.createElement("span");
    actionSpan.className = "irc2a-item-action";
    li.appendChild(actionSpan);

    return li;
  }

  function currentFilters() {
    return {
      unprovided: els.searches.unprovided.value,
      provided: els.searches.provided.value,
    };
  }

  function render(searchText) {
    searchText = searchText || { unprovided: "", provided: "" };

    // Bucket by status first (unaffected by level/DEDP filters — those only
    // hide/show items within a bucket, they don't move schools between them).
    const buckets = { unprovided: [], provided: [] };
    SCHOOLS.forEach((s) => buckets[state[s.name]].push(s));

    ["unprovided", "provided"].forEach((status) => {
      const list = els.lists[status];
      const query = (searchText[status] || "").trim().toLowerCase();

      const all = buckets[status]
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name));

      const visible = all.filter(
        (s) =>
          matchesFilters(s) && (!query || s.name.toLowerCase().includes(query)),
      );

      list.innerHTML = "";
      const frag = document.createDocumentFragment();
      visible.forEach((s) => frag.appendChild(makeItem(s, status)));
      list.appendChild(frag);

      els.empties[status].hidden = visible.length !== 0;
      // Count badge reflects total in this column regardless of filters,
      // so users always know the true tally.
      els.counts[status].textContent = String(buckets[status].length);
    });

    updateStats(buckets.provided);
  }

  function pct(numerator, denominator) {
    if (denominator === 0) return 0;
    return Math.round((numerator / denominator) * 1000) / 10; // one decimal
  }

  function updateStats(providedSchools) {
    const dedpProvided = providedSchools.filter((s) =>
      DEDP_PRIORITY.has(s.name),
    );
    const nonDedpProvided = providedSchools.filter(
      (s) => !DEDP_PRIORITY.has(s.name),
    );

    const dedpElementaryCount = dedpProvided.filter(
      (s) => s.level === "elementary",
    ).length;
    const dedpSecondaryCount = dedpProvided.filter(
      (s) => s.level === "secondary",
    ).length;
    const nonDedpElementaryCount = nonDedpProvided.filter(
      (s) => s.level === "elementary",
    ).length;
    const nonDedpSecondaryCount = nonDedpProvided.filter(
      (s) => s.level === "secondary",
    ).length;

    const dedpTotalSchools = DEDP_PRIORITY.size;
    const nonDedpTotalSchools = SCHOOLS.length - DEDP_PRIORITY.size;

    const dedpPct = pct(dedpProvided.length, dedpTotalSchools);
    const nonDedpPct = pct(nonDedpProvided.length, nonDedpTotalSchools);

    els.stats.dedpElementary.textContent = String(dedpElementaryCount);
    els.stats.dedpSecondary.textContent = String(dedpSecondaryCount);
    els.stats.dedpTotal.textContent = `${dedpProvided.length} / ${dedpTotalSchools}`;
    els.stats.dedpPct.textContent = `${dedpPct}%`;
    els.stats.nonDedpElementary.textContent = String(nonDedpElementaryCount);
    els.stats.nonDedpSecondary.textContent = String(nonDedpSecondaryCount);
    els.stats.nonDedpTotal.textContent = `${nonDedpProvided.length} / ${nonDedpTotalSchools}`;
    els.stats.nonDedpPct.textContent = `${nonDedpPct}%`;

    setBarSegments(
      els.bars.dedpElementary,
      els.bars.dedpSecondary,
      dedpElementaryCount,
      dedpSecondaryCount,
      dedpTotalSchools,
    );
    setBarSegments(
      els.bars.nonDedpElementary,
      els.bars.nonDedpSecondary,
      nonDedpElementaryCount,
      nonDedpSecondaryCount,
      nonDedpTotalSchools,
    );

    // Overall coverage badge (right block of the dashboard) — combines
    // both DEDP and non-DEDP groups.
    const overallTotalSchools = SCHOOLS.length;
    const elementaryTotal = SCHOOLS.filter(
      (s) => s.level === "elementary",
    ).length;
    const secondaryTotal = SCHOOLS.filter(
      (s) => s.level === "secondary",
    ).length;
    const elementaryProvidedCount =
      dedpElementaryCount + nonDedpElementaryCount;
    const secondaryProvidedCount = dedpSecondaryCount + nonDedpSecondaryCount;
    const overallProvidedCount = providedSchools.length;
    const overallPct = pct(overallProvidedCount, overallTotalSchools);

    if (els.stats.overallPct) {
      els.stats.overallPct.textContent = `${overallPct}%`;
    }
    if (els.stats.overallFraction) {
      els.stats.overallFraction.textContent = `${overallProvidedCount} / ${overallTotalSchools}`;
    }
    if (els.stats.overallElementary) {
      els.stats.overallElementary.textContent = `${elementaryProvidedCount} / ${elementaryTotal}`;
    }
    if (els.stats.overallSecondary) {
      els.stats.overallSecondary.textContent = `${secondaryProvidedCount} / ${secondaryTotal}`;
    }
  }

  // Each segmented capacity bar's two fills are sized as plain CSS
  // percentages of that group's total school count (not just of the
  // schools provided so far), so the combined width of both segments is
  // always exactly that group's % provided -- with the elementary vs.
  // secondary split visible within it. Being pure CSS percentages (rather
  // than pixel heights measured off a rendered track, as the old vertical
  // chart needed) means these never need recalculating on window resize.
  function setBarSegments(
    elementaryEl,
    secondaryEl,
    elementaryCount,
    secondaryCount,
    totalSchools,
  ) {
    if (!elementaryEl || !secondaryEl) return;
    elementaryEl.style.width = pct(elementaryCount, totalSchools) + "%";
    secondaryEl.style.width = pct(secondaryCount, totalSchools) + "%";
  }

  function toggleSchool(name) {
    state[name] = state[name] === "unprovided" ? "provided" : "unprovided";
    render(currentFilters());
    saveManualStatus(name, state[name]);
  }

  // No "Confirm" button for a manual drag/click toggle (unlike the PDF
  // import flow), so each move saves itself right away.
  function saveManualStatus(name, status) {
    fetch("/irc/irc2a/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ school_name: name, status: status }),
    }).catch(() => {
      /* Best-effort: a failed save shouldn't block the UI toggle the user
         already saw happen. A page reload will just show the last
         successfully-saved status. */
    });
  }

  // Kept short and eased (no overshoot) so the move reads as a quick,
  // subtle shrink-out / grow-back-in rather than a bounce.
  const LEAVE_ANIMATION_MS = 120;
  const ENTER_ANIMATION_MS = 150; // must match the @keyframes duration in CSS

  function animateAndToggle(itemEl, name) {
    // Guard against double-triggering while already mid-animation.
    if (itemEl.classList.contains("is-leaving")) return;
    itemEl.classList.add("is-leaving");

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;

      toggleSchool(name);

      // Play a subtle entrance ("grow back outward") animation for the item
      // that just landed in its new column — works the same whichever
      // direction it moved (unprovided → provided, or provided → unprovided).
      const newItem = els.root.querySelector(
        `.irc2a-item[data-school="${CSS.escape(name)}"]`,
      );
      if (newItem) {
        // The item reappears at its alphabetical position, which — especially
        // in the long "Not Yet Provided" list — is often scrolled out of
        // view. Bring it into view first so the entrance animation below is
        // actually visible, regardless of which column it lands in.
        newItem.scrollIntoView({ block: "nearest" });

        // is-entering triggers a real @keyframes animation (see CSS), which
        // starts reliably the instant the class is applied — no forced
        // reflow / rAF timing games needed.
        newItem.classList.add("is-entering");
        const clearEntering = () => newItem.classList.remove("is-entering");
        newItem.addEventListener("animationend", clearEntering, {
          once: true,
        });
        // Fallback in case animationend never fires (e.g. reduced-motion
        // users, where the animation is set to `none`).
        setTimeout(clearEntering, ENTER_ANIMATION_MS + 40);
      }
    };

    itemEl.addEventListener("transitionend", finish, { once: true });
    // Fallback in case transitionend never fires (e.g. reduced-motion users).
    setTimeout(finish, LEAVE_ANIMATION_MS + 40);
  }

  function onLevelFilterClick(e) {
    const btn = e.target.closest(".irc2a-chip");
    if (!btn) return;

    filters.level = btn.dataset.level;

    els.levelFilterGroup
      .querySelectorAll(".irc2a-chip")
      .forEach((chip) => chip.classList.toggle("is-active", chip === btn));

    render(currentFilters());
  }

  function onDedpToggleChange() {
    filters.dedpOnly = els.dedpToggle.checked;
    render(currentFilters());
  }

  function onListClick(e) {
    const item = e.target.closest(".irc2a-item");
    if (!item) return;
    animateAndToggle(item, item.dataset.school);
  }

  function onListKeydown(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const item = e.target.closest(".irc2a-item");
    if (!item) return;
    e.preventDefault();
    animateAndToggle(item, item.dataset.school);
  }

  function onSearchInput() {
    render(currentFilters());
  }

  // --- Save to PDF -------------------------------------------------------
  // Uses the browser's native print-to-PDF instead of a screenshot
  // library: the print stylesheet (see the "Print / Save-to-PDF" section
  // in irc2a.css) hides the logo bar, navbar, header actions, and the
  // (purely on-screen) filter/search controls, sizes the page to 8.5x13in
  // "long" paper, and un-clips the school lists so they render in full
  // instead of scrolling. document.title is swapped briefly since most
  // browsers suggest it as the default "Save as PDF" filename. Same
  // approach as IRC1a/IRC1b's saveToPdf().
  //
  // Unlike IRC1a/IRC1b (whose printed tables always show every row),
  // render() here only puts *matching* schools in the DOM at all --
  // filtered-out ones are never appended, not just display:none'd -- so a
  // level/DEDP/search filter left active on screen would otherwise
  // silently omit real schools from the PDF. The current filter/search
  // state is snapshotted, reset to "show everything" for the printed
  // render, then restored to exactly what the user had once the print
  // dialog closes.
  function saveToPdf() {
    const previousTitle = document.title;
    document.title = `IRC2a Number of Schools Provided with TA ${new Date().getFullYear()}`;

    const previousFilters = {
      level: filters.level,
      dedpOnly: filters.dedpOnly,
    };
    const previousSearch = currentFilters();

    filters = { level: "all", dedpOnly: false };
    els.searches.unprovided.value = "";
    els.searches.provided.value = "";
    render();

    const restore = () => {
      document.title = previousTitle;
      filters = previousFilters;
      els.searches.unprovided.value = previousSearch.unprovided;
      els.searches.provided.value = previousSearch.provided;
      render(previousSearch);
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);

    window.print();
  }

  // --- Reset All Data --------------------------------------------------
  // Clicking the reset button opens the confirmation modal (see
  // irc2a-reset-confirm-overlay in irc2a.html); the actual wipe only
  // happens once the user confirms inside that modal.

  function openResetConfirm() {
    if (els.resetConfirmOverlay)
      els.resetConfirmOverlay.classList.add("visible");
  }

  function closeResetConfirm() {
    if (els.resetConfirmOverlay)
      els.resetConfirmOverlay.classList.remove("visible");
  }

  function performReset() {
    if (!els.resetAllBtn) return;

    els.resetAllBtn.disabled = true;
    const originalLabel = els.resetAllBtn.innerHTML;
    els.resetAllBtn.textContent = "Resetting...";

    fetch("/irc/irc2a/reset", { method: "DELETE" })
      .then((res) => res.json())
      .then((result) => {
        if (result.error) {
          alert("Reset failed: " + result.error);
          return;
        }
        initState();
        render(currentFilters());
      })
      .catch((err) => {
        alert("Reset failed: " + err.message);
      })
      .finally(() => {
        els.resetAllBtn.disabled = false;
        els.resetAllBtn.innerHTML = originalLabel;
      });
  }

  function init() {
    cacheEls();
    if (!els.root) return; // not on this page

    initState();
    render();

    if (els.pdfBtn) {
      els.pdfBtn.addEventListener("click", saveToPdf);
    }
    if (els.resetAllBtn) {
      els.resetAllBtn.addEventListener("click", openResetConfirm);
    }
    if (els.resetConfirmCancelBtn) {
      els.resetConfirmCancelBtn.addEventListener("click", closeResetConfirm);
    }
    if (els.resetConfirmOverlay) {
      els.resetConfirmOverlay.addEventListener("click", (e) => {
        if (e.target === els.resetConfirmOverlay) closeResetConfirm();
      });
    }
    if (els.resetConfirmConfirmBtn) {
      els.resetConfirmConfirmBtn.addEventListener("click", () => {
        closeResetConfirm();
        performReset();
      });
    }

    els.lists.unprovided.addEventListener("click", onListClick);
    els.lists.provided.addEventListener("click", onListClick);
    els.lists.unprovided.addEventListener("keydown", onListKeydown);
    els.lists.provided.addEventListener("keydown", onListKeydown);

    els.searches.unprovided.addEventListener("input", onSearchInput);
    els.searches.provided.addEventListener("input", onSearchInput);

    els.levelFilterGroup.addEventListener("click", onLevelFilterClick);
    els.dedpToggle.addEventListener("change", onDedpToggleChange);

    loadPersistedState();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
