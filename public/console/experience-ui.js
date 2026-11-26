/* Chart-first workspaces with compact configuration status and the KPI scorecard. */
"use strict";
// KPI scorecard: measured values from the KPI module, asked through the Community API, which
// checks who may see which community or house (GET /api/recs/{rec}/kpi-scorecard).
// The period is the last N whole UTC days; the change is against the BAU (the simulated
// scenario without a controller), only on the houses and hours that simulation covers.
const kpiScorecards = new Map();
const KPI_SCORECARD_TTL = 10 * 60 * 1000;
// While the KPI module completes missing days in the background, ask again this often
const KPI_SCORECARD_BACKFILL_RETRY = 30 * 1000;
// Answers that mean the Community API does not offer the scorecard (yet), not a failure
const KPI_SCORECARD_ABSENT = [403, 404, 405, 501];
const KPI_CARDS = [
  ["EnergyCostKPI", "Energy cost", "lower", "Cost of the energy bought, with the community's sharing rules."],
  ["SelfSufficiencyRateKPI", "Self-sufficiency", "higher", "Share of the consumption covered without the grid."],
  ["SolarSelfConsumptionRateKPI", "Solar self-consumption", "higher", "Share of the solar energy generated that was used locally."],
  ["PeakDemandKPI", "Peak demand", "lower", "Highest power imported from the grid in a quarter-hour."],
];
const KPI_GROUPS = [
  ["EV service", [
    ["ChargingSuccessRateKPI", "Minimum service met", "Departures that reached the requested state of charge."],
    ["ChargingOptimizationRateKPI", "Within target tolerance", "Departures within ±5% of the requested state of charge."]]],
  ["Energy", [
    ["SolarGenerationKPI", "Solar generation", "Solar energy generated during the period."],
    ["AverageHourlyImportedEnergyKPI", "Grid import", "Energy imported from the grid during the period."],
    ["AverageHourlyExportedEnergyKPI", "Grid export", "Energy exported to the grid during the period."],
    ["SelfConsumptionKPI", "Net grid exchange", "Imports minus exports during the period."]]],
  ["Grid & storage", [
    ["DailyLoadFactorKPI", "Load factor", "How flat the daily grid profile is: average over peak (1 is flat)."],
    ["BatteryThroughputKPI", "Battery throughput", "Energy charged plus discharged by the batteries."]]],
  ["Fairness", [
    ["NoHarmIndicatorKPI", "Members worse off", "Share of members paying more inside the community than on their own. 0% is best."],
    ["GiniBenefitsKPI", "Benefit inequality", "Gini index of the members' benefits: 0 is equal, 1 is all to one member."],
    ["BenefitParityRatioKPI", "Benefit parity", "Benefit of members without equipment relative to members with it. 1 is parity."],
    ["BenefitConcentrationCR20KPI", "Top-20% benefit share", "Share of the benefits that goes to the 20% who gain most."]]],
];
const KPI_DECIMALS = { "€": 2, "%": 1, kW: 1, kWh: 1 };

function kpiScorecardKey(recId, siteId, days) { return [recId, siteId || "", days].join("|"); }

function kpiScorecardVisible(key) {
  return [...document.querySelectorAll("[data-kpi-scorecard]")].some((n) => n.dataset.kpiScorecard === key);
}

function kpiScorecard(recId, siteId, days) {
  const key = kpiScorecardKey(recId, siteId, days), entry = kpiScorecards.get(key);
  const ttl = entry?.data?.backfill?.pending_days ? KPI_SCORECARD_BACKFILL_RETRY : KPI_SCORECARD_TTL;
  if (entry && (entry.status === "loading" || Date.now() - entry.at < ttl)) return entry;
  // Keep showing the previous values while the new ones load
  const loading = { status: "loading", at: Date.now(), data: entry?.data };
  kpiScorecards.set(key, loading);
  const query = `?days=${days}${siteId ? "&site_id=" + encodeURIComponent(siteId) : ""}`;
  B.request("community", `/api/recs/${encodeURIComponent(recId)}/kpi-scorecard${query}`)
    .then((data) => {
      kpiScorecards.set(key, { status: "ready", data, at: Date.now() });
      // Missing days are being computed: look again shortly, if the scorecard is still on screen
      if (data?.backfill?.pending_days) setTimeout(() => { if (kpiScorecardVisible(key)) render(); }, KPI_SCORECARD_BACKFILL_RETRY);
    })
    .catch((error) => kpiScorecards.set(key, {
      status: KPI_SCORECARD_ABSENT.includes(error?.status) ? "absent" : "error", error, at: Date.now() }))
    // Only redraw when this scorecard is still on screen
    .finally(() => { if (kpiScorecardVisible(key)) render(); });
  return loading;
}

function kpiValue(value, unit) {
  if (value == null) return "—";
  return `${num(value, KPI_DECIMALS[unit] ?? 2)} <small>${esc(unit || "")}</small>`;
}

function kpiTrend(kpi, direction) {
  const bau = kpi?.bau;
  if (!bau || bau.delta_pct == null) return `<span class="kpi-trend is-neutral">No BAU comparison yet</span>`;
  const d = bau.delta_pct, still = Math.abs(d) < 0.05;
  const better = direction === "lower" ? d < 0 : d > 0;
  const tone = still ? "neutral" : better ? "improved" : "worse";
  const meaning = still ? "Same as the BAU" : better ? "Better than the BAU" : "Worse than the BAU";
  return `<span class="kpi-trend is-${tone}" title="${meaning}: the real value against the simulated scenario without a controller, on the houses and hours it covers"><span aria-hidden="true">${still ? "→" : d < 0 ? "↓" : "↑"}</span> ${num(Math.abs(d), 1)}% vs BAU<span class="chart-sr-only"> · ${meaning}</span></span>`;
}

