(function () {
  // Format a rating input's value to exactly 3 decimal places (e.g. "4" -> "4.000")
  function formatToThreeDecimals(input) {
    if (!input || input.value === "") return;
    const num = parseFloat(input.value);
    if (Number.isNaN(num)) return;
    input.value = num.toFixed(3);
  }

  // --- Original IRC1a calculation code ---
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
  const INDICATOR_COUNT = 10;
  const INDICATOR_LABELS = {
    1: "Observes the schedule.",
    2: "Establishes the objectives of the Technical Assistance.",
    3: "Uses necessary tools/process/procedure for the conduct of TA.",
    4: "Provide relevant, timely and appropriate Technical Assistance.",
    5: "Understand the situation of schools in case may be, their needs, aspirations, plans, strength and weaknesses.",
    6: "Recommends/suggests points for improvement.",
    7: "Provides constructive feedback and establishes a cordial atmosphere in giving of feedback.",
    8: "Skills and competencies of the TA provider.",
    9: "Processes the results of the Technical Assistance.",
    10: "General view of the provision of the Technical Assistance.",
  };

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

  const QUARTERS = [
    { label: "Q1", months: ["jan", "feb", "mar"] },
    { label: "Q2", months: ["apr", "may", "jun"] },
    { label: "Q3", months: ["jul", "aug", "sep"] },
    { label: "Q4", months: ["oct", "nov", "dec"] },
  ];

  const BAND_CLASSES = [
    "irc1a-band-poor",
    "irc1a-band-fair",
    "irc1a-band-satisfactory",
    "irc1a-band-very-satisfactory",
  ];

  const table = document.getElementById("irc1a-table");
  if (!table) return;

  const lowestList = document.getElementById("irc1a-lowest-list");
  const rowAverages = {};
  const monthAverages = {};

  const overallAvgEl = document.getElementById("irc1a-overall-avg");
  const overallDescEl = document.getElementById("irc1a-overall-desc");
  const footerAnnualAvgEl = document.getElementById("irc1a-footer-annual-avg");
  const footerAnnualDescEl = document.getElementById(
    "irc1a-footer-annual-desc",
  );

  const trendChartWrap = document.getElementById("irc1a-trend-chart-wrap");
  const trendToggle = document.getElementById("irc1a-trend-toggle");
  let trendMode = "monthly";

  const resetBtn = document.getElementById("irc1a-reset-btn");
  const resetConfirmOverlay = document.getElementById(
    "irc1a-reset-confirm-overlay",
  );
  const resetConfirmCancelBtn = document.getElementById(
    "irc1a-reset-confirm-cancel",
  );
  const resetConfirmConfirmBtn = document.getElementById(
    "irc1a-reset-confirm-confirm",
  );

  const legendBtn = document.getElementById("irc1a-legend-btn");
  const legendOverlay = document.getElementById("irc1a-legend-overlay");
  const legendCloseBtn = document.getElementById("irc1a-legend-close");

  const pdfBtn = document.getElementById("irc1a-pdf-btn");

  // ============================================================
  // Positive Aspects / Opportunities for Improvement (OFI)
  //
  // Each card holds exactly one year-scoped entry (see IRC1ARemark in
  // models.py) -- not an addable/removable list. The header button
  // reads "Add" while the entry is empty and "Edit" once it has a
  // value (see updateRemarkActionLabel(), same label-swap idea as
  // irc4's FIELD_MODAL_CONFIG/updateFieldActionLabel), and always opens
  // the shared Add/Edit modal. The entry itself is shown as plain,
  // non-interactive text on the page -- no outline, no click handler,
  // no inline remove button; adding, editing, and deleting all happen
  // through that modal (mirrors irc4's read-only .irc4-field-text +
  // pencil action button for Activity/TA Receiver/MOV's).
  // ============================================================

  const remarksData = { positive: null, ofi: null };
  const remarkTextEls = {
    positive: document.getElementById("irc1aPositiveText"),
    ofi: document.getElementById("irc1aOfiText"),
  };
  const addRemarkBtns = {
    positive: document.getElementById("irc1aAddPositiveBtn"),
    ofi: document.getElementById("irc1aAddOfiBtn"),
  };
  const REMARK_CATEGORY_LABELS = {
    positive: "Positive Aspect",
    ofi: "Opportunity for Improvement",
  };
  const REMARK_PLACEHOLDER = "No entry yet.";

  function updateRemarkActionLabel(category) {
    const btn = addRemarkBtns[category];
    if (!btn) return;
    const label = btn.querySelector('[data-role="action-label"]');
    if (!label) return;
    const remark = remarksData[category];
    const hasValue = !!(remark && remark.text && remark.text.trim());
    label.textContent = hasValue ? "Edit" : "Add";
  }

  function renderRemarkField(category) {
    const textEl = remarkTextEls[category];
    if (textEl) {
      const remark = remarksData[category];
      const hasText = !!(remark && remark.text && remark.text.trim());
      textEl.textContent = hasText ? remark.text : REMARK_PLACEHOLDER;
      textEl.classList.toggle("is-placeholder", !hasText);
    }
    updateRemarkActionLabel(category);
  }

  // Renders whatever's currently in remarksData -- used at init (after
  // loadPersistedRatings() populates it from the server) and again any
  // time the entry is added, edited, or deleted via the modal.
  function renderRemarksFromData() {
    ["positive", "ofi"].forEach(renderRemarkField);
  }

  if (addRemarkBtns.positive) {
    addRemarkBtns.positive.addEventListener("click", () =>
      openRemarkModal("positive", remarksData.positive),
    );
  }
  if (addRemarkBtns.ofi) {
    addRemarkBtns.ofi.addEventListener("click", () =>
      openRemarkModal("ofi", remarksData.ofi),
    );
  }

  // --- Add/Edit Remark modal ---
  // Shared by both cards (Positive Aspects + OFI), same as irc4's single
  // field modal is shared by Activity/TA Receiver/MOV's. Which category
  // it's open for -- and whether that category's entry already exists --
  // is tracked in JS state below, not in the markup (see
  // irc1a-remark-modal-overlay in irc1a.html).
  const remarkModalOverlay = document.getElementById(
    "irc1a-remark-modal-overlay",
  );
  const remarkModalTitle = document.getElementById("irc1a-remark-modal-title");
  const remarkModalInput = document.getElementById("irc1a-remark-modal-input");
  const remarkModalClose = document.getElementById("irc1a-remark-modal-close");
  const remarkModalCancel = document.getElementById(
    "irc1a-remark-modal-cancel",
  );
  const remarkModalSave = document.getElementById("irc1a-remark-modal-save");
  const remarkModalDelete = document.getElementById(
    "irc1a-remark-modal-delete",
  );

  let remarkModalCategory = null;

  function openRemarkModal(category, remark) {
    if (!remarkModalOverlay) return;
    remarkModalCategory = category;

    const label = REMARK_CATEGORY_LABELS[category] || "Entry";
    if (remarkModalTitle) {
      remarkModalTitle.textContent = remark ? `Edit ${label}` : `Add ${label}`;
    }
    if (remarkModalInput) {
      remarkModalInput.value = remark ? remark.text || "" : "";
    }
    if (remarkModalDelete) remarkModalDelete.hidden = !remark;

    remarkModalOverlay.classList.add("visible");
    if (remarkModalInput) remarkModalInput.focus();
  }

  function closeRemarkModal() {
    if (remarkModalOverlay) remarkModalOverlay.classList.remove("visible");
    remarkModalCategory = null;
    if (remarkModalInput) remarkModalInput.value = "";
  }

  async function saveRemarkModal() {
    const category = remarkModalCategory;
    if (!category || !remarkModalInput) return;
    const text = remarkModalInput.value;
    const existing = remarksData[category];

    if (remarkModalSave) remarkModalSave.disabled = true;

    try {
      if (existing) {
        // Update the category's existing entry.
        const res = await fetch("/irc/irc1a/remark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: existing.id, text }),
        });
        const updated = await res.json();
        remarksData[category] = updated;
      } else {
        // First entry for this category.
        const res = await fetch("/irc/irc1a/remark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category, text }),
        });
        remarksData[category] = await res.json();
      }
      renderRemarkField(category);
      closeRemarkModal();
    } catch (e) {
      /* Best-effort: leave the modal open so the user can retry Save
         rather than silently losing what they typed. */
    } finally {
      if (remarkModalSave) remarkModalSave.disabled = false;
    }
  }

  function deleteRemarkModal() {
    const category = remarkModalCategory;
    const existing = category ? remarksData[category] : null;
    if (!category || !existing) return;

    remarksData[category] = null;
    renderRemarkField(category);
    closeRemarkModal();

    fetch(`/irc/irc1a/remark/${encodeURIComponent(existing.id)}`, {
      method: "DELETE",
    }).catch(() => {
      /* Best-effort, same as irc4's removeObjective -- the entry is
         already cleared from the UI; a failed delete just risks it
         reappearing on reload. */
    });
  }

  if (remarkModalClose) {
    remarkModalClose.addEventListener("click", closeRemarkModal);
  }
  if (remarkModalCancel) {
    remarkModalCancel.addEventListener("click", closeRemarkModal);
  }
  if (remarkModalOverlay) {
    remarkModalOverlay.addEventListener("click", (e) => {
      if (e.target === remarkModalOverlay) closeRemarkModal();
    });
  }
  if (remarkModalSave) {
    remarkModalSave.addEventListener("click", saveRemarkModal);
  }
  if (remarkModalDelete) {
    remarkModalDelete.addEventListener("click", deleteRemarkModal);
  }

  function descriptiveValue(avg) {
    if (avg === null) return "—";
    if (avg >= 3.51) return "Very Satisfactory";
    if (avg >= 2.51) return "Satisfactory";
    if (avg >= 1.51) return "Fair";
    return "Poor";
  }

  function bandClass(avg) {
    if (avg === null) return null;
    if (avg >= 3.51) return "irc1a-band-very-satisfactory";
    if (avg >= 2.51) return "irc1a-band-satisfactory";
    if (avg >= 1.51) return "irc1a-band-fair";
    return "irc1a-band-poor";
  }

  // Applies the descriptive text + color-coded band class to a badge/pill
  // element (used for per-row badges, the footer annual badge, and the
  // hero "Overall Performance" pill).
  function paintDescriptiveBadge(el, avg) {
    if (!el) return;
    el.textContent = avg === null ? "—" : descriptiveValue(avg);
    el.classList.remove(...BAND_CLASSES);
    const cls = bandClass(avg);
    if (cls) el.classList.add(cls);
  }

  function average(values) {
    const nums = values.filter((v) => !Number.isNaN(v));
    if (nums.length === 0) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  function recalcMonth(month) {
    const inputs = table.querySelectorAll(
      `tbody input.irc1a-rating[data-month="${month}"]`,
    );
    const values = Array.from(inputs).map((input) => parseFloat(input.value));
    const avg = average(values);

    const avgSpan = table.querySelector(`.irc1a-avg[data-month="${month}"]`);
    if (avgSpan) {
      avgSpan.textContent = avg === null ? "—" : avg.toFixed(3);
      avgSpan.classList.remove(...BAND_CLASSES);
      const monthBand = bandClass(avg);
      if (monthBand) avgSpan.classList.add(monthBand);
    }

    monthAverages[month] = avg;
  }

  function recalcRow(indicatorId) {
    const inputs = table.querySelectorAll(
      `tbody tr[data-indicator="${indicatorId}"] input.irc1a-rating`,
    );
    const values = Array.from(inputs).map((input) => parseFloat(input.value));
    const avg = average(values);

    const rowAvgSpan = table.querySelector(
      `.irc1a-row-avg[data-indicator="${indicatorId}"]`,
    );
    if (rowAvgSpan)
      rowAvgSpan.textContent = avg === null ? "—" : avg.toFixed(3);

    const rowDescSpan = table.querySelector(
      `.irc1a-row-desc[data-indicator="${indicatorId}"]`,
    );
    paintDescriptiveBadge(rowDescSpan, avg);

    // Meter bar under the rating strip: width = average out of 4,
    // colored by the same band as the Description badge.
    const meterFill = table.querySelector(
      `.irc1a-meter-fill[data-indicator="${indicatorId}"]`,
    );
    if (meterFill) {
      meterFill.style.width =
        avg === null ? "0%" : Math.min(100, (avg / 4) * 100) + "%";
      meterFill.classList.remove(...BAND_CLASSES);
      const meterBand = bandClass(avg);
      if (meterBand) meterFill.classList.add(meterBand);
    }

    rowAverages[indicatorId] = avg;
    return avg;
  }

  // Overall average across ALL entered cells (every indicator, every
  // month) -- not an average of the row averages, but the average of
  // available raw data points, so it isn't skewed by how many months a
  // given indicator happens to have.
  function recalcOverall() {
    const inputs = table.querySelectorAll("tbody input.irc1a-rating");
    const values = Array.from(inputs).map((input) => parseFloat(input.value));
    const avg = average(values);

    if (overallAvgEl)
      overallAvgEl.textContent = avg === null ? "—" : avg.toFixed(3);
    paintDescriptiveBadge(overallDescEl, avg);
    if (overallDescEl && avg === null)
      overallDescEl.textContent = "No data yet";

    if (footerAnnualAvgEl)
      footerAnnualAvgEl.textContent = avg === null ? "—" : avg.toFixed(3);
    paintDescriptiveBadge(footerAnnualDescEl, avg);
  }

  // --- Monthly / Quarterly trend chart ---
  // Visual language matches the IRC2b line charts: light grid + solid
  // axis, rounded line with a soft area fill, white points with a
  // colored ring, bold value labels above each point.
  const CHART_VIEWBOX_WIDTH = 720;
  const CHART_VIEWBOX_HEIGHT = 136;
  const CHART_PLOT_LEFT = 34;
  const CHART_PLOT_RIGHT = 708;
  const CHART_PLOT_TOP = 18;
  const CHART_PLOT_BOTTOM = 104;
  const CHART_X_LABEL_Y = 124;
  const CHART_LABEL_SCREEN_PX = 11.5;
  const CHART_POINT_VAL_SCREEN_PX = 11.5;

  function bandColor(avg) {
    if (avg === null || avg === undefined) return "#9ca3af";
    if (avg >= 3.51) return "#22c55e";
    if (avg >= 2.51) return "#3b82f6";
    if (avg >= 1.51) return "#f59e0b";
    return "#ef4444";
  }

  function getMonthlyTrendPoints() {
    return MONTHS.map((m) => {
      const raw = monthAverages[m];
      const hasValue = raw !== undefined && raw !== null;
      return {
        label: MONTH_LABELS[m],
        avg: hasValue ? raw : 0,
        hasValue,
        tooltip: MONTH_LABELS[m],
      };
    });
  }

  function getQuarterlyTrendPoints() {
    // Quarter average is over whichever of its months have data; a
    // quarter with zero populated months plots at 0 rather than being
    // skipped.
    return QUARTERS.map((q) => {
      const monthVals = q.months
        .map((m) => monthAverages[m])
        .filter((v) => v !== null && v !== undefined);
      const avg = monthVals.length
        ? monthVals.reduce((a, b) => a + b, 0) / monthVals.length
        : 0;
      return {
        label: q.label,
        avg,
        hasValue: monthVals.length > 0,
        tooltip: q.label,
      };
    });
  }

  // The <svg> is stretched by CSS (width: 100%, height: 100%) to fill
  // its wrapping element, which can end up a different aspect ratio
  // than the viewBox -- the wrap's height maximizes to fill whatever
  // vertical space the hero row gives it, while its width just follows
  // the column. With preserveAspectRatio="none" that means the X and Y
  // axes get scaled by two different factors, so anything drawn in
  // viewBox user-units (like glyph shapes) comes out stretched taller
  // or shorter than it is wide.
  //
  // Line/area geometry is fine with that -- it's supposed to fill the
  // box. Text isn't: a letter stretched 2x vertically just looks
  // broken. getChartScale() reports both factors so text can cancel
  // out the distortion (see svgText()) while everything else keeps
  // maximizing the available height as before.
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
  // themselves render at a true, undistorted screenPx size once the
  // outer non-uniform scale is applied. The anchor point (x, y) still
  // moves and spaces out with the rest of the chart geometry -- only
  // the letterforms are protected from stretching.
  function svgText(x, y, screenPx, className, content, opts = {}) {
    const { sx, sy } = getChartScale();
    const invX = sx > 0 ? 1 / sx : 1;
    const invY = sy > 0 ? 1 / sy : 1;
    const anchorAttr = opts.anchor ? ` text-anchor="${opts.anchor}"` : "";
    const extraStyle = opts.style ? opts.style : "";
    return (
      `<g transform="translate(${x.toFixed(2)},${y.toFixed(2)}) scale(${invX.toFixed(4)},${invY.toFixed(4)})">` +
      `<text class="${className}" x="0" y="0"${anchorAttr} style="font-size:${screenPx}px;${extraStyle}">${content}</text>` +
      `</g>`
    );
  }

  // Same distortion as text hits the point markers, but the fix needs
  // to go the other way. Text should stay a fixed, true-to-life pixel
  // size no matter how big the chart gets -- that's normal UI text.
  // The point markers were never meant to be a fixed size, though:
  // before any of this, r="3.4" scaled up along with the chart's own
  // width stretch (sx), just distorted into an ellipse by the taller
  // height stretch (sy). Canceling the distortion *completely* (the
  // text approach) made them a tiny, constant 3.4px regardless of
  // chart size -- too small on a big chart. Instead, only cancel the
  // x/y *mismatch*: pre-scale locally by (1, sx/sy) so the y radius
  // is corrected to match the x radius, and the marker still grows
  // with the chart the way it originally did, just circular now.
  function svgCircle(cx, cy, r, className, style, titleContent) {
    const { sx, sy } = getChartScale();
    const yAdjust = sy > 0 ? sx / sy : 1;
    const styleAttr = style ? ` style="${style}"` : "";
    const title = titleContent ? `<title>${titleContent}</title>` : "";
    return (
      `<g transform="translate(${cx.toFixed(2)},${cy.toFixed(2)}) scale(1,${yAdjust.toFixed(4)})">` +
      `<circle class="${className}" cx="0" cy="0" r="${r}"${styleAttr}>${title}</circle>` +
      `</g>`
    );
  }

  function renderTrendChart() {
    if (!trendChartWrap) return;

    const points =
      trendMode === "quarterly"
        ? getQuarterlyTrendPoints()
        : getMonthlyTrendPoints();

    // Every point already carries a real value (0 when nothing has been
    // entered for it yet -- see getMonthlyTrendPoints/getQuarterlyTrendPoints),
    // so the chart always draws, flat along the 0 line until data comes in.
    const plotWidth = CHART_PLOT_RIGHT - CHART_PLOT_LEFT;
    const plotHeight = CHART_PLOT_BOTTOM - CHART_PLOT_TOP;
    const n = points.length;

    const xAt = (i) =>
      n === 1
        ? CHART_PLOT_LEFT + plotWidth / 2
        : CHART_PLOT_LEFT + (i / (n - 1)) * plotWidth;
    // Rating scale runs 0-4 (0 = no data, 4 = ceiling), so the y-axis
    // always maps 0 -> bottom, 4 -> top.
    const yAt = (v) => CHART_PLOT_BOTTOM - (v / 4) * plotHeight;
    const yMid = (CHART_PLOT_TOP + CHART_PLOT_BOTTOM) / 2;

    let svg = `<svg class="irc1a-trend-svg" viewBox="0 0 ${CHART_VIEWBOX_WIDTH} ${CHART_VIEWBOX_HEIGHT}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">`;

    // Grid: two light guide lines (rating 4 and rating 2) + a solid
    // axis at the bottom (rating 0), with matching y-axis labels.
    svg += `<line class="irc1a-trend-grid" x1="${CHART_PLOT_LEFT}" y1="${CHART_PLOT_TOP}" x2="${CHART_PLOT_RIGHT}" y2="${CHART_PLOT_TOP}"></line>`;
    svg += `<line class="irc1a-trend-grid" x1="${CHART_PLOT_LEFT}" y1="${yMid}" x2="${CHART_PLOT_RIGHT}" y2="${yMid}"></line>`;
    svg += `<line class="irc1a-trend-axis" x1="${CHART_PLOT_LEFT}" y1="${CHART_PLOT_BOTTOM}" x2="${CHART_PLOT_RIGHT}" y2="${CHART_PLOT_BOTTOM}"></line>`;
    svg += svgText(
      CHART_PLOT_LEFT - 6,
      CHART_PLOT_TOP + 4,
      CHART_LABEL_SCREEN_PX,
      "irc1a-trend-axis-label",
      "4",
      { anchor: "end" },
    );
    svg += svgText(
      CHART_PLOT_LEFT - 6,
      yMid + 4,
      CHART_LABEL_SCREEN_PX,
      "irc1a-trend-axis-label",
      "2",
      { anchor: "end" },
    );
    svg += svgText(
      CHART_PLOT_LEFT - 6,
      CHART_PLOT_BOTTOM + 4,
      CHART_LABEL_SCREEN_PX,
      "irc1a-trend-axis-label",
      "0",
      { anchor: "end" },
    );

    // Line + area -- every point now has a real (possibly zero) value,
    // so the path runs continuously across all of them, no gaps.
    const linePoints = points.map((p, i) => ({ x: xAt(i), y: yAt(p.avg) }));
    const linePath = linePoints
      .map(
        (p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)},${p.y.toFixed(1)}`,
      )
      .join(" ");
    const areaPath =
      `M ${linePoints[0].x.toFixed(1)},${CHART_PLOT_BOTTOM} ` +
      linePoints.map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
      ` L ${linePoints[n - 1].x.toFixed(1)},${CHART_PLOT_BOTTOM} Z`;
    svg += `<path class="irc1a-trend-area" d="${areaPath}"></path>`;
    svg += `<path class="irc1a-trend-path" d="${linePath}"></path>`;

    // Points + value labels + x-axis labels
    points.forEach((p, i) => {
      const x = xAt(i);
      const y = yAt(p.avg);
      const color = p.hasValue ? bandColor(p.avg) : "#9ca3af";
      svg += svgText(
        x,
        CHART_X_LABEL_Y,
        CHART_LABEL_SCREEN_PX,
        "irc1a-trend-x-label",
        p.label,
        { anchor: "middle" },
      );
      svg += svgCircle(
        x,
        y,
        3.4,
        "irc1a-trend-point",
        `stroke:${color}`,
        `${p.tooltip}: ${p.hasValue ? p.avg.toFixed(3) + " (" + descriptiveValue(p.avg) + ")" : "No data"}`,
      );
      svg += svgText(
        x,
        y - 7,
        CHART_POINT_VAL_SCREEN_PX,
        "irc1a-trend-point-val",
        p.avg.toFixed(3),
        { anchor: "middle", style: `fill:${color}` },
      );
    });

    svg += "</svg>";
    trendChartWrap.innerHTML = svg;
  }

  if (trendToggle) {
    trendToggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".irc1a-toggle-btn");
      if (!btn) return;
      const mode = btn.dataset.mode;
      if (mode === trendMode) return;
      trendMode = mode;
      trendToggle
        .querySelectorAll(".irc1a-toggle-btn")
        .forEach((b) => b.classList.toggle("active", b === btn));
      renderTrendChart();
    });
  }

  // Keep chart label sizes correct if the card's rendered width changes
  // (window resize, sidebar toggle, etc.) -- the font-size correction
  // in renderTrendChart depends on the wrap element's live width.
  let trendResizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(trendResizeTimer);
    trendResizeTimer = setTimeout(renderTrendChart, 150);
  });

  function recalcLowest() {
    const entries = [];
    for (let i = 1; i <= INDICATOR_COUNT; i++) {
      const avg = rowAverages[i];
      if (avg !== null && avg !== undefined) {
        entries.push({ id: i, label: INDICATOR_LABELS[i], avg });
      }
    }

    lowestList.innerHTML = "";

    if (entries.length === 0) {
      const li = document.createElement("li");
      li.className = "irc1a-lowest-placeholder";
      li.textContent = "Enter ratings below to see results.";
      lowestList.appendChild(li);
      return;
    }

    entries.sort((a, b) => a.avg - b.avg);
    const lowestThree = entries.slice(0, 3);

    lowestThree.forEach((item, idx) => {
      const rank = idx + 1;
      const li = document.createElement("li");
      li.className = "irc1a-lowest-item";
      li.innerHTML = `<span class="irc1a-lowest-rank irc1a-rank-${rank}">${rank}</span><span class="irc1a-lowest-label">${item.label}</span><span class="irc1a-lowest-avg">${item.avg.toFixed(3)}</span>`;
      lowestList.appendChild(li);
    });
  }

  function recalcAll() {
    MONTHS.forEach(recalcMonth);
    for (let i = 1; i <= INDICATOR_COUNT; i++) recalcRow(i);
    recalcLowest();
    recalcOverall();
    renderTrendChart();
  }

  table.addEventListener("input", (e) => {
    if (!e.target.matches("input.irc1a-rating")) return;
    const row = e.target.closest("tr[data-indicator]");
    recalcMonth(e.target.dataset.month);
    if (row) recalcRow(row.dataset.indicator);
    recalcLowest();
    recalcOverall();
    renderTrendChart();
  });

  // Format each rating cell to exactly 3 decimal places once the user
  // leaves the field (blur), so "4" becomes "4.000" without disrupting typing.
  // Manual typing needs its own persistence path -- unlike a PDF import,
  // there's no "Confirm" button here, so each cell saves itself on blur.
  table.addEventListener(
    "blur",
    (e) => {
      if (!e.target.matches("input.irc1a-rating")) return;
      formatToThreeDecimals(e.target);
      saveManualRating(e.target);
    },
    true, // capture, since blur does not bubble
  );

  function saveManualRating(input) {
    const row = input.closest("tr[data-indicator]");
    if (!row) return;

    const indicatorId = row.dataset.indicator;
    const monthKey = input.dataset.month;

    // Cleared cell: delete the saved value instead of leaving it in the
    // DB. Previously this just returned here, so an emptied cell had no
    // way to reach the server and the old value came right back on the
    // next page load/refresh.
    if (input.value === "") {
      deleteManualRating(indicatorId, monthKey);
      return;
    }

    const value = parseFloat(input.value);
    if (Number.isNaN(value)) return;

    fetch("/irc/irc1a/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month_key: monthKey,
        ratings: { [indicatorId]: value },
      }),
    }).catch(() => {
      /* Best-effort: a failed save here shouldn't interrupt typing. The
         next successful edit (or a page reload once connectivity is back)
         will resend the current value anyway. */
    });
  }

  function deleteManualRating(indicatorId, monthKey) {
    fetch(`/irc/irc1a/rating/${monthKey}/${indicatorId}`, {
      method: "DELETE",
    }).catch(() => {
      /* Best-effort, same as saveManualRating's save path -- a failed
         delete just means the old value comes back on next reload, which
         the user can retry by clearing the cell again. */
    });
  }

  // Loads whatever's already saved in the database for this year, so a
  // page reload shows previously-imported/edited ratings -- and
  // previously-saved Positive Aspects/OFI entries (see remarksData above)
  // -- instead of an empty page (see /irc/irc1a/data in app.py).
  function loadPersistedRatings() {
    fetch("/irc/irc1a/data")
      .then((res) => res.json())
      .then((data) => {
        const ratings = data.ratings || {};
        Object.keys(ratings).forEach((indicatorId) => {
          Object.keys(ratings[indicatorId]).forEach((monthKey) => {
            const input = table.querySelector(
              `tbody tr[data-indicator="${indicatorId}"] input.irc1a-rating[data-month="${monthKey}"]`,
            );
            if (input) {
              input.value = ratings[indicatorId][monthKey];
              formatToThreeDecimals(input);
            }
          });
        });
        recalcAll();

        // Each category only ever shows a single entry now -- if the
        // server has more than one (e.g. left over from before this was
        // single-entry), take the first and leave the rest alone.
        const positiveList = (data.remarks && data.remarks.positive) || [];
        const ofiList = (data.remarks && data.remarks.ofi) || [];
        remarksData.positive = positiveList[0] || null;
        remarksData.ofi = ofiList[0] || null;
        renderRemarksFromData();
      })
      .catch(() => {
        /* Table just stays at its blank baseline. */
      });
  }

  // --- Legend modal ---
  function openLegend() {
    if (legendOverlay) legendOverlay.classList.add("visible");
  }

  function closeLegend() {
    if (legendOverlay) legendOverlay.classList.remove("visible");
  }

  if (legendBtn) legendBtn.addEventListener("click", openLegend);
  if (legendCloseBtn) legendCloseBtn.addEventListener("click", closeLegend);
  if (legendOverlay) {
    legendOverlay.addEventListener("click", (e) => {
      if (e.target === legendOverlay) closeLegend();
    });
  }

  // --- Save to PDF ---
  // Uses the browser's native print-to-PDF instead of a screenshot
  // library: the print stylesheet (see the "Print / Save-to-PDF"
  // section in irc1a.css) hides the logo bar, navbar, and this page's
  // header action buttons, sizes the page to 8.5x13in "long" paper,
  // and un-clips anything that only scrolls on screen (the table
  // wrapper, remarks boxes). document.title is swapped briefly since
  // most browsers suggest it as the default "Save as PDF" filename.
  function saveToPdf() {
    const previousTitle = document.title;
    document.title = `IRC1a Monthly Customer Feedback Rating ${new Date().getFullYear()}`;

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
  // irc1a-reset-confirm-overlay in irc1a.html); the actual wipe only
  // happens once the user confirms inside that modal.
  function openResetConfirm() {
    if (resetConfirmOverlay) resetConfirmOverlay.classList.add("visible");
  }

  function closeResetConfirm() {
    if (resetConfirmOverlay) resetConfirmOverlay.classList.remove("visible");
  }

  function performReset() {
    if (resetBtn) resetBtn.disabled = true;

    fetch("/irc/irc1a/reset", { method: "DELETE" })
      .then((res) => res.json())
      .then((result) => {
        if (resetBtn) resetBtn.disabled = false;
        if (result.error) {
          alert("Reset failed: " + result.error);
          return;
        }

        // Wipe the table client-side without re-triggering per-cell
        // save/delete requests (the DB was already cleared server-side
        // in one shot above).
        table.querySelectorAll("tbody input.irc1a-rating").forEach((input) => {
          input.value = "";
        });

        // Wiped server-side in one shot above -- clear the entries
        // client-side without re-triggering per-entry delete requests.
        remarksData.positive = null;
        remarksData.ofi = null;
        renderRemarksFromData();

        recalcAll();
      })
      .catch((err) => {
        if (resetBtn) resetBtn.disabled = false;
        alert("Reset failed: " + err.message);
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

  recalcAll();
  loadPersistedRatings();
})();
