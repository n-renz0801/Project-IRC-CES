(function () {
  const SECTIONS = ["elementary", "secondary"];
  // Every scope that can drive a line chart. "overall" has no table of its
  // own (no Total column, no row totals) -- it only ever feeds the combined
  // elem+secondary chart below the dashboard.
  const CHART_SCOPES = ["elementary", "secondary", "overall"];
  const MONTH_KEYS = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  const MONTH_LABELS = [
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
  const QUARTER_KEYS = ["Q1", "Q2", "Q3", "Q4"];

  // Shared plot geometry for the line charts — used both when placing
  // data points and when placing the matching x-axis labels beneath them.
  // Kept flatter (wider aspect ratio) than a typical chart on purpose —
  // these sit stacked one after another down the page, so height is at
  // a premium; see the matching viewBox="0 0 760 146" in irc2b.html.
  const CHART_PLOT_LEFT = 44;
  const CHART_PLOT_RIGHT = 740;
  const CHART_PLOT_TOP = 22;
  const CHART_PLOT_BOTTOM = 108;
  const CHART_X_LABEL_Y = 128;

  // The <svg> is stretched by CSS (width: 100%) far past its viewBox's own
  // 760 user-unit width, so any font-size written in those same user units
  // gets magnified right along with it -- a "12px" label can easily render
  // at 16-18 actual screen pixels once the card is full desktop width.
  // These two constants are the font sizes we actually want ON SCREEN (in
  // real CSS pixels, matching the rest of the page's small text); they get
  // converted into the right number of user units per-chart, at render
  // time, based on that chart's *actual* rendered width (see
  // getChartFontScale/updateLineChart below).
  const CHART_VIEWBOX_WIDTH = 760;
  const CHART_LABEL_SCREEN_PX = 11.5;
  const CHART_POINT_VAL_SCREEN_PX = 11.5;

  const tab = document.getElementById("irc2b-tab");
  if (!tab) return;

  // Per-scope display mode: "quarters" or "months".
  //   - For "elementary" / "secondary": drives BOTH that table's Total
  //     column (quarters reached vs. total months checked) AND that same
  //     section's line chart (quarterly vs. monthly) -- the two always
  //     stay in lockstep for a given section, toggled from either control.
  //   - For "overall": drives only the combined elem+secondary chart,
  //     independently of the two section charts.
  // Defaults to "months" for every scope.
  const scopeMode = {
    elementary: "months",
    secondary: "months",
    overall: "months",
  };

  function getTable(section) {
    return document.getElementById(`irc2b-table-${section}`);
  }

  function getRowCheckboxes(section, row) {
    const table = getTable(section);
    return Array.from(
      table.querySelectorAll(`input.irc2b-check[data-row="${row}"]`),
    );
  }

  function getAllRowIndices(section) {
    const table = getTable(section);
    const rows = table.querySelectorAll("tbody tr[data-row-index]");
    return Array.from(rows).map((r) => r.dataset.rowIndex);
  }

  // Computes both totals for a row and stashes them as data-attributes
  // on the badge so toggling later is just a re-read, not a re-scan.
  // Still returns the quarters Set — recalcFooter's grand-total logic
  // (schools reached in 2+ quarters) depends on it and is unchanged.
  function recalcRow(section, row) {
    const checkboxes = getRowCheckboxes(section, row);

    const quartersWithTA = new Set();
    let monthsChecked = 0;

    checkboxes.forEach((cb) => {
      if (cb.checked) {
        quartersWithTA.add(cb.dataset.quarter);
        monthsChecked += 1;
      }
    });

    const totalEl = getTable(section).querySelector(
      `.irc2b-row-total[data-row="${row}"]`,
    );
    if (totalEl) {
      totalEl.dataset.quartersTotal = quartersWithTA.size;
      totalEl.dataset.monthsTotal = monthsChecked;
    }

    return quartersWithTA;
  }

  // Footer row: "how many schools" per quarter, and "how many schools"
  // reached in 2+ quarters overall. Returns { count2Plus, totalSchools }
  // so the caller can roll this up into the page-level dashboard.
  // NOTE: unaffected by scopeMode — always quarter-based.
  function recalcFooter(section) {
    const quarterCounts = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
    let schoolsWithTwoPlusQuarters = 0;

    const rowIndices = getAllRowIndices(section);

    rowIndices.forEach((row) => {
      const quartersWithTA = recalcRow(section, row);

      quartersWithTA.forEach((q) => {
        quarterCounts[q] += 1;
      });

      if (quartersWithTA.size >= 2) {
        schoolsWithTwoPlusQuarters += 1;
      }
    });

    const table = getTable(section);
    Object.keys(quarterCounts).forEach((q) => {
      const el = table.querySelector(
        `.irc2b-quarter-footer-total[data-quarter="${q}"]`,
      );
      if (el) el.textContent = quarterCounts[q].toLocaleString();
    });

    const grandEl = table.querySelector(".irc2b-footer-grand-total");
    if (grandEl) {
      grandEl.textContent = schoolsWithTwoPlusQuarters.toLocaleString();
    }

    return {
      count2Plus: schoolsWithTwoPlusQuarters,
      totalSchools: rowIndices.length,
    };
  }

  // Paints one section's row-total badges and its table headers according
  // to that section's own scopeMode. Reads from the data-* attributes set
  // in recalcRow — no checkbox scanning here.
  function applyTotalDisplayMode(section) {
    const table = getTable(section);
    if (!table) return;

    const isMonths = scopeMode[section] === "months";

    table.querySelectorAll(".irc2b-row-total").forEach((el) => {
      const value = isMonths
        ? el.dataset.monthsTotal
        : el.dataset.quartersTotal;
      el.textContent = Number(value || 0).toLocaleString();
    });

    const modeTextEl = table.querySelector(".irc2b-total-mode-text");
    if (modeTextEl) {
      modeTextEl.textContent = isMonths ? "Months" : "Quarters";
    }

    const headerEl = table.querySelector(".irc2b-total-col-clickable");
    if (headerEl) {
      headerEl.setAttribute(
        "title",
        isMonths
          ? "Showing total checked months (click to switch to quarters reached)"
          : "Showing distinct quarters reached (click to switch to total months)",
      );
    }
  }

  // Toggling a table's Total column also flips that same section's line
  // chart between monthly/quarterly, since both read the same scopeMode
  // entry for that section.
  function toggleSectionMode(section) {
    scopeMode[section] =
      scopeMode[section] === "quarters" ? "months" : "quarters";
    applyTotalDisplayMode(section);
    applyChartToggleButtons(section);
    updateLineChart(section);
  }

  // --- Dashboard: consolidated "TA Coverage Summary" card ---
  // Paints one level's row (hero % + thick bar, IRC2a-style): fills in
  // the raw count, the big hero percentage, and the width of the bar.
  // The label under the hero and the bar's track color are static
  // markup — only these three values change.
  function updatePercentStat(section, count, total) {
    const percent = total > 0 ? Math.round((count / total) * 100) : 0;

    const countEl = document.getElementById(`irc2b-${section}-count`);
    const percentEl = document.getElementById(`irc2b-${section}-percent`);
    const barEl = document.getElementById(`irc2b-${section}-bar`);

    if (countEl) countEl.textContent = count.toLocaleString();
    if (percentEl) percentEl.textContent = `${percent}%`;
    if (barEl) barEl.style.width = `${percent}%`;

    return percent;
  }

  // Hero number: same "2+ quarters reached" metric as the per-level rows,
  // just rolled up across Elementary + Secondary combined.
  function updateOverallStat(elementaryStats, secondaryStats) {
    const count = elementaryStats.count2Plus + secondaryStats.count2Plus;
    const total = elementaryStats.totalSchools + secondaryStats.totalSchools;
    const percent = total > 0 ? Math.round((count / total) * 100) : 0;

    const percentEl = document.getElementById("irc2b-overall-percent");
    const countEl = document.getElementById("irc2b-overall-count");

    if (percentEl) percentEl.textContent = `${percent}%`;
    if (countEl) countEl.textContent = count.toLocaleString();

    return percent;
  }

  // --- Per-table line chart: monthly or quarterly counts ---

  // Schools with TA checked in each of the 12 months.
  function getMonthlyCounts(section) {
    const table = getTable(section);
    return MONTH_KEYS.map(
      (key) =>
        table.querySelectorAll(`input.irc2b-check[data-month="${key}"]:checked`)
          .length,
    );
  }

  // Schools reached in each of the 4 quarters (any month within the
  // quarter checked counts once) — same "reached" definition used by
  // the footer's per-quarter totals, just recomputed here for the chart.
  function getQuarterlyCounts(section) {
    const table = getTable(section);
    return QUARTER_KEYS.map((q) => {
      const checked = table.querySelectorAll(
        `input.irc2b-check[data-quarter="${q}"]:checked`,
      );
      const rowsReached = new Set(
        Array.from(checked).map((cb) => cb.dataset.row),
      );
      return rowsReached.size;
    });
  }

  // Combined elem+secondary counts for the "overall" chart -- simple
  // element-wise sum of the two sections' own series.
  function getOverallMonthlyCounts() {
    const e = getMonthlyCounts("elementary");
    const s = getMonthlyCounts("secondary");
    return MONTH_KEYS.map((_, i) => e[i] + s[i]);
  }

  function getOverallQuarterlyCounts() {
    const e = getQuarterlyCounts("elementary");
    const s = getQuarterlyCounts("secondary");
    return QUARTER_KEYS.map((_, i) => e[i] + s[i]);
  }

  // Builds the path/area/points/value-label markup for the chart's
  // data <g> group. Works for any number of points (12 for monthly,
  // 4 for quarterly) since spacing is derived from values.length, and for
  // any scope ("elementary" / "secondary" / "overall") since it's only
  // ever used to build a CSS class suffix. `userFontSize` is already
  // pre-converted (see getChartFontScale) so the labels land at
  // CHART_POINT_VAL_SCREEN_PX regardless of how wide this chart happens
  // to be rendered.
  function buildLineDataMarkup(scope, values, maxValue, userFontSize) {
    const plotWidth = CHART_PLOT_RIGHT - CHART_PLOT_LEFT;
    const plotHeight = CHART_PLOT_BOTTOM - CHART_PLOT_TOP;
    const n = values.length;
    const step = n > 1 ? plotWidth / (n - 1) : 0;

    const points = values.map((val, i) => {
      const x = CHART_PLOT_LEFT + i * step;
      const ratio = maxValue > 0 ? val / maxValue : 0;
      const y = CHART_PLOT_BOTTOM - ratio * plotHeight;
      return { x, y, val };
    });

    const linePath = points
      .map(
        (p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)},${p.y.toFixed(1)}`,
      )
      .join(" ");

    const areaPath =
      `M ${points[0].x.toFixed(1)},${CHART_PLOT_BOTTOM} ` +
      points.map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
      ` L ${points[n - 1].x.toFixed(1)},${CHART_PLOT_BOTTOM} Z`;

    const circles = points
      .map(
        (p) =>
          `<circle class="irc2b-linechart-point irc2b-linechart-point-${scope}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.4"></circle>`,
      )
      .join("");

    const labels = points
      .map(
        (p) =>
          `<text class="irc2b-linechart-point-val irc2b-linechart-point-val-${scope}" x="${p.x.toFixed(1)}" y="${(p.y - 7).toFixed(1)}" style="font-size:${userFontSize}px">${p.val}</text>`,
      )
      .join("");

    return (
      `<path class="irc2b-linechart-area-${scope}" d="${areaPath}"></path>` +
      `<path class="irc2b-linechart-path irc2b-linechart-path-${scope}" d="${linePath}"></path>` +
      circles +
      labels
    );
  }

  // Builds the x-axis label group to match whichever label set (months
  // or quarters) is active — same x spacing formula as the data points.
  // `userFontSize` is pre-converted the same way as in buildLineDataMarkup.
  function buildXAxisLabelMarkup(labels, userFontSize) {
    const plotWidth = CHART_PLOT_RIGHT - CHART_PLOT_LEFT;
    const n = labels.length;
    const step = n > 1 ? plotWidth / (n - 1) : 0;

    return labels
      .map((label, i) => {
        const x = CHART_PLOT_LEFT + i * step;
        return `<text class="irc2b-linechart-x-label" x="${x.toFixed(1)}" y="${CHART_X_LABEL_Y}" style="font-size:${userFontSize}px">${label}</text>`;
      })
      .join("");
  }

  // A chart's <svg> is scaled from its 760-wide viewBox up to however
  // wide the card actually renders. This returns that scale factor
  // (rendered CSS width / 760) so callers can convert a desired ON-SCREEN
  // pixel size into the user-unit font-size that will actually produce
  // it. Falls back to 1 (no correction) if the element isn't laid out yet.
  function getChartFontScale(svgEl) {
    if (!svgEl) return 1;
    const width = svgEl.getBoundingClientRect().width;
    return width > 0 ? width / CHART_VIEWBOX_WIDTH : 1;
  }

  // Repaints one scope's chart (elementary, secondary, or the combined
  // overall chart) according to that scope's own entry in scopeMode.
  function updateLineChart(scope) {
    const lineGroup = document.getElementById(`irc2b-${scope}-line-group`);
    const xAxisGroup = document.getElementById(`irc2b-${scope}-xaxis-group`);
    const svgEl = lineGroup ? lineGroup.closest("svg.irc2b-linechart") : null;
    const captionEl = document.querySelector(
      `.irc2b-linechart-wrapper-${scope} .irc2b-linechart-caption`,
    );
    if (!lineGroup || !xAxisGroup) return;

    const isQuarterly = scopeMode[scope] === "quarters";

    let values;
    let maxValue;

    if (scope === "overall") {
      values = isQuarterly
        ? getOverallQuarterlyCounts()
        : getOverallMonthlyCounts();
      maxValue =
        getAllRowIndices("elementary").length +
        getAllRowIndices("secondary").length;
    } else {
      values = isQuarterly
        ? getQuarterlyCounts(scope)
        : getMonthlyCounts(scope);
      maxValue = getAllRowIndices(scope).length;
    }

    const labels = isQuarterly ? QUARTER_KEYS : MONTH_LABELS;

    const scale = getChartFontScale(svgEl);
    const labelFontUser = (CHART_LABEL_SCREEN_PX / scale).toFixed(2);
    const pointValFontUser = (CHART_POINT_VAL_SCREEN_PX / scale).toFixed(2);

    lineGroup.innerHTML = buildLineDataMarkup(
      scope,
      values,
      maxValue,
      pointValFontUser,
    );
    xAxisGroup.innerHTML = buildXAxisLabelMarkup(labels, labelFontUser);

    // The three static axis-number labels ("0", mid, max) are rendered by
    // the Jinja template rather than built here, but they're subject to
    // the exact same viewBox stretching -- so they need the same
    // per-render correction to actually match the rest of the page.
    if (svgEl) {
      svgEl.querySelectorAll(".irc2b-linechart-axis-label").forEach((el) => {
        el.style.fontSize = `${labelFontUser}px`;
      });
    }

    if (captionEl) {
      if (scope === "overall") {
        captionEl.textContent = isQuarterly
          ? "Total schools (Elementary + Secondary) reached with TA, per quarter"
          : "Total schools (Elementary + Secondary) provided with TA, per month";
      } else {
        captionEl.textContent = isQuarterly
          ? "Schools reached with TA, per quarter"
          : "Schools provided with TA, per month";
      }
    }
  }

  // Repaints the active/inactive state on a given scope's toggle buttons
  // only (each chart's Monthly/Quarterly buttons are scoped via
  // data-scope on their wrapping .irc2b-chart-toggle, so the three charts
  // never step on each other).
  function applyChartToggleButtons(scope) {
    document
      .querySelectorAll(
        `.irc2b-chart-toggle[data-scope="${scope}"] .irc2b-chart-toggle-btn`,
      )
      .forEach((btn) => {
        const activeChartMode =
          scopeMode[scope] === "quarters" ? "quarterly" : "monthly";
        const isActive = btn.dataset.chartMode === activeChartMode;
        btn.classList.toggle("irc2b-chart-toggle-btn-active", isActive);
      });
  }

  function setScopeChartMode(scope, chartBtnMode) {
    if (chartBtnMode !== "monthly" && chartBtnMode !== "quarterly") return;
    const newMode = chartBtnMode === "quarterly" ? "quarters" : "months";
    if (scopeMode[scope] === newMode) return;

    scopeMode[scope] = newMode;
    if (scope !== "overall") applyTotalDisplayMode(scope);
    applyChartToggleButtons(scope);
    updateLineChart(scope);
  }

  function updateDashboard() {
    const elementaryStats = recalcFooter("elementary");
    const secondaryStats = recalcFooter("secondary");

    updatePercentStat(
      "elementary",
      elementaryStats.count2Plus,
      elementaryStats.totalSchools,
    );
    updatePercentStat(
      "secondary",
      secondaryStats.count2Plus,
      secondaryStats.totalSchools,
    );
    updateOverallStat(elementaryStats, secondaryStats);

    SECTIONS.forEach((section) => applyTotalDisplayMode(section));
    CHART_SCOPES.forEach((scope) => updateLineChart(scope));
  }

  // --- Event delegation: checkbox changes ---
  SECTIONS.forEach((section) => {
    const table = getTable(section);
    if (!table) return;

    table.addEventListener("change", (e) => {
      const target = e.target;
      if (!target.matches("input.irc2b-check")) return;

      updateDashboard();
      saveManualCheck(section, target);
    });
  });

  // Reads a row's school name straight from its label cell (strips the
  // "N." numbering prefix the template renders), since the checkboxes
  // themselves only carry a row index, not the school's name.
  function getSchoolNameForRow(section, rowIndex) {
    const table = getTable(section);
    const row = table.querySelector(`tbody tr[data-row-index="${rowIndex}"]`);
    const labelCell = row ? row.querySelector(".irc2b-label-col") : null;
    if (!labelCell) return null;
    return (labelCell.textContent || "")
      .replace(/^\s*\d+\.\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // No "Save" button on this grid -- every checkbox persists itself the
  // moment it's toggled.
  function saveManualCheck(section, checkbox) {
    const schoolName = getSchoolNameForRow(section, checkbox.dataset.row);
    if (!schoolName) return;

    fetch("/irc/irc2b/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        updates: [
          {
            school_name: schoolName,
            month_key: checkbox.dataset.month,
            provided: checkbox.checked,
          },
        ],
      }),
    }).catch(() => {
      /* Best-effort: the checkbox already reflects the change locally; a
         failed save here just means a reload would show stale data. */
    });
  }

  // Loads previously-saved checkmarks from the database and re-renders
  // once they're in, so a page reload shows the grid as it was left
  // instead of resetting every box back to unchecked (see /irc/irc2b/data
  // in app.py).
  function loadPersistedFrequencies() {
    fetch("/irc/irc2b/data")
      .then((res) => res.json())
      .then((data) => {
        const frequencies = data.frequencies || {};

        SECTIONS.forEach((section) => {
          const table = getTable(section);
          if (!table) return;

          table.querySelectorAll("tbody tr[data-row-index]").forEach((row) => {
            const rowIndex = row.dataset.rowIndex;
            const name = getSchoolNameForRow(section, rowIndex);
            const monthMap = name ? frequencies[name] : null;
            if (!monthMap) return;

            Object.keys(monthMap).forEach((monthKey) => {
              if (!monthMap[monthKey]) return;
              const cb = row.querySelector(
                `input.irc2b-check[data-month="${monthKey}"]`,
              );
              if (cb) cb.checked = true;
            });
          });
        });

        updateDashboard();
      })
      .catch(() => {
        /* Grid just stays at its blank baseline. */
      });
  }

  // --- Save to PDF ---
  // Uses the browser's native print-to-PDF instead of a screenshot
  // library: the print stylesheet (see the "Print / Save-to-PDF"
  // section in irc2b.css) hides the logo bar, navbar, and this page's
  // header action buttons, sizes the page to 8.5x13in "long" paper,
  // and un-clips anything that only scrolls on screen (the table
  // wrappers). document.title is swapped briefly since most browsers
  // suggest it as the default "Save as PDF" filename. Mirrors IRC1a's
  // saveToPdf() (irc1a.js) exactly, just scoped to this page's title.
  function saveToPdf() {
    const previousTitle = document.title;
    document.title = `IRC2b Frequency of TA Provided to DEDP Priority Schools ${new Date().getFullYear()}`;

    const restoreTitle = () => {
      document.title = previousTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };
    window.addEventListener("afterprint", restoreTitle);

    window.print();
  }

  const pdfBtn = document.getElementById("irc2b-pdf-btn");
  if (pdfBtn) {
    pdfBtn.addEventListener("click", saveToPdf);
  }

  // --- Reset All Data ---
  // Wipes every checkbox (both sections) both on screen and in the
  // database. No per-cell undo -- this is a deliberate, confirmed,
  // all-or-nothing action (see /irc/irc2b/reset in app.py). Clicking the
  // reset button opens the confirmation modal (see
  // irc2b-reset-confirm-overlay in irc2b.html); the actual wipe only
  // happens once the user confirms inside that modal.
  const resetConfirmOverlay = document.getElementById(
    "irc2b-reset-confirm-overlay",
  );
  const resetConfirmCancelBtn = document.getElementById(
    "irc2b-reset-confirm-cancel",
  );
  const resetConfirmConfirmBtn = document.getElementById(
    "irc2b-reset-confirm-confirm",
  );

  function openResetConfirm() {
    if (resetConfirmOverlay) resetConfirmOverlay.classList.add("visible");
  }

  function closeResetConfirm() {
    if (resetConfirmOverlay) resetConfirmOverlay.classList.remove("visible");
  }

  function performReset() {
    const btn = document.getElementById("irc2b-reset-all-btn");
    if (btn) btn.disabled = true;

    fetch("/irc/irc2b/reset", { method: "DELETE" })
      .then((res) => {
        if (!res.ok) throw new Error("reset failed");
        return res.json();
      })
      .then(() => {
        SECTIONS.forEach((section) => {
          const table = getTable(section);
          if (!table) return;
          table.querySelectorAll("input.irc2b-check").forEach((cb) => {
            cb.checked = false;
          });
        });
        updateDashboard();
      })
      .catch(() => {
        window.alert(
          "Something went wrong while resetting the data. Please try again.",
        );
      })
      .finally(() => {
        if (btn) btn.disabled = false;
      });
  }

  const resetAllBtn = document.getElementById("irc2b-reset-all-btn");
  if (resetAllBtn) {
    resetAllBtn.addEventListener("click", openResetConfirm);
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

  // --- Total column header click: toggle Quarters <-> Months (and, in
  // lockstep, that section's chart between quarterly/monthly) ---
  SECTIONS.forEach((section) => {
    const table = getTable(section);
    if (!table) return;

    const header = table.querySelector(".irc2b-total-col-clickable");
    if (!header) return;

    header.addEventListener("click", () => toggleSectionMode(section));
  });

  // --- Chart toggle buttons: Monthly <-> Quarterly, scoped per chart via
  // the wrapping .irc2b-chart-toggle's data-scope ---
  document.querySelectorAll(".irc2b-chart-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const scopeEl = btn.closest(".irc2b-chart-toggle");
      const scope = scopeEl ? scopeEl.dataset.scope : null;
      if (!scope) return;
      setScopeChartMode(scope, btn.dataset.chartMode);
    });
  });

  // --- Keep chart label sizes correct if the card's rendered width
  // changes (window resize, sidebar toggle, etc.) -- the font-size
  // correction in updateLineChart depends on the SVG's live width. ---
  let chartResizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(chartResizeTimer);
    chartResizeTimer = setTimeout(() => {
      CHART_SCOPES.forEach((scope) => updateLineChart(scope));
    }, 150);
  });

  // --- Initial render ---
  CHART_SCOPES.forEach((scope) => applyChartToggleButtons(scope));
  updateDashboard();
  loadPersistedFrequencies();
})();