function kpiPeriod(card) {
  const fmt = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const last = new Date(Date.parse(card.period.end) - 1).toISOString();
  const cov = card.coverage, bau = card.bau, site = card.scope !== "community";
  const parts = [`${fmt(card.period.start)} – ${fmt(last)} (UTC)`];
  if (!site) parts.push(`${cov.houses_reporting} of ${cov.houses_total} houses reporting`);
  if (cov.hours_with_data < cov.hours_expected) parts.push(`data for ${cov.hours_with_data} of ${cov.hours_expected} hours`);
  parts.push(!bau ? "no BAU comparison yet"
    : site ? `BAU for ${bau.days_with_bau} of ${bau.days_expected} days`
      : `BAU on ${bau.houses_simulated} houses, ${bau.days_with_bau} of ${bau.days_expected} days`);
  return parts.join(" · ");
}

function kpiSupporting(kpis) {
  const groups = KPI_GROUPS.map(([name, items]) => [name, items.filter(([key]) => kpis[key]?.value != null)])
    .filter(([, items]) => items.length);
  if (!groups.length) return "";
  return `<div class="supporting-indicators">${groups.map(([name, items]) => `<section><h3>${name}</h3><dl>${items.map(([key, label, help]) => {
    const k = kpis[key], sessions = k.sessions ? ` · ${k.sessions} departures` : "";
    return `<div title="${esc(help + sessions)}"><dt>${label}</dt><dd>${kpiValue(k.value, k.unit)}</dd></div>`;
  }).join("")}</dl></section>`).join("")}</div>`;
}

