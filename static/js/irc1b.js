(function () {
  const MONTHS = [
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
  const MONTH_LABELS = {
    jan: "Jan",
    feb: "Feb",
    mar: "Mar",
    apr: "Apr",
    may: "May",
    jun: "Jun",
    jul: "Jul",
    aug: "Aug",
    sep: "Sep",
    oct: "Oct",
    nov: "Nov",
    dec: "Dec",
  };

  // Quarter groupings for the "Quarterly" chart view -- a quarter's value
  // is the sum of its 3 months' values, and it "has data" if any of its
  // months has data (blank vs. typed, same distinction as the monthly view).
  const QUARTERS = [
    { key: "q1", label: "Q1", months: ["jan", "feb", "mar"] },
    { key: "q2", label: "Q2", months: ["apr", "may", "jun"] },
    { key: "q3", label: "Q3", months: ["jul", "aug", "sep"] },
    { key: "q4", label: "Q4", months: ["oct", "nov", "dec"] },
  ];

  const table = document.getElementById("irc1b-table");
  if (!table) return;

  const totalSpan = document.getElementById("irc1b-total");
  // Overall-performance summary card (right block of the hero row).
  const badgeTotalEl = document.getElementById("irc1b-badge-total");
  const highestValueEl = document.getElementById("irc1b-highest-value");
  const highestMonthEl = document.getElementById("irc1b-highest-month");
  const lowestValueEl = document.getElementById("irc1b-lowest-value");
  const lowestMonthEl = document.getElementById("irc1b-lowest-month");
  const monthsCountEl = document.getElementById("irc1b-months-count");

  const trendChartWrap = document.getElementById("irc1b-trend-chart-wrap");
  const trendToggle = document.getElementById("irc1b-trend-toggle");
  let trendMode = "monthly";

  const pdfBtn = document.getElementById("irc1b-pdf-btn");

  const resetAllBtn = document.getElementById("resetAllBtn");
  const resetConfirmOverlay = document.getElementById(
    "irc1b-reset-confirm-overlay",
  );
  const resetConfirmCancelBtn = document.getElementById(
    "irc1b-reset-confirm-cancel",
  );
  const resetConfirmConfirmBtn = document.getElementById(
    "irc1b-reset-confirm-confirm",
  );

  // Cached from the last recalc, so switching the toggle can redraw the
  // chart instantly without re-reading every input.
  let lastValues = null;
  let lastHasData = null;

  function getValues() {
    const values = {};
    const hasData = {};
    MONTHS.forEach((m) => {
      const input = table.querySelector(
        `input.irc1b-customers[data-month="${m}"]`,
      );
      const raw = input.value;
      hasData[m] = raw !== ""; // a month "has data" if the field isn't blank
      const num = parseFloat(raw);
      values[m] = Number.isNaN(num) ? 0 : num;
    });
    return { values, hasData };
  }

  function recalcTotal(values, hasData) {
    const total = MONTHS.reduce((sum, m) => sum + values[m], 0);
    totalSpan.textContent = total.toLocaleString();
    if (badgeTotalEl) {
      // The table footer always shows a running total (0 included), but
      // the summary card reads as a headline figure -- so it stays an
      // em dash until at least one month has actually been recorded.
      const anyData = MONTHS.some((m) => hasData[m]);
      badgeTotalEl.textContent = anyData ? total.toLocaleString() : "\u2014";
    }
    return total;
  }

  // Rounds to the nearest whole number — customer counts should not show decimals
  function formatWhole(v) {
    return Math.round(v).toLocaleString();
  }

  // Builds the ordered list of chart data points for the current period.
  function buildDataPoints(values, hasData, period) {
    if (period === "quarterly") {
      return QUARTERS.map((q) => ({
        key: q.key,
        label: q.label,
        value: q.months.reduce((sum, m) => sum + values[m], 0),
        hasValue: q.months.some((m) => hasData[m]),
      }));
    }
    return MONTHS.map((m) => ({
      key: m,
      label: MONTH_LABELS[m],
      value: values[m],
      hasValue: hasData[m],
    }));
  }

  // --- Monthly / Quarterly trend chart ---
  // Visual language matches IRC1a's trend chart: light grid + solid
  // axis, rounded line with a soft area fill, white points with a
  // colored ring, bold value labels above each point.
  const CHART_VIEWBOX_WIDTH = 720;
  const CHART_VIEWBOX_HEIGHT = 136;
  const CHART_PLOT_LEFT = 46;
  const CHART_PLOT_RIGHT = 708;
  const CHART_PLOT_TOP = 18;
  const CHART_PLOT_BOTTOM = 104;
  const CHART_X_LABEL_Y = 124;
  const CHART_LABEL_SCREEN_PX = 11.5;
  const CHART_POINT_VAL_SCREEN_PX = 11.5;

  // The <svg> is stretched by CSS (width: 100%, height: 100%) to fill
  // its wrapping element, which is now a fixed height (matching
  // IRC1a's default chart height) rather than one locked to the
  // viewBox's own aspect ratio -- so the X and Y axes end up scaled by
  // two different factors. getChartScale() reports both so text/points
  // can cancel out that distortion. Same approach as IRC1a.
  function getChartScale() {
    if (!trendChartWrap) return { sx: 1, sy: 1 };
    const rect = trendChartWrap.getBoundingClientRect();
    return {
      sx: rect.width > 0 ? rect.width / CHART_VIEWBOX_WIDTH : 1,
      sy: rect.height > 0 ? rect.height / CHART_VIEWBOX_HEIGHT : 1,
    };
  }

  // Draws a <text> anchored at (x, y) in viewBox coordinates, but
  // pre-scaled by the inverse of the chart's X/Y stretch so the glyphs
  // render at a true, undistorted screenPx size once the outer
  // non-uniform scale is applied.
  function svgText(x, y, screenPx, className, content, opts = {}) {
    const { sx, sy } = getChartScale();
    const invX = sx > 0 ? 1 / sx : 1;
    const invY = sy > 0 ? 1 / sy : 1;
    const anchorAttr = opts.anchor ? ` text-anchor="${opts.anchor}"` : "";
    return (
      `<g transform="translate(${x.toFixed(2)},${y.toFixed(2)}) scale(${invX.toFixed(4)},${invY.toFixed(4)})">` +
      `<text class="${className}" x="0" y="0"${anchorAttr} style="font-size:${screenPx}px">${content}</text>` +
      `</g>`
    );
  }

  // Same distortion hits the point markers, but the fix goes the other
  // way -- only cancel the x/y *mismatch* so the marker stays circular
  // (instead of a fixed size like text), pre-scaling locally by
  // (1, sx/sy) so the y radius matches the x radius.
  function svgCircle(cx, cy, r, className, titleContent) {
    const { sx, sy } = getChartScale();
    const yAdjust = sy > 0 ? sx / sy : 1;
    const title = titleContent ? `<title>${titleContent}</title>` : "";
    return (
      `<g transform="translate(${cx.toFixed(2)},${cy.toFixed(2)}) scale(1,${yAdjust.toFixed(4)})">` +
      `<circle class="${className}" cx="0" cy="0" r="${r}">${title}</circle>` +
      `</g>`
    );
  }

  function renderTrendChart(values, hasData) {
    if (!trendChartWrap) return;

    const points = buildDataPoints(values, hasData, trendMode);

    // Every point already carries a real value (0 when nothing has been
    // entered for it yet), so the chart always draws, flat along the 0
    // line until data comes in -- same behavior as IRC1a's trend chart.
    const plotWidth = CHART_PLOT_RIGHT - CHART_PLOT_LEFT;
    const plotHeight = CHART_PLOT_BOTTOM - CHART_PLOT_TOP;
    const n = points.length;

    const max = Math.max(1, ...points.map((p) => p.value));
    const mid = max / 2;

    const xAt = (i) =>
      n === 1
        ? CHART_PLOT_LEFT + plotWidth / 2
        : CHART_PLOT_LEFT + (i / (n - 1)) * plotWidth;
    const yAt = (v) => CHART_PLOT_BOTTOM - (v / max) * plotHeight;
    const yMid = (CHART_PLOT_TOP + CHART_PLOT_BOTTOM) / 2;

    let svg = `<svg class="irc1b-trend-svg" viewBox="0 0 ${CHART_VIEWBOX_WIDTH} ${CHART_VIEWBOX_HEIGHT}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">`;

    // Grid: two light guide lines (max and mid) + a solid axis at the
    // bottom (0), with matching y-axis labels.
    svg += `<line class="irc1b-trend-grid" x1="${CHART_PLOT_LEFT}" y1="${CHART_PLOT_TOP}" x2="${CHART_PLOT_RIGHT}" y2="${CHART_PLOT_TOP}"></line>`;
    svg += `<line class="irc1b-trend-grid" x1="${CHART_PLOT_LEFT}" y1="${yMid}" x2="${CHART_PLOT_RIGHT}" y2="${yMid}"></line>`;
    svg += `<line class="irc1b-trend-axis" x1="${CHART_PLOT_LEFT}" y1="${CHART_PLOT_BOTTOM}" x2="${CHART_PLOT_RIGHT}" y2="${CHART_PLOT_BOTTOM}"></line>`;
    svg += svgText(
      CHART_PLOT_LEFT - 6,
      CHART_PLOT_TOP + 4,
      CHART_LABEL_SCREEN_PX,
      "irc1b-trend-axis-label",
      formatWhole(max),
      { anchor: "end" },
    );
    svg += svgText(
      CHART_PLOT_LEFT - 6,
      yMid + 4,
      CHART_LABEL_SCREEN_PX,
      "irc1b-trend-axis-label",
      formatWhole(mid),
      { anchor: "end" },
    );
    svg += svgText(
      CHART_PLOT_LEFT - 6,
      CHART_PLOT_BOTTOM + 4,
      CHART_LABEL_SCREEN_PX,
      "irc1b-trend-axis-label",
      "0",
      { anchor: "end" },
    );

    // Line + area -- every point has a real (possibly zero) value, so
    // the path runs continuously across all of them, no gaps.
    const linePoints = points.map((p, i) => ({ x: xAt(i), y: yAt(p.value) }));
    const linePath = linePoints
      .map(
        (p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)},${p.y.toFixed(1)}`,
      )
      .join(" ");
    const areaPath =
      `M ${linePoints[0].x.toFixed(1)},${CHART_PLOT_BOTTOM} ` +
      linePoints.map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
      ` L ${linePoints[n - 1].x.toFixed(1)},${CHART_PLOT_BOTTOM} Z`;
    svg += `<path class="irc1b-trend-area" d="${areaPath}"></path>`;
    svg += `<path class="irc1b-trend-path" d="${linePath}"></path>`;

    // Points + value labels + x-axis labels
    points.forEach((p, i) => {
      const x = xAt(i);
      const y = yAt(p.value);
      svg += svgText(
        x,
        CHART_X_LABEL_Y,
        CHART_LABEL_SCREEN_PX,
        "irc1b-trend-x-label",
        p.label,
        { anchor: "middle" },
      );
      svg += svgCircle(
        x,
        y,
        3.4,
        `irc1b-trend-point${p.hasValue ? "" : " irc1b-point-empty"}`,
        `${p.label}: ${p.hasValue ? p.value.toLocaleString() : "No data"}`,
      );
      if (p.value > 0) {
        svg += svgText(
          x,
          y - 7,
          CHART_POINT_VAL_SCREEN_PX,
          "irc1b-trend-point-val",
          p.value.toLocaleString(),
          { anchor: "middle" },
        );
      }
    });

    svg += "</svg>";
    trendChartWrap.innerHTML = svg;
  }

  if (trendToggle) {
    trendToggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".irc1b-toggle-btn");
      if (!btn) return;
      const mode = btn.dataset.mode;
      if (!mode || mode === trendMode) return;
      trendMode = mode;
      trendToggle
        .querySelectorAll(".irc1b-toggle-btn")
        .forEach((b) => b.classList.toggle("active", b === btn));
      if (lastValues && lastHasData) renderTrendChart(lastValues, lastHasData);
    });
  }

  // Keep chart label sizes correct if the card's rendered width changes
  // (window resize, sidebar toggle, etc.) -- the font-size correction
  // in renderTrendChart depends on the wrap element's live width.
  let trendResizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(trendResizeTimer);
    trendResizeTimer = setTimeout(() => {
      if (lastValues && lastHasData) renderTrendChart(lastValues, lastHasData);
    }, 150);
  });

  // Summary-card stats: highest and lowest recorded months (with the
  // month they fall in) and how many months have a recorded TA.
  //
  // Ranked over the 12 individually-entered months rather than the
  // current chart period, so flipping Monthly/Quarterly never changes
  // these figures. A month only counts if its field is non-blank -- a
  // typed 0 is a real record of "nobody served" and is eligible to be
  // the lowest, while a month left empty simply wasn't measured.
  function recalcHighlights(values, hasData) {
    const entries = MONTHS.filter((m) => hasData[m]).map((m) => ({
      label: MONTH_LABELS[m],
      value: values[m],
    }));

    if (monthsCountEl) monthsCountEl.textContent = String(entries.length);

    const setStat = (valueEl, monthEl, entry, emptyNote) => {
      if (valueEl) {
        valueEl.textContent = entry ? entry.value.toLocaleString() : "\u2014";
      }
      if (monthEl) monthEl.textContent = entry ? entry.label : emptyNote;
    };

    if (entries.length === 0) {
      setStat(highestValueEl, highestMonthEl, null, "No data yet");
      setStat(lowestValueEl, lowestMonthEl, null, "No data yet");
      return;
    }

    // Ties resolve to the earliest month, since reduce() only replaces
    // the running pick on a strict improvement.
    const highest = entries.reduce((a, b) => (b.value > a.value ? b : a));
    const lowest = entries.reduce((a, b) => (b.value < a.value ? b : a));

    setStat(highestValueEl, highestMonthEl, highest);
    setStat(lowestValueEl, lowestMonthEl, lowest);
  }

  function recalcAll() {
    const { values, hasData } = getValues();
    lastValues = values;
    lastHasData = hasData;
    recalcTotal(values, hasData);
    recalcHighlights(values, hasData);
    renderTrendChart(values, hasData);
  }

  table.addEventListener("input", (e) => {
    if (!e.target.matches("input.irc1b-customers")) return;
    recalcAll();
  });

  // No "Confirm" button for manual typing (unlike a PDF import), so each
  // cell saves itself once the user leaves it.
  table.addEventListener(
    "blur",
    (e) => {
      if (!e.target.matches("input.irc1b-customers")) return;
      saveManualCount(e.target);
    },
    true, // capture, since blur does not bubble
  );

  function saveManualCount(input) {
    // Cleared cell: delete the saved value instead of leaving it in the
    // DB. Previously this just returned here, so an emptied cell had no
    // way to reach the server and the old value came right back on the
    // next page load/refresh.
    if (input.value === "") {
      deleteManualCount(input.dataset.month);
      return;
    }

    const customers = parseInt(input.value, 10);
    if (Number.isNaN(customers) || customers < 0) return;

    fetch("/irc/irc1b/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month_key: input.dataset.month,
        customers: customers,
      }),
    }).catch(() => {
      /* Best-effort: a failed save shouldn't interrupt typing. */
    });
  }

  function deleteManualCount(monthKey) {
    fetch(`/irc/irc1b/count/${monthKey}`, {
      method: "DELETE",
    }).catch(() => {
      /* Best-effort, same as saveManualCount's save path. */
    });
  }

  // Loads whatever's already saved in the database for this year, so a
  // page reload shows previously-imported/edited counts instead of an
  // empty table (see /irc/irc1b/data in app.py).
  function loadPersistedCounts() {
    fetch("/irc/irc1b/data")
      .then((res) => res.json())
      .then((data) => {
        const counts = data.counts || {};
        Object.keys(counts).forEach((monthKey) => {
          const input = table.querySelector(
            `input.irc1b-customers[data-month="${monthKey}"]`,
          );
          if (input) input.value = counts[monthKey];
        });
        recalcAll();
      })
      .catch(() => {
        /* Table just stays at its blank baseline. */
      });
  }

  // --- Save to PDF ---
  // Uses the browser's native print-to-PDF instead of a screenshot
  // library: the print stylesheet (see the "Print / Save-to-PDF"
  // section in irc1b.css) hides the logo bar, navbar, and this page's
  // header action buttons, sizes the page to 8.5x13in "long" paper,
  // and un-clips anything that only scrolls on screen (the table
  // wrapper). document.title is swapped briefly since most browsers
  // suggest it as the default "Save as PDF" filename. Same approach as
  // IRC1a's saveToPdf().
  function saveToPdf() {
    const previousTitle = document.title;
    document.title = `IRC1b Number of Customers Served ${new Date().getFullYear()}`;

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
  // Clicking the reset button opens the confirmation modal (see
  // irc1b-reset-confirm-overlay in irc1b.html); the actual wipe only
  // happens once the user confirms inside that modal.
  function openResetConfirm() {
    if (resetConfirmOverlay) resetConfirmOverlay.classList.add("visible");
  }

  function closeResetConfirm() {
    if (resetConfirmOverlay) resetConfirmOverlay.classList.remove("visible");
  }

  function performReset() {
    resetAllBtn.disabled = true;
    const originalLabel = resetAllBtn.innerHTML;
    resetAllBtn.textContent = "Resetting...";

    fetch("/irc/irc1b/reset", { method: "DELETE" })
      .then((res) => res.json())
      .then((result) => {
        if (result.error) {
          alert("Reset failed: " + result.error);
          return;
        }
        // Clear every input, then recompute the total/chart/DB state so
        // the page matches the now-empty database.
        table.querySelectorAll("input.irc1b-customers").forEach((input) => {
          input.value = "";
        });
        recalcAll();
      })
      .catch((err) => {
        alert("Reset failed: " + err.message);
      })
      .finally(() => {
        resetAllBtn.disabled = false;
        resetAllBtn.innerHTML = originalLabel;
      });
  }

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

  recalcAll();
  loadPersistedCounts();
})();
