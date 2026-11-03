(function () {
  const tab = document.getElementById("irc3-tab");
  if (!tab) return;

  const DEDP_TOTAL = 26;
  const NONDEDP_TOTAL = 41;
  const GRAND_TOTAL = DEDP_TOTAL + NONDEDP_TOTAL;

  // Standard CSC-style adjectival ratings paired with the 1-5 score
  const SCORE_LABELS = {
    5: "Outstanding",
    4: "Very Satisfactory",
    3: "Satisfactory",
    2: "Unsatisfactory",
    1: "Poor",
  };

  // "Provided with TA" is no longer typed in here -- it's computed
  // server-side from IRC2a's school status (see /irc/irc3/data) and
  // simply displayed. Only the two Target fields are still editable.
  let dedpTA = 0;
  let nondedpTA = 0;

  function clamp(value, min, max) {
    if (Number.isNaN(value)) return min;
    return Math.min(Math.max(value, min), max);
  }

  // Maps a percentage to the 1-5 OPCR/IPCR efficiency score using the
  // published brackets (96-100 / 91-95 / 86-90 / 81-85 / <=80).
  function getScore(percent) {
    if (percent >= 96) return 5;
    if (percent >= 91) return 4;
    if (percent >= 86) return 3;
    if (percent >= 81) return 2;
    return 1;
  }

  function paintScoreBadge(el, score) {
    if (!el) return;
    el.textContent = `${score} \u2013 ${SCORE_LABELS[score]}`;
    el.className = `irc3-score-badge irc3-score-${score}`;
  }

  function paintPercentBadge(el, percent) {
    if (!el) return;
    el.textContent = `${percent}%`;
  }

  function readClampedInt(id, min, max) {
    const el = document.getElementById(id);
    if (!el) return 0;
    const clamped = clamp(parseInt(el.value, 10) || 0, min, max);
    el.value = clamped;
    return clamped;
  }

  // --- Provision + score row ---
  function updateRow(idPrefix, taCount, base) {
    const percent = base > 0 ? Math.round((taCount / base) * 100) : 0;
    const score = getScore(percent);

    paintPercentBadge(document.getElementById(`${idPrefix}-percent`), percent);
    paintScoreBadge(document.getElementById(`${idPrefix}-score`), score);
  }

  function recalcAll() {
    const totalTA = dedpTA + nondedpTA;

    // Provided with TA (now a read-only display, driven by IRC2a)
    const dedpTaEl = document.getElementById("irc3-dedp-ta");
    const nondedpTaEl = document.getElementById("irc3-nondedp-ta");
    if (dedpTaEl) dedpTaEl.textContent = dedpTA.toLocaleString();
    if (nondedpTaEl) nondedpTaEl.textContent = nondedpTA.toLocaleString();

    // Percentage + score
    updateRow("irc3-dedp-ta", dedpTA, DEDP_TOTAL);
    updateRow("irc3-nondedp-ta", nondedpTA, NONDEDP_TOTAL);
    document.getElementById("irc3-total-ta").textContent =
      totalTA.toLocaleString();
    updateRow("irc3-total-ta", totalTA, GRAND_TOTAL);

    // Not provided with TA (fully automatic)
    const dedpNot = DEDP_TOTAL - dedpTA;
    const nondedpNot = NONDEDP_TOTAL - nondedpTA;
    document.getElementById("irc3-dedp-not-provided").textContent =
      dedpNot.toLocaleString();
    document.getElementById("irc3-nondedp-not-provided").textContent =
      nondedpNot.toLocaleString();
    document.getElementById("irc3-total-not-provided").textContent = (
      dedpNot + nondedpNot
    ).toLocaleString();

    // Target totals
    recalcTarget();
  }

  function recalcTarget() {
    const dedpTarget = readClampedInt("irc3-dedp-target", 0, DEDP_TOTAL);
    const nondedpTarget = readClampedInt(
      "irc3-nondedp-target",
      0,
      NONDEDP_TOTAL,
    );

    document.getElementById("irc3-total-target").textContent = (
      dedpTarget + nondedpTarget
    ).toLocaleString();
  }

  // --- Rating basis cards: walks every possible count 0..base and
  // buckets it by score, using the exact same percent/score logic as
  // the live table, so the cards never drift out of sync with the
  // badges shown in the main table.
  function computeScoreRanges(base) {
    const ranges = { 5: null, 4: null, 3: null, 2: null, 1: null };

    for (let count = 0; count <= base; count++) {
      const percent = Math.round((count / base) * 100);
      const score = getScore(percent);

      if (!ranges[score]) {
        ranges[score] = [count, count];
      } else {
        ranges[score][1] = count;
      }
    }

    return ranges;
  }

  function formatRange(range, score) {
    if (!range) return "&ndash;";
    const [min, max] = range;
    if (score === 1) return `${max} & below`;
    if (min === max) return `${min}`;
    return `${min}&ndash;${max}`;
  }

  function renderBasisCards() {
    const bases = {
      dedp: DEDP_TOTAL,
      nondedp: NONDEDP_TOTAL,
      total: GRAND_TOTAL,
    };

    Object.entries(bases).forEach(([key, base]) => {
      const ranges = computeScoreRanges(base);
      [5, 4, 3, 2, 1].forEach((score) => {
        const el = document.getElementById(`irc3-basis-${score}-${key}`);
        if (el) el.innerHTML = formatRange(ranges[score], score);
      });
    });
  }

  // --- Persistence: only the two Target fields are saved from here.
  // "Provided with TA" comes from IRC2a and is never written by this page.
  let saveTimer = null;
  function scheduleSaveTargets() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveTargets, 400);
  }

  function saveTargets() {
    const dedpTarget = readClampedInt("irc3-dedp-target", 0, DEDP_TOTAL);
    const nondedpTarget = readClampedInt(
      "irc3-nondedp-target",
      0,
      NONDEDP_TOTAL,
    );

    fetch("/irc/irc3/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dedp_target: dedpTarget,
        nondedp_target: nondedpTarget,
      }),
    }).catch(() => {
      /* Best-effort: the inputs already reflect the change locally; a
         failed save here just means a reload would show stale targets. */
    });
  }

  // Loads the computed TA counts + previously-saved targets, so a page
  // reload shows the table as it actually stands instead of resetting
  // to zero (see /irc/irc3/data in app.py).
  function loadPersisted() {
    fetch("/irc/irc3/data")
      .then((res) => res.json())
      .then((data) => {
        dedpTA = data.dedp_ta_count || 0;
        nondedpTA = data.nondedp_ta_count || 0;

        const dedpTargetEl = document.getElementById("irc3-dedp-target");
        const nondedpTargetEl = document.getElementById("irc3-nondedp-target");
        if (dedpTargetEl) dedpTargetEl.value = data.dedp_target || 0;
        if (nondedpTargetEl) nondedpTargetEl.value = data.nondedp_target || 0;

        recalcAll();
      })
      .catch(() => {
        /* Table just stays at its blank baseline. */
        recalcAll();
      });
  }

  // --- Wire up events (targets only -- TA counts are read-only now) ---
  ["irc3-dedp-target", "irc3-nondedp-target"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", recalcTarget);
    el.addEventListener("input", scheduleSaveTargets);
  });

  // --- Save to PDF ---
  // Uses the browser's native print-to-PDF instead of a screenshot
  // library: the print stylesheet (see the "Print / Save-to-PDF"
  // section in irc3.css) hides the logo bar, navbar, and this page's
  // header action buttons, sizes the page to 8.5x13in "long" paper,
  // and un-clips anything that only scrolls on screen (the table
  // wrapper). document.title is swapped briefly since most browsers
  // suggest it as the default "Save as PDF" filename. Same approach
  // as IRC1a's saveToPdf().
  const pdfBtn = document.getElementById("irc3-pdf-btn");

  function saveToPdf() {
    const previousTitle = document.title;
    document.title = `IRC3 Status of TA Provision to Schools ${new Date().getFullYear()}`;

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

  // --- Reset All Data ---
  // There's no dedicated reset endpoint for IRC3 -- "Provided with TA" is
  // computed live from IRC2a and was never stored here, so the only thing
  // to actually reset is the two Target fields. Reused the normal /save
  // endpoint with both targets zeroed out (same approach IRC6 takes for
  // its Goal/Outcome rows, which reuses its own save endpoint rather than
  // a dedicated reset route). Clicking the reset button opens the
  // confirmation modal (see irc3-reset-confirm-overlay in irc3.html); the
  // actual reset only happens once the user confirms inside that modal.
  const resetBtn = document.getElementById("irc3-reset-btn");
  const resetConfirmOverlay = document.getElementById(
    "irc3-reset-confirm-overlay",
  );
  const resetConfirmCancelBtn = document.getElementById(
    "irc3-reset-confirm-cancel",
  );
  const resetConfirmConfirmBtn = document.getElementById(
    "irc3-reset-confirm-confirm",
  );

  function openResetConfirm() {
    if (resetConfirmOverlay) resetConfirmOverlay.classList.add("visible");
  }

  function closeResetConfirm() {
    if (resetConfirmOverlay) resetConfirmOverlay.classList.remove("visible");
  }

  function performReset() {
    if (resetBtn) resetBtn.disabled = true;

    const dedpTargetEl = document.getElementById("irc3-dedp-target");
    const nondedpTargetEl = document.getElementById("irc3-nondedp-target");
    if (dedpTargetEl) dedpTargetEl.value = 0;
    if (nondedpTargetEl) nondedpTargetEl.value = 0;
    recalcAll();

    fetch("/irc/irc3/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dedp_target: 0, nondedp_target: 0 }),
    })
      .catch((err) => {
        alert("Reset failed: " + err.message);
      })
      .finally(() => {
        if (resetBtn) resetBtn.disabled = false;
      });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", openResetConfirm);
  }
  if (resetConfirmCancelBtn) {
    resetConfirmCancelBtn.addEventListener("click", closeResetConfirm);
  }
  if (resetConfirmOverlay) {
    resetConfirmOverlay.addEventListener("click", (e) => {
      if (e.target === resetConfirmOverlay) closeResetConfirm();
    });
  }
  if (resetConfirmConfirmBtn) {
    resetConfirmConfirmBtn.addEventListener("click", () => {
      closeResetConfirm();
      performReset();
    });
  }

  // --- Initial render ---
  renderBasisCards();
  loadPersisted();
})();