function energyIndicators(scope = "community", compact = false, site = null) {
  const days = state.kpiDays || 7, recId = comm()?.recId, siteId = scope === "site" ? (site?.backendId || site?.id) : null;
  const key = kpiScorecardKey(recId, siteId, days);
  const head = (subtitle) => `<div class="sectionhead"><div><div class="kpi-section-title"><h2>Scorecard</h2></div><p class="subtitle">${subtitle}</p></div><div class="pilltabs" aria-label="KPI period">${[7, 30].map((n) => `<button data-kpi-days="${n}" aria-pressed="${n === days}" class="${n === days ? "active" : ""}">Last ${n} days</button>`).join("")}</div></div>`;
  const shell = (status, body) => `<section class="energy-indicators" data-values="${status}" data-kpi-scorecard="${esc(key)}" aria-label="${scope === "site" ? "Site" : "Community"} energy indicators">${body}</section>`;
  if (!recId) return shell("absent", head("Measured KPIs") + `<p class="muted">KPIs are calculated for communities registered in the platform.</p>`);
  const entry = kpiScorecard(recId, siteId, days);
  if (entry.status === "loading" && !entry.data) return shell("loading", head(`Last ${days} days`) + `<p class="muted" role="status">Loading the KPIs…</p>`);
  if (entry.status === "absent") return shell("absent", head(`Last ${days} days`) + `<p class="muted">KPIs are not available for this ${scope === "site" ? "house" : "community"} yet.</p>`);
  if (entry.status === "error") return shell("error", head(`Last ${days} days`) + `<p class="muted" role="alert">The KPIs could not be loaded. <button class="btn text" data-kpi-retry="${esc(key)}">Try again</button></p>`);

  const card = entry.data, kpis = card.kpis || {}, pending = card.backfill?.pending_days || 0;
  // Values of a period still being completed would look final while they are not: show none until it is
  if (pending) return shell("computing", head(`Last ${days} days`) + `<p class="muted" role="status">Calculating the KPIs for this period… ${pending} of ${days} day${days === 1 ? "" : "s"} still to calculate.</p>`);
  const updated = card.coverage?.updated_at ? ` · updated ${new Date(card.coverage.updated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC` : "";
  const cards = KPI_CARDS.map(([keyName, label, direction, help]) => {
    const k = kpis[keyName], bau = k?.bau;
    const reference = bau && bau.bau != null && bau.real != null
      ? `<small class="kpi-reference" title="Only the houses and hours the BAU simulates">On the simulated houses: ${num(bau.real, KPI_DECIMALS[k.unit] ?? 2)} vs BAU ${num(bau.bau, KPI_DECIMALS[k.unit] ?? 2)} ${esc(k.unit || "")}</small>` : "";
    return `<div title="${esc(help)}"><span>${label}</span><strong>${kpiValue(k?.value, k?.unit)}</strong>${kpiTrend(k, direction)}${reference}</div>`;
  }).join("");
  const supporting = kpiSupporting(kpis);
  const body = head(kpiPeriod(card) + updated) + `<div class="energy-indicator-row">${cards}</div>` +
    (supporting ? (compact ? `<details class="personal-scorecard-details"><summary>More indicators</summary>${supporting}</details>` : supporting) : "");
  return shell("measured", body);
}
function identityIcon(label, action, symbol='edit') {
 return `<button type="button" class="identity-icon" data-action="${action}" aria-label="${label}" title="${label}">${icon(symbol)}</button>`;
}
function isDeploymentView() {
  return state.page==='sites'&&state.site&&state.tab==='deployment'&&!state.equipment;
}
function configurationNotice(review, label, actionHtml = '', issuesHtml = '') {
  const complete = review.tone === 'complete';
  const status = complete?'Inventory details complete':'Inventory details missing';
  const liveHint = person().role === 'manager'
    ? 'See Deployment for live readings and service status.'
    : 'See the house overview for live readings.';
  return `<details class="configuration-notice is-${review.tone}"><summary aria-label="${esc(label)} · ${status}" title="${status}">${icon(complete?'check':'alert')}</summary><div class="configuration-popover"><h3>${status}</h3>${issuesHtml || (review.missing.length?`<ul>${review.missing.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`:'')}<small>${liveHint}</small>${actionHtml}</div></details>`;
}
function communityNotice() {
  const reviews = scoped().map(s=>({s,r:siteConfiguration(s)}));
  const missing = reviews.filter(({r})=>r.missing.length);
  return configurationNotice({tone:!reviews.length?'empty':missing.length?'partial':'complete',missing:!reviews.length?['No sites registered']:missing.map(({s,r})=>`${s.name} · ${r.missing.length} configuration items to review`)}, comm().name, `<button class="btn text" data-page="sites">Review inventory ${icon('arrow')}</button>`, missing.map(({s})=>`<section class="notice-site"><button data-review-site="${esc(s.id)}"><strong>${esc(s.name)}</strong>${icon('right')}</button>${s.assets.filter(a=>equipmentConfiguration(a).missing.length).map(a=>`<button data-review-site="${esc(s.id)}" data-review-equipment="${esc(a.id)}"><span>${esc(a.name)}<small>${equipmentConfiguration(a).missing.length} details to review</small></span>${icon('right')}</button>`).join('')}</section>`).join(''));
}
overview = function () {
  return `<header class="community-identity"><div class="community-emblem">${productArt("community")}</div><div><h1>${esc(comm().name)}</h1><p>${esc(comm().place || "")}</p></div><div class="identity-actions">${communityNotice()}${identityIcon('Edit community','edit-community-details')}</div></header><div class="energy-overview">${communityMeasurementViews()}${energyIndicators()}</div>`;
};
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-kpi-days]");
  if (b) {
    state.kpiDays = Number(b.dataset.kpiDays);
    render();
  }
  const retry = e.target.closest("[data-kpi-retry]");
  if (retry) {
    kpiScorecards.delete(retry.dataset.kpiRetry);
    render();
  }
});
healthSection = function () {
  const list = scoped(),
    incomplete = list.filter((s) => siteConfiguration(s).tone !== "complete");
  return `<section class="health-quiet"><div class="health-quiet-symbol">${icon(incomplete.length ? "alert" : "check")}</div><div><h2>${incomplete.length ? "Some setup needs attention" : "Community configuration complete"}</h2><p>${incomplete.length ? incomplete.length + " of " + list.length + " sites have missing equipment or channel details." : "Equipment and channel details are filled in. Live data is checked separately."}</p></div><button class="btn text" data-page="sites">Review inventory ${icon("arrow")}</button></section>`;
};
const experienceSite = siteDetailOriginal;
siteDetailOriginal = function () {
  let html = experienceSite();
  if (state.tab === "summary") {
    const end = html.indexOf("</nav>") + 6;
    html =
      html.slice(0, end) +
      `<div class="energy-overview site-energy">${siteGraph(chosen())}${energyIndicators("site", false, chosen())}<div class="site-services-links"><button data-tab="percepta">${icon("network")}<span><strong>Data collection</strong><small>Percepta and connected sources</small></span>${icon("right")}</button><button data-tab="algorithm">${icon("cpu")}<span><strong>Energy control</strong><small>Algorithm and execution state</small></span>${icon("right")}</button></div></div></div></div>`;
  }
  const site = chosen();
  const inventoryNotice = isDeploymentView() ? '' : configurationNotice(siteConfiguration(site), site.name, '<button class="btn text" data-tab="assets">Review equipment</button>');
  html = html.replace(button('Edit site','edit-site','edit'), `<div class="identity-actions">${person().role==='manager' && !isDeploymentView() ? `<span data-house-attention="${esc(site.id)}"></span>` : ''}${inventoryNotice}${identityIcon('Edit site','edit-site')}</div>`);
  html = html.replace('<div class="sitehead"><div><h1>', `<div class="sitehead"><div class="site-identity"><span class="site-product-art">${productArt(siteIllustration(site.sourcePayload?.subtype||site.type))}</span><div><h1>`).replace('</p></div><div class="identity-actions">','</p></div></div><div class="identity-actions">');
  if (state.tab === 'settings') html = html.replace('<h2>Site configuration</h2>', '<div class="sectionhead"><h2>Site configuration</h2>'+button('Edit site','edit-site','edit')+'</div>');

  return html;
};
const experiencePersonal = personalSiteView;
personalSiteView = function () {
  let html = experiencePersonal();
  const site = selectedPersonalSite();
  if (site) {
    const canEdit=connection.permissions.get(permissionKey('site',site.id,'manage'));
    html = html.replace(button('Settings','edit-site','gear'),'')
      .replace(/<div class="resident-home-icon">[\s\S]*?<\/div>/,`<div class="site-product-art">${productArt(siteIllustration(site.sourcePayload?.subtype||site.type))}</div>`)
      .replace('</header>', `<div class="identity-actions">${configurationNotice(siteConfiguration(site),site.name)}${canEdit?identityIcon('Edit site','edit-site'):''}</div></header>`);
  }
  if (state.personalSiteTab !== "topology" && selectedPersonalSite())
    html = html.replace(
      /<div class="resident-summary">[\s\S]*?<\/div><\/div>/,
      "",
    );
  if (state.personalSiteTab !== "topology" && selectedPersonalSite()) {
    const tail = html.lastIndexOf("</div>");
    html = html.slice(0, tail) + energyIndicators("site", true, site) + personalChargingPlan(site) + `<div data-resident-services="${esc(site.id)}"></div>` + html.slice(tail);
  }
  return html;
};
// Community is the parent label, never a sibling of the sites.
tree = function () {
  const visibleSites=person().role==='manager'?scoped():availableSites().filter(s=>s.rec_id===comm().recId);
  const allowed=person().role==='manager'?null:new Set(availableAssets().map(a=>a.id));
  const showInventoryStatus = !isDeploymentView();
  return `<aside class="tree" aria-label="Sites in ${esc(comm().name)}"><button class="tree-community" data-action="all-sites"><span><small>COMMUNITY</small><strong>${esc(comm().name)}</strong></span>${icon("grid")}</button>${visibleSites.length>6?'<input class="tree-search" type="search" aria-label="Find a house" placeholder="Find a house">':''}<div class="tree-sites">${visibleSites
    .map(
      (s) => {
        const tone = showInventoryStatus ? siteConfiguration(s).tone : null;
        const status = tone === 'complete' ? 'Inventory details complete' : 'Inventory details missing';
        return `<button data-site="${esc(s.id)}" class="${state.site === s.id ? "selected" : ""}" ${tone ? `aria-description="${status}"` : ''} ${state.site === s.id ? 'aria-current="page"' : ""}>${icon(s.icon)}<span>${esc(s.name)}</span>${tone ? `<i class="dot is-${tone}" aria-hidden="true" title="${status}"></i>` : ''}</button>${state.site === s.id ? s.assets.filter(a=>!allowed||allowed.has(a.backendId||a.id)).map((a) => `<button class="child ${state.equipment === a.id ? "selected" : ""}" data-asset="${esc(a.id)}">${icon(a.icon)}${esc(a.name)}</button>`).join("") : ""}`;
      },
    )
    .join("")}</div></aside>`;
};
document.addEventListener("input", event => {
  const search=event.target.closest(".tree-search");
  if(!search)return;
  const normalize=value=>value.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase();
  const query=normalize(search.value.trim());
  let visible=true;
  for (const button of search.closest(".tree").querySelectorAll(".tree-sites > button")) {
    if(button.hasAttribute("data-site"))visible=normalize(button.textContent).includes(query);
    button.hidden=!visible;
  }
});
const experienceInventory = siteList;
siteList = function () {
  let html = experienceInventory();
  if (state.inventory === "vehicles") {
    html = html
      .replace(
        title(
          "Electric vehicles",
          "Vehicles belonging to members of this community.",
          button("Add vehicle", "add-vehicle", "plus"),
        ),
        "",
      )
      .replace(
        button("Add site", "add-site", "plus", true),
        button("Add vehicle", "add-vehicle", "plus", true),
      );
  }
  return html;
};
// Entering a site from any surface must leave overlays such as Flexibility behind.
document.addEventListener(
  "click",
  (e) => {
    if (e.target.closest("[data-site]")) {
      state.operationsPage = null;
      state.inventory = "sites";
    }
    if (e.target.closest("[data-inventory]")) state.operationsPage = null;
  },
  true,
);

