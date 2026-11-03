(function () {
  const tableEl = document.getElementById("irc8c-summary-table");
  if (!tableEl) return;

  const scoreEls = {
    "1a": document.getElementById("irc8c-score-1a"),
    "1b": document.getElementById("irc8c-score-1b"),
    "1c": document.getElementById("irc8c-score-1c"),
    "2a": document.getElementById("irc8c-score-2a"),
    "2b": document.getElementById("irc8c-score-2b"),
  };
  const overallEl = document.getElementById("irc8c-overall-score");
  const pmesNumericalEl = document.getElementById("irc8c-pmes-numerical");
  const pmesAdjectivalEl = document.getElementById("irc8c-pmes-adjectival");

  // Part II-A / II-B each count for 2.5% of the final score: the section
  // average x 0.025 -- same constant irc8b.js uses for its
  // .irc8b-section-footer-value.
  const PART2_WEIGHT = 0.025;

  // PMES Rating Table (right-hand table on the form).
  const PMES_BANDS = [
    { min: 4.5, numerical: 5, label: "Outstanding", cls: "outstanding" },
    {
      min: 3.5,
      numerical: 4,
      label: "Very Satisfactory",
      cls: "very-satisfactory",
    },
    { min: 2.5, numerical: 3, label: "Satisfactory", cls: "satisfactory" },
    { min: 1.5, numerical: 2, label: "Unsatisfactory", cls: "unsatisfactory" },
    { min: -Infinity, numerical: 1, label: "Poor", cls: "poor" },
  ];

  // The Part II section keys, as stored by IRC8BRating.section_key.
  const SECTION_LEADERSHIP = "leadership";
  const SECTION_CBC = "cbc";

  // ================= API helper =================
  async function apiGet(url) {
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new Error(
        "Network error — please check your connection and try again.",
      );
    }
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      // no/invalid JSON body — fall through with data = null
    }
    if (!res.ok) {
      throw new Error(
        (data && data.error) || "Something went wrong. Please try again.",
      );
    }
    return data;
  }

  // ================= Helpers =================
  // Four decimals so Part I and Part II scores (Part II's are avg x 0.025)
  // add up to the Overall Score exactly as displayed.
  function fmtScore(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return Number(n).toFixed(4);
  }

  function average(values) {
    const rated = values.filter((v) => v !== null && v !== undefined);
    if (rated.length === 0) return null;
    return rated.reduce((sum, v) => sum + v, 0) / rated.length;
  }

  // Same figure as the "Overall Rating" (irc8a-summary-value) shown on
  // each Part I tab: the sum of that part's objective scores, or null when
  // nothing in the part has a score yet.
  function part1Score(kras, part) {
    let sum = 0;
    let hasAny = false;
    kras
      .filter((k) => k.part === part)
      .forEach((kra) => {
        (kra.objectives || []).forEach((o) => {
          if (o.score !== null && o.score !== undefined) {
            sum += o.score;
            hasAny = true;
          }
        });
      });
    return hasAny ? sum : null;
  }

  // Same figure as irc8b's .irc8b-section-footer-value: the average of
  // the section's subsection averages x 0.025, or null when nothing in the
  // section is rated.
  function part2Score(ratings, subToSection, sectionKey) {
    const subAverages = [];
    Object.keys(ratings || {}).forEach((subKey) => {
      if (subToSection[subKey] !== sectionKey) return;
      const sa = average(Object.values(ratings[subKey]));
      if (sa !== null) subAverages.push(sa);
    });
    const secAvg = average(subAverages);
    return secAvg === null ? null : secAvg * PART2_WEIGHT;
  }

  function pmesBand(overall) {
    // Compare at the form's 3-decimal precision so e.g. 4.4996 reads as
    // 4.500 and falls in the 4.500-5.000 band, as on the PMES table.
    const rounded = Math.round(overall * 1000) / 1000;
    return PMES_BANDS.find((b) => rounded >= b.min);
  }

  // Last computed result, read by the print layout below.
  const printState = { scores: {}, overall: null, band: null };

  // ================= Render =================
  function render(kras, ratings, subToSection) {
    const scores = {
      "1a": part1Score(kras, "a"),
      "1b": part1Score(kras, "b"),
      "1c": part1Score(kras, "c"),
      "2a": part2Score(ratings, subToSection, SECTION_LEADERSHIP),
      "2b": part2Score(ratings, subToSection, SECTION_CBC),
    };

    printState.scores = scores;
    printState.overall = null;
    printState.band = null;

    Object.keys(scoreEls).forEach((key) => {
      scoreEls[key].textContent = fmtScore(scores[key]);
    });

    const present = Object.values(scores).filter((v) => v !== null);
    pmesNumericalEl.className = "irc8c-center irc8c-pmes";
    pmesAdjectivalEl.className = "irc8c-center irc8c-pmes";

    if (present.length === 0) {
      overallEl.textContent = "—";
      pmesNumericalEl.textContent = "";
      pmesAdjectivalEl.textContent = "";
      return;
    }

    const overall = present.reduce((sum, v) => sum + v, 0);
    overallEl.textContent = fmtScore(overall);

    const band = pmesBand(overall);
    printState.overall = overall;
    printState.band = band;
    pmesNumericalEl.textContent = String(band.numerical);
    pmesAdjectivalEl.textContent = band.label;
    pmesNumericalEl.classList.add("irc8c-pmes--" + band.cls);
    pmesAdjectivalEl.classList.add("irc8c-pmes--" + band.cls);
  }

  function showError(message) {
    const errBox = document.createElement("div");
    errBox.className = "irc8c-load-error";
    errBox.textContent = "Couldn't load this report: " + message;
    const flow = document.querySelector(".irc8c-flow");
    flow.parentNode.insertBefore(errBox, flow);
  }

  // ================= Print / Save as PDF =================

  // Builds a print-only copy of the Summary of Ratings page (summary table,

  // PMES rating table, Ratee-Rater Agreement boxes) laid out like page 3 of

  // the OPCRF sheet, then calls window.print(). Styling is in

  // irc8c_print.css (long bond, landscape). The root is moved to <body> so

  // the print stylesheet can hide the rest of the page.

  const printRoot = document.getElementById("irc8c-print-root");

  const printBtn = document.getElementById("irc8c-print-btn");

  const printCache = { preparer: {}, header: {}, dates: {} };

  if (printRoot) document.body.appendChild(printRoot);

  const pText = (v) => {
    const div = document.createElement("div");

    div.textContent = v == null ? "" : String(v);

    return div.innerHTML;
  };

  const pNum = (n) =>
    n === null || n === undefined || isNaN(n) ? "" : Number(n).toFixed(4);

  const pDate = (iso) => {
    if (!iso) return "";

    const d = new Date(iso + "T00:00:00");

    return isNaN(d)
      ? iso
      : d.toLocaleDateString("en-US", {
          year: "numeric",

          month: "long",

          day: "numeric",
        });
  };

  function printSummary() {
    const s = printState.scores || {};

    const band = printState.band;

    const rows = [
      ["1a", "A. Commitment to Organizational Outcomes", "60%"],

      ["1b", "B. Innovating and Intervening Accomplishments", "20%"],

      ["1c", "C. Organizational Effectiveness", "15%"],

      ["2a", "A. Leadership Competencies", "2.5% (0.125)"],

      ["2b", "B. Core Behavioural Competencies", "2.5% (0.125)"],
    ];

    const body = rows

      .map(([key, label, weight], i) => {
        const part =
          i === 0
            ? '<th rowspan="3" class="r-part">PART I</th>'
            : i === 3
              ? '<th rowspan="2" class="r-part">PART II</th>'
              : "";

        const tail =
          i === 0
            ? `<td rowspan="5" class="r-c r-overall">${printState.overall == null ? "" : pNum(printState.overall)}</td>

               <td rowspan="5" class="r-c r-pmes">${band ? band.numerical : ""}</td>

               <td rowspan="5" class="r-c r-pmes">${band ? pText(band.label) : ""}</td>`
            : "";

        return `<tr>${part}<td>${pText(label)}</td><td class="r-c">${weight}</td><td class="r-c">${pNum(s[key])}</td>${tail}</tr>`;
      })

      .join("");

    return `<table class="r-table r-summary">

      <colgroup><col style="width:8%"><col style="width:31%"><col style="width:13%"><col style="width:12%"><col style="width:12%"><col style="width:12%"><col style="width:12%"></colgroup>

      <thead>

        <tr><th rowspan="2" colspan="2">Final Performance Components</th><th rowspan="2">Weight Allocation</th><th rowspan="2">Obtained Score</th><th rowspan="2">Overall Score</th><th colspan="2">PMES Rating</th></tr>

        <tr><th>Numerical Rating</th><th>Adjectival Rating</th></tr>

      </thead>

      <tbody>${body}</tbody>

    </table>`;
  }

  function printPmesTable() {
    const rows = [
      ["4.500-5.000", 5, "Outstanding"],

      ["3.500-4.499", 4, "Very Satisfactory"],

      ["2.500-3.499", 3, "Satisfactory"],

      ["1.500-2.499", 2, "Unsatisfactory"],

      ["1.000-1.499", 1, "Poor"],
    ]

      .map(
        ([range, n, label]) =>
          `<tr><td class="r-c">${range}</td><td class="r-c">${n}</td><td class="r-c">${label}</td></tr>`,
      )

      .join("");

    return `<table class="r-table r-ref">

      <thead>

        <tr><th colspan="3">PMES Rating Table</th></tr>

        <tr><th>Range</th><th>Numerical Rating</th><th>Adjectival Rating</th></tr>

      </thead>

      <tbody>${rows}</tbody>

    </table>`;
  }

  // Fixed -- the superior is the Rater, i.e. the Assistant Schools Division
  // Superintendent (same as the Rater on the other pages).
  const RATER_POSITION = "Assistant Schools Division Superintendent";

  function buildPrintHtml() {
    const up = (v) => (v == null ? "" : String(v).toUpperCase());

    const employee =
      printCache.header.nameOfEmployee || printCache.preparer.name || "";

    const superior = printCache.header.nameOfRater || "";

    const box = (label, name, date, position) => `

      <div class="r-box">

        <div class="r-box-name"><span class="r-lbl">${label}</span><span class="r-val">${pText(up(name))}</span></div>

        ${position ? `<div class="r-box-pos" style="font-size:9pt;margin-top:2px;">${pText(position)}</div>` : ""}

        <div class="r-box-sig">Signature:</div>

        <div class="r-box-date">Date: ${pText(pDate(date))}</div>

      </div>`;

    return `

      <div class="r-page-label">DepEd OPCRF (ver.Feb2025), page 3 of 4</div>

      <div class="r-top">

        <div class="r-left">

          <div class="r-title">PART III: SUMMARY OF RATINGS</div>

          ${printSummary()}

        </div>

        <div class="r-right">${printPmesTable()}</div>

      </div>

      <div class="r-agree">

        <div class="r-agree-title">Ratee-Rater Agreement</div>

        <p class="r-agree-text">The signatures below confirm that the employee and his/her superior have agreed to the contents of the performance as captured in this form.</p>

        <div class="r-boxes">

          ${box("Name of Employee:", employee, printCache.dates.prepared_by)}

          ${box("Name of Superior:", superior, printCache.dates.checked_by, RATER_POSITION)}

        </div>

      </div>`;
  }

  function refreshPrintRoot() {
    if (printRoot) printRoot.innerHTML = buildPrintHtml();
  }

  async function loadPrintExtras() {
    const [p, h, d1, d2] = await Promise.allSettled([
      apiGet("/api/preparer"),

      apiGet("/api/irc8a/report-header"),

      apiGet("/api/signatory-date/irc8c/prepared_by"),

      apiGet("/api/signatory-date/irc8c/checked_by"),
    ]);

    if (p.status === "fulfilled") printCache.preparer = p.value || {};

    if (h.status === "fulfilled") printCache.header = h.value || {};

    printCache.dates = {
      prepared_by: d1.status === "fulfilled" && d1.value ? d1.value.date : null,

      checked_by: d2.status === "fulfilled" && d2.value ? d2.value.date : null,
    };
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

  // ================= Initial load =================
  // Pure read-only view: nothing is stored for IRC8C. Obtained scores
  // come from OPCRF I's and OPCRF II's own data endpoints. "Name of
  // Employee" and "Name of Superior" are filled live by index.js
  // (#reportPreparedByName / #reportRaterName) from OPCRF I > Form details
  // ("Name of employee" / "Name of rater").
  async function init() {
    try {
      const [part1, part2] = await Promise.all([
        apiGet("/irc/irc8a/data"),
        apiGet("/irc/irc8b/data"),
      ]);
      render(part1.kras || [], part2.ratings || {}, part2.sections || {});
    } catch (err) {
      showError(err.message);
    }
  }

  init();
})();
