(function () {
  const workspaceEl = document.getElementById("irc8b-workspace");
  if (!workspaceEl) return;
  const navEl = document.getElementById("irc8b-nav");
  const detailEl = document.getElementById("irc8b-detail");
  const partTabsEl = document.getElementById("irc8b-part-tabs");

  // Each part's total score is its average x 0.025 (see the form's
  // "Part II-A / II-B Total Score: Weighted Average (Average x 0.025)").
  const WEIGHT = 0.025;

  const resetBtn = document.getElementById("irc8b-reset-btn");
  const resetConfirmOverlay = document.getElementById(
    "irc8b-reset-confirm-overlay",
  );
  const resetConfirmCancelBtn = document.getElementById(
    "irc8b-reset-confirm-cancel",
  );
  const resetConfirmConfirmBtn = document.getElementById(
    "irc8b-reset-confirm-confirm",
  );

  // ================= DepEd Competencies Scale =================
  const RATING_LABELS = {
    5: "Role Model",
    4: "Consistently Demonstrated",
    3: "Most of the Time Demonstrated",
    2: "Sometimes Demonstrated",
    1: "Rarely Demonstrated",
  };

  // ================= Fixed data model (from the Part II form) =================
  const DATA = [
    {
      key: "leadership",
      title: "Part II-A: Leadership Competencies (2.5%)",
      description:
        "Leadership Competencies shall capture competencies expected of heads of functional offices who hold managerial and executive/supervisory positions. The Leadership Competencies expected to be demonstrated include Leading People, People Performance Management, and People Development.",
      subsections: [
        {
          key: "leading_people",
          title: "Leading People",
          criteria: [
            "Uses basic persuasion techniques in a discussion or presentation e.g., staff mobilization, appeals to reason and/or emotions, uses data and examples, visual aids.",
            "Persuades, convinces or influences others, in order to have a specific impact or effect.",
            '"Sets a good example", is a credible and respected leader; and demonstrates desired behavior.',
            "Forwards personal, professional and work unit needs and interests in an issue.",
            "Assumes a pivotal role in promoting the development of an inspiring, relevant vision for the organization and influences others to share ownership of DepEd goals, in order to create an effective work environment.",
          ],
        },
        {
          key: "people_performance_management",
          title: "People Performance Management",
          criteria: [
            "Makes specific changes in the performance management system or in own work methods to improve performance (e.g. does something better, faster, at lower cost, more efficiently; improves quality, customer satisfaction, morale, revenues).",
            "Sets performance standards and measures progress of employees based on office and department targets.",
            "Provides feedback and technical assistance such as coaching for performance improvement and action planning.",
            "States performance expectations clearly and checks understanding and commitment.",
            "Performs all the stages of result-based performance management system supported by evidence and required documents/forms.",
          ],
        },
        {
          key: "people_development",
          title: "People Development",
          criteria: [
            "Improves the skills and effectiveness of individuals through employing a range of development strategies.",
            "Facilitates workforce effectiveness through coaching and motivating/developing people within a work environment that promotes mutual trust and respect.",
            "Conceptualizes and implements learning interventions to meet identified training needs.",
            "Does long-term coaching or training by arranging appropriate and helpful assignments, formal training, or other experiences for the purpose of supporting a person's learning and development.",
            "Cultivates a learning environment by structuring interactive experiences such as looking for future opportunities that are in support of achieving individual career goals.",
          ],
        },
      ],
    },
    {
      key: "cbc",
      title: "Part II-B: Core Behavioural Competencies (2.5%)",
      description:
        "Core Behavioral Competencies shall capture competencies required from all DepEd personnel in all job groups within the organization, upholding the DepEd’s core values and the Code of Conduct and Ethical Standards for Public Officials and Employees pursuant to RA 6713. They represent the way individuals embody and live the values of the organization.",
      subsections: [
        {
          key: "self_management",
          title: "Self-Management",
          criteria: [
            "Sets personal goals and direction, needs and development.",
            "Understands personal actions and behavior that are clear and purposive and takes into account personal goals and values congruent to that of the organization.",
            "Displays emotional maturity and enthusiasm for and is challenged by higher goals.",
            "Prioritize work tasks and schedules (through Gantt charts, checklists, etc.) to achieve goals.",
            "Sets high quality, challenging, realistic goals for self and others.",
          ],
        },
        {
          key: "professionalism_ethics",
          title: "Professionalism and Ethics",
          criteria: [
            "Demonstrate the values and behavior enshrined in the Norms of Conduct and Ethical Standards for Public Officials and Employees (RA 6713).",
            "Practice ethical and professional behavior and conduct taking into account the impact of his/her actions and decisions.",
            "Maintains a professional image: being trustworthy, regularity of attendance and punctuality, good grooming and communication.",
            "Makes personal sacrifices to meet the organization's needs.",
            "Act with a sense of urgency and responsibility to meet the organization's needs, improve system and help others improve their effectiveness.",
          ],
        },
        {
          key: "results_focus",
          title: "Results Focus",
          criteria: [
            "Achieves results with optimal use of time and resources most of the time.",
            "Avoids rework, mistakes and wastage through effective work methods by placing organizational needs before personal needs.",
            "Delivers error-free outputs most of the time by conforming to standard operating procedures correctly and consistently. Able to produce very satisfactory quality of work in terms of usefulness/acceptability and completeness with no supervision required.",
            "Expresses a desire to do better and may express frustration at waste or inefficiency. May focus on new or more precise ways of meeting goals set.",
            "Makes specific changes in the system or in own work methods to improve performance. Examples may include doing something better, faster, at a lower cost, more efficiently, or improving quality, customer satisfaction, morale, without setting any specific goal.",
          ],
        },
        {
          key: "teamwork",
          title: "Teamwork",
          criteria: [
            "Willingly does his/her share of responsibility.",
            "Promotes collaboration and removes barriers to teamwork and goal accomplishment across the organization.",
            "Applies negotiation principles in arriving at win-win agreements.",
            "Drives consensus and team ownership of decisions.",
            "Works constructively and collaboratively with others and across organizations to accomplish organizational goals and objectives.",
          ],
        },
        {
          key: "service_orientation",
          title: "Service Orientation",
          criteria: [
            "Can explain and articulate organizational directions, issues and problems.",
            "Takes personal responsibility for dealing with and/or correcting customer service issues and concerns.",
            "Initiates activities that promotes advocacy for men and women empowerment.",
            "Participates in updating office vision, mission, mandates and strategies based on DepEd strategies and directions.",
            "Develops and adopts service improvement program through simplified procedures that will further enhance service delivery.",
          ],
        },
        {
          key: "innovation",
          title: "Innovation",
          criteria: [
            "Examines the root cause of problems and suggests effective solutions. Foster new ideas, processes, and suggests better ways to do things (cost and/or operational efficiency).",
            'Demonstrates an ability to think "beyond the box". Continuously focuses on improving personal productivity to create higher value and results.',
            "Promotes a creative climate and inspires co-workers to develop original ideas or solutions.",
            "Translates creative thinking into tangible changes and solutions that improve the work unit and organization.",
            "Uses ingenious methods to accomplish responsibilities. Demonstrates resourcefulness and the ability to succeed with minimal resources.",
          ],
        },
      ],
    },
  ];

  // ================= State =================
  // ratings[subsectionKey] = [r1..r5]   (each null or 1-5)
  const ratings = {};
  const SUBSECTION_TO_SECTION = {};
  DATA.forEach((section) => {
    section.subsections.forEach((sub) => {
      ratings[sub.key] = sub.criteria.map(() => null);
      SUBSECTION_TO_SECTION[sub.key] = section.key;
    });
  });

  const YEAR = new Date().getFullYear();

  // View state: which part (II-A / II-B) and which competency is open.
  let activePart = "leadership";
  const sel = { subKey: null };
  const PART_SHORT = {
    leadership: { label: "Part II-A", name: "Leadership Competencies" },
    cbc: { label: "Part II-B", name: "Core Behavioural Competencies" },
  };

  // ================= Server sync =================
  // Only the numbers the user enters are persisted; the
  // sections/subsections/indicators above stay hardcoded.
  async function loadRatings() {
    try {
      const res = await fetch(`/irc/irc8b/data?year=${YEAR}`);
      if (!res.ok) throw new Error("Failed to load ratings");
      const data = await res.json();
      const serverRatings = data.ratings || {};

      Object.keys(serverRatings).forEach((subKey) => {
        if (!ratings[subKey]) return; // unknown subsection key -- ignore
        Object.entries(serverRatings[subKey]).forEach(([idxStr, value]) => {
          const idx = Number(idxStr);
          if (idx >= 0 && idx < ratings[subKey].length) {
            ratings[subKey][idx] = value;
          }
        });
      });
    } catch (err) {
      console.error("Failed to load IRC8B data:", err);
    }
    render();
  }

  // `fields` is { rating } -- the server only touches the fields present
  // in the body.
  async function saveEntry(subKey, idx, fields) {
    try {
      const res = await fetch("/irc/irc8b/rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: YEAR,
          sectionKey: SUBSECTION_TO_SECTION[subKey],
          subsectionKey: subKey,
          criterionIndex: idx,
          ...fields,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
    } catch (err) {
      console.error("Failed to save IRC8B entry:", err);
    }
  }

  // ================= Reset-page confirmation modal =================
  // No bulk-clear endpoint: reset fires one best-effort clear request per
  // indicator that currently has a rating.
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
      const clears = [];
      Object.keys(ratings).forEach((subKey) => {
        ratings[subKey].forEach((value, idx) => {
          if (value !== null) {
            clears.push(saveEntry(subKey, idx, { rating: null }));
          }
          ratings[subKey][idx] = null;
        });
      });
      await Promise.all(clears);
    } finally {
      render();
      resetConfirmConfirmBtn.disabled = false;
      closeResetConfirm();
    }
  });

  // ================= Helpers =================
  function fmtNum(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  // Weighted scores are small (avg x 0.025), so keep 4 decimals.
  function fmtWeighted(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return n.toFixed(4);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, "&quot;");
  }

  function average(values) {
    const rated = values.filter((v) => v !== null && v !== undefined);
    if (rated.length === 0) return null;
    return rated.reduce((sum, v) => sum + v, 0) / rated.length;
  }

  // Closest 1-5 adjectival rating for a numeric average, e.g. 4.3 ->
  // "Consistently Demonstrated". Empty when nothing is rated.
  function ratingDescription(avg) {
    if (avg === null || avg === undefined || isNaN(avg)) return "";
    const rounded = Math.min(5, Math.max(1, Math.round(avg)));
    return RATING_LABELS[rounded];
  }

  function subsectionAverage(subKey) {
    return average(ratings[subKey]);
  }

  function sectionAverage(section) {
    const subAvgs = section.subsections
      .map((sub) => subsectionAverage(sub.key))
      .filter((v) => v !== null);
    return average(subAvgs);
  }

  function weightedScore(avg) {
    return avg === null ? null : avg * WEIGHT;
  }

  // ================= Icons / progress ring =================
  // Ring on each competency in the sidebar: arc = rated / total indicators.
  const RING_R = 8;
  const RING_C = 2 * Math.PI * RING_R;
  function progressRing(done, total) {
    const track = `<circle class="irc8b-ring-track" cx="12" cy="12" r="${RING_R}"></circle>`;
    if (total > 0 && done === total) {
      return `<svg class="irc8b-ring" viewBox="0 0 24 24" aria-hidden="true"><circle class="irc8b-ring-fill" cx="12" cy="12" r="10.5"></circle><path class="irc8b-ring-check" d="M7.8 12.4l3 3 5.4-6"></path></svg>`;
    }
    const frac = total ? done / total : 0;
    const arc =
      done > 0
        ? `<circle class="irc8b-ring-arc" cx="12" cy="12" r="${RING_R}" stroke-dasharray="${(RING_C * frac).toFixed(2)} ${RING_C.toFixed(2)}" transform="rotate(-90 12 12)"></circle>`
        : "";
    return `<svg class="irc8b-ring" viewBox="0 0 24 24" aria-hidden="true">${track}${arc}</svg>`;
  }

  function subProgress(subKey) {
    const list = ratings[subKey];
    const done = list.filter((v) => v !== null).length;
    return {
      done,
      total: list.length,
      state: done === 0 ? "none" : done === list.length ? "done" : "partial",
    };
  }
  const PROGRESS_LABELS = {
    none: "Not started",
    partial: "In progress",
    done: "Complete",
  };

  function currentSection() {
    return DATA.find((s) => s.key === activePart);
  }

  function ensureSelection() {
    const section = currentSection();
    if (section.subsections.some((sub) => sub.key === sel.subKey)) return;
    sel.subKey = section.subsections[0].key;
  }

  // ================= Render: part tabs =================
  function renderPartTabs() {
    let totalWeighted = null;
    const cards = DATA.map((section) => {
      const meta = PART_SHORT[section.key];
      const avg = sectionAverage(section);
      const w = weightedScore(avg);
      if (w !== null) totalWeighted = (totalWeighted || 0) + w;
      const active = section.key === activePart;
      return `
        <button type="button" class="irc8b-part-tab${active ? " is-active" : ""}" data-part="${section.key}" role="tab" aria-selected="${active}">
          <span class="irc8b-part-tab-label">${meta.label}</span>
          <span class="irc8b-part-tab-name">${escapeHtml(meta.name)}</span>
          <span class="irc8b-part-tab-stats">
            <span class="irc8b-part-tab-stat" title="Average of the rated competencies">
              <span class="irc8b-part-tab-k">Average</span>
              <span class="irc8b-part-tab-v${avg === null ? " is-empty" : ""}">${fmtNum(avg)}</span>
            </span>
            <span class="irc8b-part-tab-stat" title="Average x ${WEIGHT}">
              <span class="irc8b-part-tab-k">Weighted</span>
              <span class="irc8b-part-tab-v${w === null ? " is-empty" : ""}">${fmtWeighted(w)}</span>
            </span>
          </span>
          <span class="irc8b-part-tab-desc">${escapeHtml(ratingDescription(avg))}</span>
        </button>`;
    }).join("");

    // Total card (not clickable): sum of the parts that have been rated.
    const avgs = DATA.map((s) => sectionAverage(s)).filter((v) => v !== null);
    const overallAvg = average(avgs);
    const total = `
      <div class="irc8b-part-total" role="status">
        <span class="irc8b-part-tab-label">Overall</span>
        <span class="irc8b-part-tab-name">Total Weighted Score</span>
        <span class="irc8b-part-tab-stats">
          <span class="irc8b-part-tab-stat">
            <span class="irc8b-part-tab-k">Score</span>
            <span class="irc8b-part-tab-v${totalWeighted === null ? " is-empty" : ""}">${fmtWeighted(totalWeighted)}</span>
          </span>
          <span class="irc8b-part-tab-stat">
            <span class="irc8b-part-tab-k">Avg</span>
            <span class="irc8b-part-tab-v${overallAvg === null ? " is-empty" : ""}">${fmtNum(overallAvg)}</span>
          </span>
        </span>
        <span class="irc8b-part-tab-desc">${escapeHtml(ratingDescription(overallAvg))}</span>
      </div>`;
    partTabsEl.innerHTML = cards + total;
  }

  // ================= Render: sidebar =================
  function renderNav() {
    const section = currentSection();
    const meta = PART_SHORT[section.key];
    const secAvg = sectionAverage(section);

    const items = section.subsections
      .map((sub) => {
        const prog = subProgress(sub.key);
        const isSel = sub.key === sel.subKey;
        const tip = `${PROGRESS_LABELS[prog.state]} (${prog.done}/${prog.total} rated)`;
        return `
          <button type="button" class="irc8b-nav-item${isSel ? " is-selected" : ""}" data-action="select-sub" data-sub="${sub.key}" title="${escapeAttr(sub.title)}"${isSel ? ' aria-current="true"' : ""}>
            <span class="irc8b-nav-main">
              <span class="irc8b-nav-progress" title="${escapeAttr(tip)}" role="img" aria-label="${escapeAttr(tip)}">${progressRing(prog.done, prog.total)}</span>
              <span class="irc8b-nav-code">${escapeHtml(sub.title)}</span>
            </span>
            <span class="irc8b-nav-avg" title="Competency average">${fmtNum(subsectionAverage(sub.key))}</span>
          </button>`;
      })
      .join("");

    navEl.innerHTML = `
      <div class="irc8b-nav-group">
        <div class="irc8b-nav-group-head">
          <span class="irc8b-nav-group-label">${meta.label}</span>
          <div class="irc8b-nav-group-row">
            <span class="irc8b-nav-group-title">${escapeHtml(meta.name)}</span>
            <span class="irc8b-nav-group-weight" title="Part average">${fmtNum(secAvg)}</span>
          </div>
        </div>
        ${items}
      </div>`;
  }

  // ================= Render: detail panel =================
  function renderDetail() {
    const section = currentSection();
    const meta = PART_SHORT[section.key];
    const subs = section.subsections;
    const idx = subs.findIndex((sub) => sub.key === sel.subKey);
    const sub = subs[idx];
    const secAvg = sectionAverage(section);

    const rowsHtml = sub.criteria
      .map((text, i) => renderCriterionRow(sub.key, i, text))
      .join("");
    const prev = subs[idx - 1];
    const next = subs[idx + 1];

    detailEl.innerHTML = `
      <div class="irc8b-intro">
        <div class="irc8b-intro-head">
          <div>
            <span class="irc8b-label">${meta.label}</span>
            <h3>${escapeHtml(meta.name)} (2.5%)</h3>
          </div>
          <span class="irc8b-intro-weighted" title="${escapeAttr(meta.label)} Total Score: Weighted Average (Average x ${WEIGHT})">
            <span class="irc8b-label">Total score</span>
            <strong>${fmtWeighted(weightedScore(secAvg))}</strong>
          </span>
        </div>
        <p class="irc8b-intro-desc">${escapeHtml(section.description)}</p>
      </div>

      <section class="irc8b-subsection-card">
        <div class="irc8b-subsection-header">
          <div>
            <span class="irc8b-label">Competency ${idx + 1} of ${subs.length}</span>
            <h3>${escapeHtml(sub.title)}</h3>
          </div>
          <span class="irc8b-subsection-avg" title="Competency average">${fmtNum(subsectionAverage(sub.key))}</span>
        </div>
        <div class="irc8b-criteria-list">${rowsHtml}</div>
        <div class="irc8b-pager">
          <button type="button" class="irc8b-pager-btn" data-action="select-sub" data-sub="${prev ? prev.key : ""}"${prev ? "" : " disabled"}>&larr; ${prev ? escapeHtml(prev.title) : "Previous"}</button>
          <button type="button" class="irc8b-pager-btn" data-action="select-sub" data-sub="${next ? next.key : ""}"${next ? "" : " disabled"}>${next ? escapeHtml(next.title) : "Next"} &rarr;</button>
        </div>
      </section>`;
  }

  // Short labels shown inside the rating buttons; the full adjectival rating
  // is in each button's tooltip.
  const SHORT_LABELS = {
    5: "Role model",
    4: "Consistent",
    3: "Most times",
    2: "Sometimes",
    1: "Rarely",
  };

  function renderCriterionRow(subKey, index, text) {
    const current = ratings[subKey][index];
    const buttons = [5, 4, 3, 2, 1]
      .map((r) => {
        const selected = current === r ? " is-selected" : "";
        return `<button type="button" class="irc8b-rate-btn irc8b-rate-btn--r${r}${selected}" data-sub="${subKey}" data-idx="${index}" data-rate="${r}" title="${r} — ${RATING_LABELS[r]}" aria-pressed="${current === r}"><b>${r}</b><small>${SHORT_LABELS[r]}</small></button>`;
      })
      .join("");

    return `
      <div class="irc8b-criterion-row">
        <span class="irc8b-criterion-num">${index + 1}</span>
        <div class="irc8b-criterion-body">
          <span class="irc8b-criterion-text">${escapeHtml(text)}</span>
        </div>
        <div class="irc8b-rate-seg" role="group" aria-label="Rating for indicator ${index + 1}">${buttons}</div>
      </div>
    `;
  }

  // ================= Render: all =================
  function render() {
    ensureSelection();
    renderPartTabs();
    renderNav();
    renderDetail();
  }

  // ================= Events =================
  partTabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-part]");
    if (!btn || btn.dataset.part === activePart) return;
    activePart = btn.dataset.part;
    sel.subKey = null; // falls back to the first competency of that part
    render();
  });

  function handleSelectSub(e) {
    const btn = e.target.closest('[data-action="select-sub"]');
    if (!btn || btn.disabled || !btn.dataset.sub) return;
    sel.subKey = btn.dataset.sub;
    render();
    if (btn.closest("#irc8b-detail")) {
      workspaceEl.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }
  navEl.addEventListener("click", handleSelectSub);

  function handleRateClick(e) {
    const btn = e.target.closest(".irc8b-rate-btn");
    if (!btn) return;

    const subKey = btn.dataset.sub;
    const idx = parseInt(btn.dataset.idx, 10);
    const rate = parseInt(btn.dataset.rate, 10);

    // Clicking the already-selected rating clears it; otherwise sets it.
    const newValue = ratings[subKey][idx] === rate ? null : rate;
    ratings[subKey][idx] = newValue;

    render();
    saveEntry(subKey, idx, { rating: newValue });
  }

  detailEl.addEventListener("click", (e) => {
    handleRateClick(e);
    handleSelectSub(e);
  });

  // ================= Print / Save as PDF =================
  // Builds a print-only copy of Part II (scale, II-A, II-B, signatories) laid
  // out like the OPCRF sheet's page 2, then calls window.print(). Styling is
  // in irc8b_print.css (long bond, landscape). The root is moved to <body>
  // so the print stylesheet can hide the rest of the page.
  const printRoot = document.getElementById("irc8b-print-root");
  const printBtn = document.getElementById("irc8b-print-btn");
  const printCache = { header: {}, authority: { name: "" } };
  if (printRoot) document.body.appendChild(printRoot);

  const SCALE_DEFS = {
    5: "Behavioral indicator is consistently exhibited and is worthy of emulation.",
    4: "Behavioral indicator is constantly shown.",
    3: "Behavioral indicator is often shown.",
    2: "Behavioral indicator is irregularly shown.",
    1: "Behavioral indicator is seldom shown.",
  };

  const pText = (v) => escapeHtml(v == null ? "" : String(v));
  const pNum = (n, digits) =>
    n === null || n === undefined || isNaN(n) ? "" : n.toFixed(digits);

  function printScale() {
    const rows = [5, 4, 3, 2, 1]
      .map(
        (n) =>
          `<tr><td class="q-c">${n}</td><td>${pText(RATING_LABELS[n])}</td><td>${pText(SCALE_DEFS[n])}</td></tr>`,
      )
      .join("");
    return `<div class="q-scale">
      <div class="q-scale-title">DepEd Competencies Scale</div>
      <table class="q-table q-scale-table">
        <colgroup><col style="width:17%"><col style="width:33%"><col style="width:50%"></colgroup>
        <thead><tr><th>Numerical Rating</th><th>Adjectival Rating</th><th>Definition</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  function printSection(section) {
    const partLabel = section.title.split(":")[0]; // "Part II-A"
    const secAvg = sectionAverage(section);
    const bodies = section.subsections
      .map((sub) => {
        const n = sub.criteria.length;
        const subAvg = subsectionAverage(sub.key);
        const rows = sub.criteria
          .map((text, i) => {
            const r = ratings[sub.key][i];
            const first =
              i === 0
                ? `<td rowspan="${n}" class="q-comp">${pText(sub.title)}</td>`
                : "";
            const avg =
              i === 0
                ? `<td rowspan="${n}" class="q-c q-avg">${pNum(subAvg, 2)}</td>`
                : "";
            return `<tr>${first}<td>${i + 1}. ${pText(text)}</td><td class="q-c">${r == null ? "" : pText(RATING_LABELS[r])}</td><td class="q-c">${r == null ? "" : r}</td>${avg}</tr>`;
          })
          .join("");
        return `<tbody class="qb-comp">${rows}</tbody>`;
      })
      .join("");
    const total = `<tbody class="qb-total"><tr><td colspan="4" class="q-total-label">${pText(partLabel)} Total Score: Weighted Average (Average x ${WEIGHT})</td><td class="q-c q-total-val">${pNum(weightedScore(secAvg), 4)}</td></tr></tbody>`;
    return `<div class="q-part">
      <h3>${pText(section.title.toUpperCase())}</h3>
      <p class="q-intro">${pText(partLabel)}. ${pText(section.description)}</p>
      <table class="q-table q-main">
        <colgroup><col style="width:9%"><col style="width:61%"><col style="width:13%"><col style="width:7%"><col style="width:10%"></colgroup>
        <thead><tr><th>Competencies</th><th>Behavioural Indicators</th><th>Remarks/ Observations</th><th>RATING</th><th>AVERAGE</th></tr></thead>
        ${bodies}${total}
      </table>
    </div>`;
  }

  function buildPrintHtml() {
    const h = printCache.header || {};
    const a = printCache.authority || {};
    const up = (v) => (v == null ? "" : String(v).toUpperCase());
    const sign = (name, role) =>
      `<div class="q-sign"><div class="q-sign-name">${pText(up(name))}</div><div class="q-sign-role">${role}</div></div>`;
    return `
      <div class="q-top">
        <div class="q-page-label">DepEd OPCRF (ver.Feb2025), page 2 of 4</div>
        ${printScale()}
      </div>
      ${DATA.map(printSection).join("")}
      <div class="q-signs">
        <div class="q-signs-row">${sign(h.nameOfEmployee, "RATEE")}${sign(h.nameOfRater, "RATER")}</div>
        <div class="q-signs-row">${sign(a.name, "APPROVING AUTHORITY")}</div>
      </div>`;
  }

  function refreshPrintRoot() {
    if (printRoot) printRoot.innerHTML = buildPrintHtml();
  }

  // Ratee / Rater / Approving Authority names are the ones kept on EOPCRF I.
  async function loadPrintExtras() {
    const get = async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error("request failed");
      return res.json();
    };
    const [h, a] = await Promise.allSettled([
      get("/api/irc8a/report-header"),
      get("/api/irc8a/approving-authority"),
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

  // ================= Initial load =================
  loadRatings();
})();