/* Central dialogs share the equipment wizard's step vocabulary. DOM fields retain
   their original API readers and validation; no data is saved before Review. */
function stageForm(labels, groups) {
  const form = overlay.querySelector("form"),
    modal = overlay.querySelector(".drawer");
  if (!form || form.dataset.staged) return;
  form.dataset.staged = "true";
  form.noValidate = true;
  modal.classList.add("staged-dialog");
  const actions = form.querySelector(":scope > .actions:last-child");
  if (!actions) return;
  const submit = actions.querySelector('[type="submit"]');
  if (!submit) return;
  const originalLabel = submit.textContent,
    steps = labels.concat("Review");
  let step = 0;
  const nav = document.createElement("ol");
  nav.className = "wizard-steps";
  nav.setAttribute("aria-label", "Steps");
  nav.innerHTML = steps
    .map(
      (s, i) =>
        `<li><button type="button" data-stage="${i}" disabled><span>${i + 1}</span>${esc(s)}</button></li>`,
    )
    .join("");
  form.prepend(nav);
  const panels = groups.map((nodes) => {
    const panel = document.createElement("fieldset");
    panel.className = "stage-panel";
    for (const n of nodes) panel.append(n);
    form.insertBefore(panel, actions);
    return panel;
  });
  const review = document.createElement("section");
  review.className = "stage-review";
  form.insertBefore(review, actions);
  panels.push(review);
  const back = document.createElement("button");
  back.type = "button";
  back.className = "btn";
  back.textContent = "Back";
  actions.insertBefore(back, submit);
  function show() {
    panels.forEach((p, i) => {
      p.hidden = i !== step;
    });
    nav.querySelectorAll("button").forEach((b, i) => {
      b.disabled = i > step;
      b.setAttribute("aria-current", i === step ? "step" : "false");
      b.classList.toggle("is-complete", i < step);
    });
    back.hidden = step === 0;
    submit.textContent =
      step === panels.length - 1 ? originalLabel : "Continue";
    if (step === panels.length - 1) {
      review.innerHTML =
        '<h3>Review before saving</h3><dl class="definition-list">' +
        groups
          .flatMap((nodes) =>
            nodes.flatMap((n) => [
              ...n.querySelectorAll("input,select,textarea"),
              ...(n.matches("input,select,textarea") ? [n] : []),
            ]),
          )
          .filter(
            (n) =>
              !n.disabled &&
              (!(n.type === "radio" || n.type === "checkbox") || n.checked) &&
              !n.closest("fieldset:disabled") &&
              n.value &&
              !n.closest(".domain-object[hidden]"),
          )
          .map(
            (n) =>
              `<div><dt>${esc(n.labels?.[0]?.childNodes?.[0]?.textContent?.trim() || n.dataset.field || n.name || "Value")}</dt><dd>${esc(n.tagName === "SELECT" ? n.selectedOptions[0]?.textContent : (n.type === "checkbox" || n.type === "radio") ? n.labels?.[0]?.textContent?.trim() || n.value : n.value)}</dd></div>`,
          )
          .join("") +
        "</dl>";
    }
  }
  function validate(panel) {
    for (const n of panel.querySelectorAll("input,select,textarea"))
      if (
        !n.disabled &&
        !n.closest("fieldset:disabled") &&
        !n.checkValidity()
      ) {
        n.reportValidity();
        n.focus();
        return false;
      }
    return true;
  }
  form.addEventListener(
    "submit",
    (e) => {
      if (submit.disabled) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (step < panels.length - 1) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (validate(panels[step])) {
          step++;
          show();
        }
        return;
      }
      for (let i = 0; i < panels.length - 1; i++) {
        if (
          [...panels[i].querySelectorAll("input,select,textarea")].some(
            (n) =>
              !n.disabled &&
              (!(n.type === "radio" || n.type === "checkbox") || n.checked) &&
              !n.closest("fieldset:disabled") &&
              !n.checkValidity(),
          )
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
          step = i;
          show();
          validate(panels[i]);
          return;
        }
      }
    },
    true,
  );
  back.onclick = () => {
    step--;
    show();
  };
  nav.querySelectorAll("button").forEach(
    (b, i) =>
      (b.onclick = () => {
        if (i < step) {
          step = i;
          show();
        }
      }),
  );
  show();
}
const centralDrawer = drawer;
drawer = function (title, body, footer = "", onSubmit = null) {
  centralDrawer(title, body, footer, onSubmit);
  if (/^(New community|Add user|Add channel|Add association)$/.test(title)) {
    const form = overlay.querySelector("form");
    stageForm(
      ["Details"],
      [[...form.children].filter((n) => !n.matches(".actions"))],
    );
  }
};
const stagedEditor = structuredEditor;
structuredEditor = async function (options) {
  await stagedEditor(options);
  enhanceSiteChoices();
  if (options.method !== "POST" && overlay.querySelector("#operation-fields"))
    sectionedSettings();
  if (options.method === "POST" && overlay.querySelector("#operation-fields")) {
    const node = overlay.querySelector("#operation-fields .domain-object");
    if (node) {
      const fields = [...node.children].filter((n) => !n.matches("legend")),
        identity = fields.filter((n) =>
          n.querySelector(
            '[data-field="name"],[data-field="site_type"],[data-field="subtype"],[data-field="timezone"]',
          ),
        );
      stageForm(
        ["Identity", "Details"],
        [identity, fields.filter((n) => !identity.includes(n))],
      );
      node.remove();
    }
  }
};

const designCommunitySettings = communitySettingsView;
communitySettingsView = function () {
  return (
    designCommunitySettings() +
    `<section class="settings-section"><div><h2>Energy charts</h2><p>Measurement groups and tariff sources.</p></div><div>${button("Configure charts", "chart-settings", "settings")}</div></section>`
  );
};

function sectionedSettings() {
  const modal = overlay.querySelector(".drawer"),
    root = modal.querySelector("#operation-fields .domain-object");
  if (!root) return;
  const groups = [
    ["Identity", []],
    ["Location", []],
    ["Connection", []],
    ["Usage & limits", []],
    ["Advanced", []],
  ];
  for (const field of [...root.children].filter((n) => !n.matches("legend"))) {
    const key =
      field.dataset.settingKey ||
      field
        .querySelector(":scope > .domain-object-head input")
        ?.getAttribute("aria-label")
        ?.replace(/^Include /, "")
        .toLowerCase()
        .replaceAll(" ", "_") ||
      field
        .querySelector(":scope > .domain-array > h3")
        ?.textContent?.toLowerCase()
        .replaceAll(" ", "_") ||
      field.querySelector("[data-field]")?.dataset.field ||
      field
        .querySelector("legend")
        ?.textContent?.toLowerCase()
        .replaceAll(" ", "_") ||
      "";
    const text = field.textContent.toLowerCase();
    let idx =
      /name|manufacturer|model_name|lifecycle_status|site_type|subtype|description|managing_entity/.test(
        key,
      )
        ? 0
        : /address|location|localization|timezone/.test(key) ||
            /latitude|postal code/.test(text)
          ? 1
          : /external_references|inventory_notes|activity_period|survey|operation|measurement_groups|price_series/.test(
                key,
              )
            ? 4
            : /grid_connection|cpe|phase|import_limit|export_limit/.test(key)
              ? 2
              : 3;
    groups[idx][1].push(field);
  }
  const nonempty = groups.filter(([, fields]) => fields.length);
  const tabs = document.createElement("nav");
  tabs.className = "wizard-steps settings-steps";
  tabs.setAttribute("aria-label", "Settings sections");
  const area = document.createElement("div");
  area.className = "settings-panels";
  const panels = nonempty.map(([label, fields], i) => {
    const panel = document.createElement("section");
    panel.id = "settings-part-" + i;
    panel.className = "settings-section";
    panel.hidden = i !== 0;
    for (const f of fields) panel.append(f);
    area.append(panel);
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `<span>${i + 1}</span>${esc(label)}`;
    b.setAttribute("aria-controls", panel.id);
    b.setAttribute("aria-pressed", String(i === 0));
    b.setAttribute("aria-current", i === 0 ? "step" : "false");
    b.onclick = () => show(i);
    tabs.append(b);
    return panel;
  });
  function show(i) {
    panels.forEach((p, j) => (p.hidden = i !== j));
    [...tabs.children].forEach((b, j) => {
      b.setAttribute("aria-pressed", String(i === j));
      b.setAttribute("aria-current", i === j ? "step" : "false");
    });
  }
  root.replaceWith(tabs, area);
  modal.classList.add("sectioned-settings");
  const form = modal.querySelector("form");
  form.noValidate = true;
  form.addEventListener(
    "submit",
    (e) => {
      for (let i = 0; i < panels.length; i++) {
        const invalid = [
          ...panels[i].querySelectorAll("input,select,textarea"),
        ].find(
          (n) =>
            !n.disabled &&
            !n.closest("fieldset:disabled") &&
            !n.checkValidity(),
        );
        if (invalid) {
          e.preventDefault();
          e.stopImmediatePropagation();
          show(i);
          const details = invalid.closest("details");
          if (details) details.open = true;
          invalid.reportValidity();
          invalid.focus();
          return;
        }
      }
    },
    true,
  );
}
// Keep the API-backed selects as the source of truth; present their options as choices.
function enhanceSiteChoices() {
  const modal = overlay.querySelector(".drawer");
  if (!modal) return;
  for (const key of ["site_type", "subtype"]) {
    const select = modal.querySelector(`[data-field="${key}"]`);
    if (!select) continue;
    const choices = document.createElement("div");
    choices.className = "site-type-choices";
    choices.setAttribute("role", "group");
    choices.setAttribute(
      "aria-label",
      key === "site_type" ? "Site type choices" : "Site subtype choices",
    );
    select.classList.add("choice-native");
    select.setAttribute("aria-hidden", "true");
    select.tabIndex = -1;
    select.parentElement.after(choices);
    const paint = () => {
      choices.replaceChildren();
      for (const option of select.options) {
        if (key === "site_type" && !option.value) continue;
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("aria-pressed", String(option.value === select.value));
        b.innerHTML = `${option.value ? productArt(siteIllustration(option.value)) : '<span class="unspecified-choice">—</span>'}<span>${esc(option.textContent)}</span>`;
        b.onclick = () => {
          select.value = option.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          paint();
        };
        choices.append(b);
      }
    };
    select.addEventListener("change", paint);
    // Site type changes replace the subtype options synchronously.
    if (key === "subtype")
      modal
        .querySelector('[data-field="site_type"]')
        .addEventListener("change", paint);
    paint();
  }
  const coordinateLegend = [...modal.querySelectorAll("legend")].find(
    (n) => n.textContent === "Location",
  );
  if (coordinateLegend) {
    coordinateLegend.textContent = "Coordinates · optional";
    const note = document.createElement("p");
    note.className = "subtitle";
    note.textContent =
      "Latitude and longitude are separate from the postal address. Fill in both, or leave both empty.";
    coordinateLegend.after(note);
  }
  for (const [key, label, help] of [
    [
      "external_references",
      "Linked system identifiers",
      "IDs used to match this site with another platform. Optional; these are not measurement tags.",
    ],
    [
      "supply_survey",
      "Original survey data",
      "Information imported from the initial survey. It does not define your current contract.",
    ],
  ]) {
    const field = [...modal.querySelectorAll(".domain-field")].find(
      (f) =>
        f.querySelector(":scope > .domain-array > h3")?.textContent ===
          DomainForm.label(key) ||
        f
          .querySelector(":scope > .domain-object-head input")
          ?.getAttribute("aria-label") ===
          "Include " + DomainForm.label(key),
    );
    if (!field) continue;
    const details = document.createElement("details");
    details.className = "advanced-setting";
    details.dataset.settingKey = key;
    const summary = document.createElement("summary");
    summary.textContent = label;
    details.append(summary);
    const note = document.createElement("p");
    note.className = "subtitle";
    note.textContent = help;
    details.append(note);
    field.before(details);
    details.append(field);
  }
}
const conciseContractEditor = contractEditor;
contractEditor = async function (scope = "community") {
  await conciseContractEditor(scope);
  const modal = overlay.querySelector(".drawer");
  if (!modal) return;
  const intro = modal.querySelector("form > .subtitle");
  if (intro)
    intro.textContent =
      scope === "community"
        ? "These rules are shared by the community. Purchases can follow a variable price; member sales can reference that price with a multiplier such as 0.8 (80%)."
        : scope === "conditions"
          ? "Only fill in exceptions for this site. With no overrides, the shared community rules apply."
          : "Your external supplier’s terms, used as a comparison benchmark. They do not replace the community tariff.";
  const holder = modal.querySelector("#contract-fields");
  function fold() {
    holder.querySelectorAll(".domain-array-row").forEach((row) => {
      if (row.querySelector(":scope > details")) return;
      const field = row.querySelector(":scope > .domain-field");
      if (!field) return;
      const heading = field.querySelector(
        '[data-field="name"],[data-field="code"]',
      );
      const details = document.createElement("details");
      details.className = "contract-part";
      details.open = !heading?.value;
      const summary = document.createElement("summary");
      summary.textContent = heading?.value || "New terms";
      details.append(summary);
      row.prepend(details);
      details.append(field);
      heading?.addEventListener(
        "input",
        () => (summary.textContent = heading.value || "New terms"),
      );
    });
  }
  fold();
  holder.addEventListener("click", () => setTimeout(fold, 0));
  modal.querySelector("form").addEventListener(
    "invalid",
    (e) => {
      let d = e.target.closest("details");
      while (d) {
        d.open = true;
        d = d.parentElement.closest("details");
      }
    },
    true,
  );
};

function equipmentArt(a) {
  return productArt(({ev_charger:'charger',pv_system:'sun',grid_meter:'bolt',ev:'car',heat_pump:'heat',heater:'heat',water_pump:'pump',micro_wind_turbine:'wind',thermal_storage:'heat',non_shiftable_load:'device',generic_device:'device'})[a.assetType||a.asset_type] || (['battery','appliance'].includes(a.assetType||a.asset_type)?a.assetType||a.asset_type:'device'));
}
function equipmentDetails(a, s) {
  const p = a.sourcePayload || a.specification || {};
  const labels = {
    manufacturer:['Manufacturer'],model_name:['Model'],lifecycle_status:['Lifecycle'],electrical_connection_type:['Electrical connection'],serial_number:['Serial number'],charger_type:['Charger type'],vehicle_to_grid_capable:['Vehicle-to-grid capable'],
    meter_id:['Meter identifier'],meter_role:['Meter role'],bidirectional:['Bidirectional'],
    capacity_kwh:['Capacity','kWh'],battery_capacity_kwh:['Battery capacity','kWh'],
    min_state_of_charge:['Minimum state of charge','%',100],max_state_of_charge:['Maximum state of charge','%',100],
    min_charge_kw:['Minimum charging power','kW'],max_charge_kw:['Maximum charging power','kW'],
    min_discharge_kw:['Minimum discharge power','kW'],max_discharge_kw:['Maximum discharge power','kW'],
    inverter_capacity_kw:['Inverter capacity','kW'],dc_peak_power_kwp:['PV peak capacity','kWp'],
    max_charging_power:['Maximum charging power','kW'],max_charging_power_kw:['Maximum charging power','kW'],min_charging_power:['Minimum charging power','kW'],max_discharging_power:['Maximum discharge power','kW'],min_discharging_power:['Minimum discharge power','kW'],
    max_current_a:['Maximum current','A'],max_ac_charging_current_a:['Maximum AC charging current','A'],
    nominal_power_kw:['Nominal power','kW'],rated_power_kw:['Rated power','kW'],
    coefficient_of_performance:['Coefficient of performance'],efficiency:['Efficiency'],pump_efficiency:['Pump efficiency'],
    appliance_type:['Appliance type'],device_category:['Device category'],supported_modes:['Supported modes'],
    consumption_unit:['Consumption unit'],coverage:['Coverage'],loss_per_hour:['Hourly loss'],
  };
  const rows = Object.entries(labels).filter(([key])=>hasDefinition(p[key])).map(([key,[label,unit='',scale=1]])=>{
    const value = typeof p[key]==='boolean' ? p[key]?'Yes':'No' : typeof p[key]==='number' ? num(p[key]*scale) : key==='manufacturer' && typeof p[key]==='object' ? [p[key].name,p[key].country].filter(Boolean).join(' · ') : Array.isArray(p[key]) ? p[key].join(', ') : String(p[key]).replaceAll('_',' ');
    return `<div><dt>${label}</dt><dd>${esc(value)}${unit?` <small>${unit}</small>`:''}</dd></div>`;
  });
  if(p.phase_connection?.phases?.length) rows.push(`<div><dt>Connected phases</dt><dd>${p.phase_connection.phases.map(phase=>esc(phase)).join(' · ')}</dd></div>`);
  if(p.plugs?.length) rows.push(`<div><dt>Connectors</dt><dd>${p.plugs.length}</dd></div>`);
  if ((a.assetType||a.asset_type)==='grid_meter') {
    for(const key of ['meter_role','meter_id','electrical_connection_type','bidirectional'])
      if(!hasDefinition(p[key]))rows.push(`<div><dt>${labels[key][0]}</dt><dd class="detail-unset">Not set</dd></div>`);
    if(!p.phase_connection?.phases?.length)rows.push('<div><dt>Connected phases</dt><dd class="detail-unset">Not set</dd></div>');
  }
  const grid = s.sourcePayload?.grid_connection;
  if ((a.assetType||a.asset_type)==='grid_meter' && grid?.phase_type)
    rows.push(`<div><dt>Site connection phases</dt><dd>${esc(grid.phase_type.replaceAll('_',' '))}</dd></div>`);
  return `<section class="equipment-specifications"><h2>Technical details</h2>${rows.length?`<dl class="equipment-facts">${rows.join('')}</dl>`:'<p class="muted">Technical characteristics have not been filled in yet.</p>'}</section>`;
}
equipmentContent = function () {
  const s=chosen(); initialiseChannels(s);
  const a=currentAssets().find(a=>a.id===state.equipment);
  if(!a) return '<p class="muted">Equipment is not available.</p>';
  const canManage=person().role==='manager'||P.assetPermission(person(),availableAssets().find(x=>x.id===(a.backendId||a.id))||a,'manage');
  const flex=['ev_charger','appliance','heat_pump','heater','water_pump'].includes(a.assetType||a.asset_type);
  return `<div class="workspace">${tree()}<div class="detail equipment-detail"><div class="equipment-breadcrumb"><button data-action="back-to-equipment-list">${icon('left')} ${esc(s.name)} · Equipment</button>${icon('right')}<span>${esc(a.name)}</span></div><div class="sitehead"><div class="equipment-heading"><span class="equipment-product-art">${equipmentArt(a)}</span><div><h1>${esc(a.name)}</h1><p class="subtitle">${esc(DomainForm.label(a.assetType||a.asset_type||a.kind))}${a.sourcePayload?.is_simulated?' · Simulated':''} · ${esc(s.name)}</p></div></div><div class="identity-actions">${configurationNotice(equipmentConfiguration(a),a.name)}${person().role==='manager'?`<span data-equipment-collection="${esc(a.backendId||a.id)}" data-collection-site="${esc(s.id)}"></span>`:''}${canManage?identityIcon('Equipment settings','edit-equipment','gear'):''}</div></div><nav class="tabs" aria-label="Equipment sections">${[['overview','Overview'],['sensors','Channels']].map(([key,label])=>`<button data-device-tab="${key}" class="${state.deviceTab===key?'active':''}">${label}</button>`).join('')}</nav>${state.deviceTab==='sensors'?`<div class="sectionhead"><p class="subtitle">Measurements and commands for this equipment.</p>${canManage?'<button class="btn" data-new-channel>'+icon('plus')+' Add channel</button>':''}</div>${channelTable(a)}`:tPanel(a.channels.filter(c=>c.capability_type==='sensor'),'asset:'+a.id)+`<div class="equipment-information">${equipmentDetails(a,s)}</div>${canManage&&flex?`<div class="equipment-flex-action"><button class="btn" data-equipment-session="${esc(a.id)}">${icon('calendar')} Create flexibility request</button></div>`:''}`}</div></div>`;
};
const returnFromEquipment = action;
action = function (key) {
  if (key !== 'back-to-equipment-list') return returnFromEquipment(key);
  state.equipment=null;
  state.tab='assets';
  render();
};
const illustratedEquipmentEditor=editEquipment;
editEquipment=async function(id){
  await illustratedEquipmentEditor(id);
  const a=equipmentRecord(id),head=overlay.querySelector('.drawer > .sectionhead');
  if(a&&head){const art=document.createElement('span');art.className='equipment-dialog-art';art.innerHTML=equipmentArt(a);head.prepend(art);}
};

document.addEventListener('click', e=>{
  document.querySelectorAll('.configuration-notice[open]').forEach(notice=>{if(!notice.contains(e.target))notice.open=false;});
});
document.addEventListener('keydown', e=>{
  if(e.key==='Escape')document.querySelectorAll('.configuration-notice[open]').forEach(notice=>{notice.open=false;notice.querySelector('summary').focus();});
});

document.addEventListener('click',e=>{
 const b=e.target.closest('[data-review-site]');if(!b)return;
 state.page='sites';state.site=b.dataset.reviewSite;state.equipment=b.dataset.reviewEquipment||null;
 state.operationsPage=null;state.inventory='sites';state.tab='assets';state.deviceTab='overview';render();
});

function siteOperationalSummary(site) {
 const review=siteConfiguration(site), channels=(site.assets||[]).flatMap(a=>a.channels||[]).filter(c=>c.capability_type==='sensor');
 const physical=channels.filter(c=>c.mongo_binding&&!c.simulation_binding), simulated=channels.filter(c=>c.simulation_binding);
 const dataLabel=physical.length?'History linked':simulated.length?'Simulated source':'No readings linked';
 const dataHelp=physical.length?'Stored readings are linked. Freshness for the whole site is not yet verified.':simulated.length?'The chart uses simulated readings, not physical equipment.':'Link a measurement source in the equipment channel settings.';
 return `<section class="site-operational-status" aria-label="Site status"><div><span>Configuration</span><strong class="tone-${review.tone}">${review.tone==='complete'?'Complete':'Needs attention'}</strong><small>${review.missing.length?review.missing.length+' items to review':'Equipment and channel definitions'}</small></div><div title="${dataHelp}"><span>Data</span><strong>${dataLabel}</strong><small>${physical.length?'Freshness not verified':simulated.length?'Physical collection not confirmed':'Configure equipment channels'}</small></div><div><span>Control</span><strong>Not confirmed</strong><small>Equipment execution is not reported yet</small></div></section>`;
}
function personalChargingPlan(site) {
 const ids=new Set(availableAssets().filter(a=>a.site_id===site.id&&a.asset_type==='ev_charger').map(a=>a.id));
 if(!ids.size)return '';
 const start=new Date(),end=new Date(+start+31*86400000);
 const source=(connection.raw.events||[]).filter(e=>ids.has(e.asset_id)&&sessionVisible(e)&&e.session_type==='ev_charging'&&e.mode!=='forecast'&&!['cancelled','canceled'].includes(e.status));
 const events=window.FlexRecurrence?window.FlexRecurrence.expand(source,start,end):source;
 const next=events.filter(e=>Date.parse(e.ends_at)>+start&&Date.parse(e.starts_at)<+end).sort((a,b)=>Date.parse(a.ends_at)-Date.parse(b.ends_at))[0];
 return `<section class="personal-next-plan"><span class="plan-product-art">${productArt('charger')}</span><div><h2>${next?'Next departure':'Your charging plan'}</h2><p>${next?esc(new Date(next.ends_at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))+' · '+esc(flexRequirement(next)):'No charging request in the next 31 days.'}</p><small>${next?'Requested target · charging completion is not confirmed':'Choose when you need your vehicle and its minimum charge.'}</small></div><button class="btn" data-op-page="sessions">${next?'View plan':'Plan charging'}</button></section>`;
}
// The catalogue can assess setup, not connectivity. Never infer Offline from an empty reading cache.
communityState=function(c){return !c.sites.length?'offline':c.sites.every(s=>siteConfiguration(s).tone==='complete')?'normal':'alerts';};
const setupCommunityList=communityList;
communityList=function(){return setupCommunityList().replaceAll('>Offline<','>Not configured<').replaceAll('>Normal<','>Configuration complete<').replaceAll('>With alerts<','>Needs setup<');};
const setupCommunityChooser=allCommunities;
allCommunities=function(){return setupCommunityChooser().replaceAll('>Offline<','>Not configured<').replaceAll('>Normal<','>Configuration complete<').replaceAll('>With alerts<','>Needs setup<');};

// Refresh the inventory after closing its collection editor, preserving the open form while saving.
document.addEventListener('collection-settings-saved',()=>{void loadBackend().catch(error=>toast(error.message));});
