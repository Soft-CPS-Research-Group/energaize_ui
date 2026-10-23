/* Mediterranean Ceramic: architecture first, equipment second, readings on demand.
   Uses existing navigation, permission checks, charts, settings and flexibility forms. */
'use strict';
Object.assign(paths, { calendar: 'M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2 M7 2v5 M17 2v5 M3 10h18 M7 14h2 M13 14h2 M7 17h2', up: 'm6 15 6-6 6 6' });
const ceramicSelection = new Map();
const ceramicCharts = new Set();
function ceramicTile(kind) {
  const primary = { home: 0, sun: 1, solar: 1, battery: 2, charger: 3, car: 3, community: 4, network: 5, device: 5 }[kind];
  if (primary !== undefined) return { sheet: 'ceramic', index: primary };
  const extra = { bolt: 0, appliance: 1, heat: 2, factory: 3, apartment: 4, building: 4, office: 5, store: 5 }[kind];
  return extra === undefined ? null : { sheet: 'ceramic-extra', index: extra };
}
function ceramicArt(kind) {
  const tile = ceramicTile(kind);
  return !tile ? vectorProductArt(kind) : `<span class="ceramic-art" data-ceramic-kind="${esc(kind)}" aria-hidden="true" style="background-image:url('/assets/mediterranean/${tile.sheet}.webp');background-position:${(tile.index % 3) * 50}% ${tile.index < 3 ? 0 : 100}%"></span>`;
}
// Existing surfaces retain their SVG-sized slots; exports embed the icon sheets.
productArt = function(kind = 'home') {
  const tile = ceramicTile(kind);
  if (!tile) return vectorProductArt(kind);
  return `<svg class="product-art ceramic-product-art" viewBox="0 0 100 100" aria-hidden="true"><image href="/assets/mediterranean/${tile.sheet}.webp" x="${-(tile.index % 3) * 100}" y="${tile.index < 3 ? 0 : -100}" width="300" height="200" /></svg>`;
};
function ceramicAssets(site) {
  const allowed = person().role === 'manager' ? null : new Set(availableAssets().map(a => a.id));
  return (site.assets || []).filter(a => !allowed || allowed.has(a.backendId || a.id));
}
function ceramicAssetType(asset) { return asset.assetType || asset.asset_type || asset.kindKey || ''; }
function ceramicAssetIcon(asset) {
  return ({ pv_system: 'sun', battery: 'battery', ev_charger: 'charger', ev: 'car', grid_meter: 'bolt', heat_pump: 'heat', appliance: 'appliance' })[ceramicAssetType(asset)] || asset.icon || 'device';
}
function ceramicEquipmentLink(asset) {
  return person().role === 'manager' ? `data-asset="${esc(asset.id)}"` : `data-personal-asset="${esc(asset.backendId || asset.id)}"`;
}
function ceramicGroups(assets) {
  const groups = new Map();
  assets.forEach(asset => { const key = ceramicAssetType(asset); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(asset); });
  return [...groups.entries()].map(([type, items]) => ({ type, items }));
}
function ceramicGroupLabel(type) {
  return ({ pv_system: 'Solar', battery: 'Batteries', ev_charger: 'EV chargers', ev: 'Vehicles', grid_meter: 'Grid meters', heat_pump: 'Heat pumps', appliance: 'Appliances' })[type] || DomainForm.label(type);
}
function ceramicSpecs(asset) {
  const source = asset.sourcePayload || {};
  const values = [];
  const add = (label, keys, unit = '') => {
    const value = keys.map(key => source[key]).find(v => v !== null && v !== undefined && v !== '');
    if (value !== undefined) values.push([label, typeof value === 'number' ? `${num(value)}${unit}` : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : DomainForm.label(String(value))]);
  };
  const type = ceramicAssetType(asset);
  if (type === 'pv_system') { add('Installed solar', ['dc_peak_power_kwp'], ' kWp'); add('Inverter power', ['inverter_capacity_kw'], ' kW'); add('Panels', ['number_of_panels']); }
  if (type === 'battery' || type === 'ev') { add('Battery capacity', ['capacity_kwh', 'battery_capacity_kwh'], ' kWh'); add('Usable capacity', ['usable_capacity_kwh'], ' kWh'); add('Charge power', ['max_charge_kw'], ' kW'); add('Discharge power', ['max_discharge_kw'], ' kW'); }
  if (type === 'ev_charger') { add('Charging power', ['max_charging_power_kw', 'max_charging_power'], ' kW'); add('Maximum current', ['max_current_a'], ' A'); add('Connection', ['electrical_connection_type']); if (source.plugs?.length) values.push(['Connectors', String(source.plugs.length)]); add('Vehicle to grid', ['vehicle_to_grid_capable']); }
  if (type === 'appliance') { add('Appliance', ['appliance_type']); add('Rated power', ['rated_power_kw', 'nominal_power_kw'], ' kW'); add('Load capacity', ['capacity_kg'], ' kg'); add('Can pause a cycle', ['interruptible']); }
  if (type === 'heat_pump') { add('Heating power', ['heating_capacity_kw', 'nominal_power_kw'], ' kW'); add('Efficiency (COP)', ['cop']); }
  if (type === 'grid_meter') { add('Meter role', ['meter_role']); add('Bidirectional', ['bidirectional']); add('Connection', ['electrical_connection_type']); }
  if (!values.length) add('Rated power', ['nominal_power_kw', 'rated_power_kw', 'max_power_kw'], ' kW');
  const maker = typeof source.manufacturer === 'object' ? source.manufacturer?.name : source.manufacturer;
  if (maker) values.push(['Manufacturer', maker]);
  add('Model', ['model_name', 'model']);
  add('Status', ['lifecycle_status']);
  return values.slice(0, 4);
}
function ceramicFacts(values) { return `<dl class="ceramic-facts">${values.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`; }
function ceramicInspector(site, assets, selected, scene, group) {
  if (group) return `<span class="ceramic-kicker">YOUR EQUIPMENT</span><h2>${esc(ceramicGroupLabel(group.type))}</h2><p>${group.items.length} devices at this site. Select one to explore.</p><div class="ceramic-device-list">${group.items.map(a => `<button data-med-select="${esc(a.id)}" data-med-owner="${esc(site.id)}"><span><strong>${esc(a.name)}</strong><small>${esc(ceramicSpecs(a).slice(0, 2).map(([k,v]) => `${k}: ${v}`).join(' · ') || DomainForm.label(ceramicAssetType(a)))}</small></span>${icon('right')}</button>`).join('')}</div>`;
  if (!selected) {
    const facts = [['Equipment', assets.length], ['Site type', DomainForm.label(site.sourcePayload?.subtype || site.type || 'Not specified')]];
    const total = (type, key, label, unit) => { const items = assets.filter(a => ceramicAssetType(a) === type && a.sourcePayload?.lifecycle_status !== 'retired'); if (items.length && items.every(a => typeof a.sourcePayload?.[key] === 'number')) facts.push([label, `${num(items.reduce((sum,a) => sum + a.sourcePayload[key], 0))} ${unit}`]); };
    total('pv_system', 'dc_peak_power_kwp', 'Installed solar', 'kWp'); total('battery', 'capacity_kwh', 'Battery capacity', 'kWh');
    return `<span class="ceramic-kicker">YOUR ENERGY SPACE</span><div class="ceramic-inspector-art">${ceramicArt(siteIllustration(site.sourcePayload?.subtype || site.type))}</div><h2>At a glance</h2><p>Select equipment to explore your energy system.</p>${ceramicFacts(facts)}<button class="btn primary" data-med-charts="site:${esc(site.id)}">${icon('chart')} ${ceramicCharts.has('site:' + site.id) ? 'Hide' : 'Explore'} energy data</button>`;
  }
  const type = ceramicAssetType(selected), id = selected.backendId || selected.id;
  const canRequest = ['ev_charger', 'appliance', 'heat_pump', 'heater', 'water_pump'].includes(type) && sessionAssets().some(a => a.id === id) && flexCanRequest(id);
  const specs = ceramicSpecs(selected), siblings = assets.filter(a => ceramicAssetType(a) === type);
  return `<span class="ceramic-kicker">${esc(DomainForm.label(type))}</span><div class="ceramic-inspector-art" data-equipment-kind="${esc(type)}">${ceramicArt(ceramicAssetIcon(selected))}</div><h2>${esc(selected.name)}</h2>${type === 'grid_meter' ? '<p>Measures electricity exchanged with the grid.</p>' : ''}${siblings.length > 1 ? `<button class="btn text" data-med-select="group:${esc(type)}" data-med-owner="${esc(site.id)}">View all ${siblings.length} ${esc(ceramicGroupLabel(type).toLowerCase())}</button>` : ''}${specs.length ? ceramicFacts(specs) : '<p>Equipment specifications have not been added yet.</p>'}<button class="btn primary" ${ceramicEquipmentLink(selected)}>Open equipment ${icon('right')}</button>${canRequest ? `<button class="btn text" data-equipment-session="${esc(id)}">${icon('calendar')} Create flexibility request</button>` : ''}`;
}
function ceramicSiteScene(site) {
  const assets = ceramicAssets(site), selection = ceramicSelection.get(site.id), groups = ceramicGroups(assets);
  const selected = assets.find(a => a.id === selection), group = groups.find(g => 'group:' + g.type === selection);
  const scene = MediterraneanScenes.select(site, assets), selectedKind = selected && MediterraneanScenes.kind(selected);
  const point = selected?.sourcePayload?.lifecycle_status === 'retired' ? null : scene?.points[selectedKind];
  return `<section class="ceramic-site" data-med-site="${esc(site.id)}" aria-label="Site overview"><div class="ceramic-site-stage"><figure class="ceramic-photo">${scene ? `<div class="ceramic-photo-plane"><img src="${scene.src}" alt="${scene.type} illustration${scene.exact && scene.signature !== 'none' ? ' with ' + esc(scene.signature.replaceAll('+', ', ')) : ''}" width="1672" height="941" decoding="async">${Object.entries(scene.points).map(([kind, coords]) => { const equipment = assets.filter(a => MediterraneanScenes.kind(a) === kind && a.sourcePayload?.lifecycle_status !== 'retired'); return equipment.length === 1 ? `<button class="ceramic-image-target" style="left:${coords[0]}%;top:${coords[1]}%;width:${kind === 'solar' ? 24 : 7}%;height:${kind === 'solar' ? 14 : 18}%" data-med-select="${esc(equipment[0].id)}" data-med-owner="${esc(site.id)}" data-med-from-image aria-label="Select ${esc(equipment[0].name)}" title="${esc(equipment[0].name)}"><span>${esc(equipment[0].name)}</span></button>` : equipment.length > 1 ? `<button class="ceramic-image-target" style="left:${coords[0]}%;top:${coords[1]}%;width:20%;height:22%" data-med-select="group:${esc(ceramicAssetType(equipment[0]))}" data-med-owner="${esc(site.id)}" data-med-from-image aria-label="Select ${esc(ceramicGroupLabel(ceramicAssetType(equipment[0])))}"><span>${esc(ceramicGroupLabel(ceramicAssetType(equipment[0])))}</span></button>` : ''; }).join('')}${point ? `<span class="ceramic-hotspot" style="left:${point[0]}%;top:${point[1]}%" role="img" aria-label="${esc(selected.name)} location"><i></i></span>` : ''}</div>` : `<div class="ceramic-no-photo">${productArt(siteIllustration(site.sourcePayload?.subtype || site.type))}</div>`}</figure><aside class="ceramic-inspector ${group ? 'is-group' : ''}" aria-live="polite">${ceramicInspector(site, assets, selected, scene, group)}</aside></div><div class="ceramic-equipment-dock" aria-label="Select equipment"><button class="ceramic-equipment ${!selected && !group ? 'is-selected' : ''}" data-med-select="" data-med-owner="${esc(site.id)}" aria-pressed="${!selected && !group}">${ceramicArt(siteIllustration(site.sourcePayload?.subtype || site.type))}<span>Overview<small>${assets.length} equipment</small></span></button>${groups.map(g => { const active = group === g || selected && ceramicAssetType(selected) === g.type; return `<button class="ceramic-equipment ${active ? 'is-selected' : ''}" data-med-select="${esc(g.items.length > 1 ? 'group:' + g.type : g.items[0].id)}" data-med-owner="${esc(site.id)}" aria-pressed="${!!active}">${ceramicArt(ceramicAssetIcon(g.items[0]))}<span>${esc(g.items.length > 1 ? ceramicGroupLabel(g.type) : g.items[0].name)}<small>${g.items.length > 1 ? g.items.length + ' devices' : esc(DomainForm.label(g.type))}</small></span></button>`; }).join('')}</div></section>`;
}
function ceramicChartToggle(key, label) {
  const open = ceramicCharts.has(key);
  return `<button class="ceramic-chart-toggle" data-med-charts="${esc(key)}" aria-expanded="${open}"><span>${icon('chart')}<strong>${label}</strong><small>Measurements, history and comparisons</small></span><span>${open ? 'Hide charts' : 'Show charts'} ${icon(open ? 'up' : 'down')}</span></button>`;
}
const ceramicOriginalSiteGraph = siteGraph;
siteGraph = function(site) {
  const key = 'site:' + site.id;
  return ceramicSiteScene(site) + ceramicChartToggle(key, 'Energy data') + (ceramicCharts.has(key) ? `<div class="ceramic-chart-content">${ceramicOriginalSiteGraph({ ...site, assets: ceramicAssets(site) })}</div>` : '');
};
overview = function() {
  const sites = scoped(), assets = sites.flatMap(s => ceramicAssets(s)), key = 'community:' + comm().recId;
  const count = type => assets.filter(a => ceramicAssetType(a) === type).length;
  return `<header class="community-identity"><div class="community-emblem">${ceramicArt('community')}</div><div><h1>${esc(comm().name)}</h1><p>${esc(comm().place || '')}</p></div><div class="identity-actions">${communityNotice()}${identityIcon('Edit community', 'edit-community-details')}</div></header><div class="energy-overview"><section class="ceramic-community"><figure class="ceramic-photo"><div class="ceramic-photo-plane"><img src="/assets/mediterranean/login-community.webp" width="1536" height="1024" alt="Mediterranean energy community illustration"></div></figure><aside class="ceramic-community-summary"><span class="ceramic-kicker">COMMUNITY OVERVIEW</span><h2>${sites.length}<small> registered ${sites.length === 1 ? 'site' : 'sites'}</small></h2><p>Explore the spaces and equipment in your community.</p><dl class="ceramic-facts"><div><dt>Equipment</dt><dd>${assets.length}</dd></div><div><dt>Solar installations</dt><dd>${count('pv_system')}</dd></div><div><dt>Batteries</dt><dd>${count('battery')}</dd></div><div><dt>EV chargers</dt><dd>${count('ev_charger')}</dd></div></dl><button class="btn primary" data-page="sites">Open inventory ${icon('right')}</button></aside></section><section class="ceramic-sites-section"><div class="sectionhead"><h2>Your sites</h2><button class="btn text" data-page="sites">View all ${icon('right')}</button></div><div class="ceramic-sites-strip">${sites.map(s => `<button data-site="${esc(s.id)}">${ceramicArt(siteIllustration(s.sourcePayload?.subtype || s.type))}<span><strong>${esc(s.name)}</strong><small>${ceramicAssets(s).length} equipment · ${esc(DomainForm.label(s.sourcePayload?.subtype || s.type))}</small></span>${icon('right')}</button>`).join('') || '<p>No sites registered yet.</p>'}</div></section>${ceramicChartToggle(key, 'Community energy data')}${ceramicCharts.has(key) ? `<div class="ceramic-chart-content">${communityMeasurementViews()}</div>` : ''}${energyIndicators()}</div>`;
};
document.addEventListener('click', event => {
  const select = event.target.closest('[data-med-select]');
  if (select) {
    const owner = select.dataset.medOwner;
    const site = (person().role === 'manager' ? scoped() : availableSites()).find(s => s.id === owner);
    if (!site) return;
    const value = select.dataset.medSelect;
    if (value && !ceramicAssets(site).some(a => a.id === value) && !ceramicGroups(ceramicAssets(site)).some(g => 'group:' + g.type === value)) return;
    ceramicSelection.set(owner, select.dataset.medSelect);
    // Replace only the scene: selecting equipment does not remount charts or services.
    const stage = select.closest('[data-med-site]');
    const valueToFocus = select.dataset.medSelect;
    stage.outerHTML = ceramicSiteScene(site);
    const current = [...document.querySelectorAll('[data-med-site]')].find(n => n.dataset.medSite === owner);
    const nextFocus = [...(current?.querySelectorAll('[data-med-select]') || [])].find(n => n.dataset.medSelect === valueToFocus) || current?.querySelector('.ceramic-inspector [data-asset], .ceramic-inspector [data-personal-asset]');
    nextFocus?.focus({ preventScroll: true });
    if (select.hasAttribute('data-med-from-image')) current?.querySelector('.ceramic-inspector')?.scrollIntoView?.({block:'nearest', behavior:typeof matchMedia === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto'});
  }
  const toggle = event.target.closest('[data-med-charts]');
  if (toggle) {
    const key = toggle.dataset.medCharts;
    if (ceramicCharts.has(key)) ceramicCharts.delete(key); else ceramicCharts.add(key);
    render();
    [...document.querySelectorAll('.ceramic-chart-toggle')].find(n => n.dataset.medCharts === key)?.focus({ preventScroll: true });
  }
});
const ceramicOriginalRender = render;
render = function() {
  ceramicOriginalRender();
  if (connection.loading || connection.error || !state.loggedIn) return;
  document.querySelectorAll('.topbar .brand-logo').forEach(img => { img.src = '/assets/logos/energaize-light.png'; });
  const account = document.querySelector('.topbar .avatar-btn');
  if (account) { account.innerHTML = userChip(person()); account.setAttribute('aria-expanded', String(!!state.userOpen)); }
};

// Translate a vertical mouse wheel into horizontal browsing only while the strip
// can move. At either end normal page scrolling resumes; trackpads stay native.
document.addEventListener('wheel', event => {
  const strip = event.target.closest('.ceramic-sites-strip, .ceramic-equipment-dock, .ceramic-wiring-scroll');
  if (!strip || event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
  const max = strip.scrollWidth - strip.clientWidth;
  if (max <= 0 || event.deltaY < 0 && strip.scrollLeft <= 0 || event.deltaY > 0 && strip.scrollLeft >= max - 1) return;
  event.preventDefault();
  strip.scrollLeft = Math.max(0, Math.min(max, strip.scrollLeft + event.deltaY * (event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? strip.clientWidth : 1)));
}, { passive: false });

// A membership diagram uses containment, not a web of invented electrical wires.
const ceramicTopologyGroups = new Map();
function ceramicTopologyExport(title, rootKind, entries, wired = false) {
  const cols = 4, width = 1040, height = 250 + Math.ceil(entries.length / cols) * 160;
  const glyph = (kind, x, y, size) => productArt(kind).replace('<svg ', `<svg x="${x}" y="${y}" width="${size}" height="${size}" `);
  const rows = Math.ceil(entries.length / cols);
  const wires = wired && entries.length ? `<g class="ceramic-export-connections" fill="none" stroke="#7a9275" stroke-width="2"><path d="M35 180V${180 + (rows-1)*160}"/>${Array.from({length:rows},(_,row)=>{const end=150+(Math.min(cols,entries.length-row*cols)-1)*245;return `<path d="M35 ${180+row*160}H${Math.max(row===0?520:35,end)}"/>`;}).join('')}${entries.map((entry,i)=>`<path data-connection="${esc(entry.name)}" d="M${150+i%cols*245} ${180+Math.floor(i/cols)*160}v25"/>`).join('')}</g>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="publication-graph ceramic-export" viewBox="0 0 ${width} ${height}" aria-hidden="true"><title>${esc(title)} · equipment and membership</title><rect width="${width}" height="${height}" fill="#f4f1eb"/>${glyph(rootKind, 480, 16, 80)}<text x="520" y="126" text-anchor="middle" fill="#344a39" font-size="22" font-family="Arial">${esc(title)}</text><path d="M520 145V180" stroke="#a6b598" stroke-width="2"/><rect x="20" y="180" width="1000" height="${height-200}" rx="24" fill="#fcfaf6" stroke="#dddfd4"/>${wires}${entries.map((entry,i) => { const x = 150 + i % cols * 245, y = 205 + Math.floor(i / cols) * 160; return `<g><title>${esc(entry.name)}</title>${glyph(entry.kind, x-35,y,70)}<text x="${x}" y="${y+93}" text-anchor="middle" fill="#344a39" font-size="14" font-family="Arial">${esc(entry.name.length > 28 ? entry.name.slice(0,26)+'…' : entry.name)}</text><text x="${x}" y="${y+116}" text-anchor="middle" fill="#6c756d" font-size="11" font-family="Arial">${String(entry.detail || '').split(' · ').map((line,j) => `<tspan x="${x}" dy="${j ? 15 : 0}">${esc(line)}</tspan>`).join('')}</text></g>`; }).join('')}</svg>`;
}
communityTopology = function() {
  const sites = scoped();
  return graphToolbar('Community topology') + `<section class="ceramic-topology" aria-label="Community membership"><button class="ceramic-topology-root" data-page="overview">${ceramicArt('community')}<strong>${esc(comm().name)}</strong><small>${sites.length} sites in this community</small></button><div class="ceramic-topology-stem"></div><div class="ceramic-topology-members">${sites.map(s => `<button class="ceramic-topology-node" data-site="${esc(s.id)}">${ceramicArt(siteIllustration(s.sourcePayload?.subtype || s.type))}<strong>${esc(s.name)}</strong><small>${ceramicAssets(s).length} equipment</small><span class="ceramic-topology-open">Explore site ${icon('right')}</span></button>`).join('') || '<p>No sites registered yet.</p>'}</div><p class="footnote">Community membership · select a site to explore its energy system.</p>${ceramicTopologyExport(comm().name, 'community', sites.map(s => ({name:s.name,kind:siteIllustration(s.sourcePayload?.subtype || s.type),detail:ceramicAssets(s).length+' equipment'})))}</section>`;
};
function ceramicSiteLimits(site) {
  const grid = site.sourcePayload?.grid_connection || {};
  return [['Import', site.importLimit ?? grid.import_limit_kw], ['Export', site.exportLimit ?? grid.export_limit_kw]].map(([label,value]) => `${label}: ${typeof value === 'number' ? '≤ ' + num(value) + ' kW' : 'not set'}`);
}
function ceramicEquipmentLimits(asset) {
  const data = { ...(asset.specification || {}), ...(asset.sourcePayload || {}) }, type = ceramicAssetType(asset);
  const first = (...keys) => keys.map(k => data[k]).find(v => typeof v === 'number' && Number.isFinite(v));
  const limit = (label, max, min) => `${label}: ${max === undefined ? 'not set' : min === undefined ? '≤ ' + num(max) + ' kW' : num(min) + '–' + num(max) + ' kW'}`;
  if (type === 'pv_system') return [limit('Generation', first('inverter_capacity_kw','max_power_kw','nominal_power_kw'))];
  if (type === 'battery') return [limit('Charge',first('max_charge_kw'),first('min_charge_kw')),limit('Discharge',first('max_discharge_kw'),first('min_discharge_kw'))];
  if (type === 'ev_charger') return [limit('Charge',first('max_charging_power_kw','max_charging_power'),first('min_charging_power_kw','min_charging_power')), ...(data.vehicle_to_grid_capable === true || first('max_discharging_power') !== undefined ? [limit('Discharge',first('max_discharging_power'),first('min_discharging_power'))] : [])];
  if (type === 'grid_meter') return [data.meter_role ? DomainForm.label(data.meter_role) + ' meter' : 'Grid measurement'];
  return [limit('Rated power',first('rated_power_kw','nominal_power_kw','max_power_kw'))];
}
function ceramicFlowDirection(asset) {
  const type = ceramicAssetType(asset);
  return type === 'pv_system' ? '↑ Generation to site' : type === 'battery' ? '↕ Charge / discharge' : type === 'grid_meter' ? '↕ Grid measurement' : type === 'ev_charger' && asset.sourcePayload?.vehicle_to_grid_capable === true ? '↕ Charging / vehicle to grid' : '↓ Supply from site';
}
siteTopology = function() {
  const site = chosen(), assets = ceramicAssets(site), groups = ceramicGroups(assets);
  const selected = groups.find(g => g.type === ceramicTopologyGroups.get(site.id));
  const gridLimits = ceramicSiteLimits(site);
  const branches = groups.map(g => {
    const single = g.items.length === 1, target = single ? g.items[0].backendId || g.items[0].id : 'group:' + g.type;
    const name = single ? g.items[0].name : ceramicGroupLabel(g.type);
    return `<button class="ceramic-topology-node ${selected === g ? 'is-selected' : ''}" data-connection-from="${esc(site.id)}" data-connection-to="${esc(target)}" ${single ? ceramicEquipmentLink(g.items[0]) : `data-med-topology-group="${esc(g.type)}" aria-expanded="${selected === g}"`}><span class="ceramic-connection-context">${esc(site.name)} connection to </span><span class="ceramic-flow-label">${single ? esc(ceramicFlowDirection(g.items[0])) : g.items.length + ' individual connections'}</span><span class="ceramic-connection-port" aria-hidden="true"></span>${ceramicArt(ceramicAssetIcon(g.items[0]))}<strong>${esc(name)}</strong><span class="ceramic-connection-limits">${single ? ceramicEquipmentLimits(g.items[0]).map(value => `<small>${esc(value)}</small>`).join('') : '<small>Open devices to see each limit</small>'}</span>${single ? '' : `<span class="ceramic-topology-open">View devices ${icon('right')}</span>`}</button>`;
  }).join('');
  return graphToolbar('Energy topology') + `<section class="ceramic-topology ceramic-flow-topology" data-med-topology="${esc(site.id)}" aria-label="Site equipment topology">
    <div class="ceramic-wiring-scroll" tabindex="0" role="group" aria-label="Site connections. Scroll horizontally to explore all equipment."><div class="ceramic-wiring-canvas" style="--branch-count:${Math.max(1,groups.length)}">
      <div class="ceramic-topology-supply"><button data-action="grid-info">${ceramicArt('network')}<span>Utility grid</span></button><div class="ceramic-grid-link"><svg class="ceramic-grid-wire" viewBox="0 0 150 20" aria-hidden="true"><path d="M2 10H148M9 4l-7 6 7 6M141 4l7 6-7 6"/></svg>${gridLimits.map(value => `<small>${esc(value)}</small>`).join('')}</div><button class="ceramic-topology-root" data-action="site-overview">${ceramicArt(siteIllustration(site.sourcePayload?.subtype || site.type))}<strong>${esc(site.name)}</strong><small>${assets.length} equipment · site connection</small></button></div>
      ${groups.length ? `<div class="ceramic-topology-stem" aria-hidden="true"></div><div class="ceramic-flow-bus"><span>Site distribution</span></div><div class="ceramic-topology-members ceramic-wired-members">${branches}</div>` : '<p class="empty">No equipment registered yet.</p>'}
    </div></div>
    ${selected ? `<div class="ceramic-topology-devices"><h3>${esc(ceramicGroupLabel(selected.type))}</h3><div class="ceramic-device-list">${selected.items.map(a => `<button ${ceramicEquipmentLink(a)}><span><strong>${esc(a.name)}</strong><small>${esc(ceramicFlowDirection(a))}</small><small>${esc(ceramicEquipmentLimits(a).join(' · '))}</small></span>${icon('right')}</button>`).join('')}</div></div>` : ''}
    ${ceramicTopologyExport(site.name,siteIllustration(site.sourcePayload?.subtype || site.type),[{name:'Grid connection',kind:'network',detail:gridLimits.join(' · ')},...assets.map(a => ({name:a.name,kind:ceramicAssetIcon(a),detail:ceramicEquipmentLimits(a).join(' · ')}))],true)}</section>`;
};
document.addEventListener('click', event => {
  const button = event.target.closest('[data-med-topology-group]');
  if (!button) return;
  const owner = button.closest('[data-med-topology]')?.dataset.medTopology;
  if (owner !== chosen()?.id || !ceramicGroups(ceramicAssets(chosen())).some(g => g.type === button.dataset.medTopologyGroup)) return;
  const type = button.dataset.medTopologyGroup;
  ceramicTopologyGroups.set(owner, ceramicTopologyGroups.get(owner) === type ? null : type);
  render();
  [...document.querySelectorAll('[data-med-topology-group]')].find(b => b.dataset.medTopologyGroup === type)?.focus({preventScroll:true});
});
const ceramicLegacyExport = exportTopology;
const ceramicExportSheets = new Map();
exportTopology = async function() {
  const original = document.querySelector('.ceramic-export');
  if (!original) return ceramicLegacyExport();
  const svg = original.cloneNode(true);
  try {
    for (const img of svg.querySelectorAll('image')) {
      const url = img.getAttribute('href');
      if (!ceramicExportSheets.has(url)) {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Artwork could not be loaded');
        const blob = await response.blob();
        const data = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
        ceramicExportSheets.set(url,data);
      }
      img.setAttribute('href',ceramicExportSheets.get(url));
    }
    svg.removeAttribute('class'); svg.removeAttribute('aria-hidden');
    svg.querySelectorAll('svg').forEach(node => node.setAttribute('overflow','hidden'));
    const box = svg.getAttribute('viewBox').split(' '); svg.setAttribute('width',box[2]); svg.setAttribute('height',box[3]);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));
    const link = document.createElement('a'); link.href = url; link.download = 'energy-topology.svg'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  } catch { toast('The topology could not be exported. Please try again.'); }
};

// Equipment is the home for the navigable topology; the list is an equal alternative.
function personalEquipmentLanding(site) {
  const list = state.ceramicEquipmentView === 'list';
  return personalTitle('Equipment', site ? esc(site.name) : 'Your equipment') + `<nav class="tabs" aria-label="Equipment views"><button data-med-equipment-view="topology" class="${!list?'active':''}" aria-pressed="${!list}">Topology</button><button data-med-equipment-view="list" class="${list?'active':''}" aria-pressed="${list}">List</button></nav>` + (!list && site ? siteTopology() : personalAssetsTable(availableAssets().filter(a=>a.asset_type!=='ev'&&(!site||a.site_id===site.id))));
}
const ceramicPersonalOverview = personalSiteView;
personalSiteView = function() {
  state.personalSiteTab = 'overview';
  return ceramicPersonalOverview().replace(/<nav class="tabs" aria-label="Site views">[\s\S]*?<\/nav>/,'');
};
personalAssetsTable = function(assets) {
  return `<div class="ceramic-equipment-list" aria-label="Equipment list">${assets.map(a=>`<button class="ceramic-equipment-row" data-personal-asset="${esc(a.id)}">${ceramicArt(ceramicAssetIcon(a))}<span><strong>${esc(a.name)}</strong><small>${esc(DomainForm.label(a.asset_type))}</small></span><span class="ceramic-row-spec">${esc(ceramicSpecs(a).map(([k,v])=>k+': '+v).slice(0,2).join(' · ')||peopleCatalog().sites.find(s=>s.id===a.site_id)?.name||'')}</span>${icon('right')}</button>`).join('')||'<p class="empty">No equipment associated with this site.</p>'}</div>`;
};
function ceramicGarage(list, manager = false) {
  return `<section class="ceramic-garage" aria-label="Vehicle garage">${list.map((a,i)=>`<button class="ceramic-parking-bay" ${manager?'data-open-vehicle':'data-personal-asset'}="${esc(a.id)}"><span class="ceramic-bay-number">${String(i+1).padStart(2,'0')}</span><span class="ceramic-garage-arch"><img src="/assets/mediterranean/ev-front-v2.webp" alt="" width="420" height="420"></span><span class="ceramic-car-label"><strong>${esc(a.name)}</strong><small>${a.capacity==null?'Capacity not recorded':esc(num(a.capacity))+' kWh'} · ${esc(DomainForm.label(P.assetRelation(person(),a.id)?.ownership_type||'Electric vehicle'))}</small><span>Explore vehicle ${icon('right')}</span></span></button>`).join('')||'<div class="empty">No vehicles associated with your account.</div>'}</section>`;
}
myVehicles = function() { return personalTitle('My vehicles','Your garage. Energy, charging and plans for every journey.') + ceramicGarage(availableAssets().filter(a=>a.asset_type==='ev')); };
vehicles = function() {
  if(state.vehicleDetail && ownedCommunityVehicles().some(a=>a.id===state.vehicleDetail)) return vehicleView(state.vehicleDetail);
  return title('Electric vehicles','The community garage.',button('Add vehicle','add-vehicle','plus')) + ceramicGarage(ownedCommunityVehicles(),true);
};
function ceramicVehicleEvents(id) {
  return (connection.raw.events||[]).filter(e=>(e.asset_id===id||e.type_specific_data?.vehicle_id===id)&&sessionVisible(e));
}
function ceramicCanControl(id) { return person().role==='manager'||connection.permissions.get(permissionKey('asset',id,'control'))===true; }
function ceramicVehicleSessions(a) {
  const events=ceramicVehicleEvents(a.id).slice().sort((a,b)=>new Date(b.starts_at)-new Date(a.starts_at));
  return `<section class="ceramic-vehicle-sessions"><div class="sectionhead"><div><h2>Flexibility sessions</h2><p class="subtitle">Charging requests and observed sessions linked to ${esc(a.name)}.</p></div></div>${events.map(e=>`<article class="ceramic-session-row">${ceramicArt('charger')}<div><h3>${esc(e.title||'Charging session')}</h3><p>${esc(equipmentRecord(e.asset_id)?.data.name||a.name)} · ${esc(DomainForm.label(e.mode||'Observed'))}</p><p>${esc(new Date(e.starts_at).toLocaleString('en-GB'))} — ${esc(new Date(e.ends_at).toLocaleString('en-GB'))}</p><small>${esc(flexRequirement(e))}</small></div>${e.asset_id!==a.id&&e.mode!=='forecast'&&ceramicCanControl(e.asset_id)?`<button class="btn" data-edit-session="${esc(e.event_id)}">Edit request</button>`:'<span class="muted">Observed data</span>'}</article>`).join('')||'<div class="ceramic-vehicle-empty"><h3>No sessions yet</h3><p>Plan a charging window on an available charger. Requests for this vehicle will appear here.</p></div>'}<p class="footnote">Requests describe availability and needs; they do not confirm a live charging connection. Times shown in ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}.</p></section>`;
}
vehicleView = function(id) {
  const source=(person().role==='manager'?ownedCommunityVehicles():availableAssets().filter(a=>a.asset_type==='ev')).find(a=>a.id===id);
  if(!source) return myVehicles();
  const a=completeVehicle(source), tab=state.vehicleTab||'overview';state.equipment=id;
  if(person().role!=='manager')state.personalPage='vehicles';
  const manage=person().role==='manager'||connection.permissions.get(permissionKey('asset',id,'manage'))===true;
  const canPlan=ceramicCanControl(id)&&sessionAssets().some(a=>a.asset_type==='ev_charger'&&ceramicCanControl(a.id));
  return `<div class="ceramic-vehicle-detail"><div class="equipment-breadcrumb"><button data-vehicle-back>My vehicles</button>${icon('right')}<span>${esc(a.name)}</span></div><header class="ceramic-vehicle-heading"><div><span class="ceramic-kicker">YOUR ELECTRIC VEHICLE</span><h1>${esc(a.name)}</h1></div><div class="actions">${canPlan?`<button class="btn primary" data-med-vehicle-plan="${esc(id)}">${icon('calendar')} Plan charging</button>`:''}${manage?button('Vehicle settings','edit-equipment','gear'):''}</div></header><nav class="tabs" aria-label="Vehicle sections">${[['overview','Overview'],['channels','Channels'],['sessions','Flexibility sessions']].map(([key,label])=>`<button data-med-vehicle-tab="${key}" class="${tab===key?'active':''}">${label}</button>`).join('')}</nav>${tab==='channels'?`<section><div class="sectionhead"><h2>Channels</h2>${manage?'<button class="btn" data-new-channel>Add channel</button>':''}</div>${channelTable(a)}</section>`:tab==='sessions'?ceramicVehicleSessions(a):`<section class="ceramic-vehicle-overview"><div class="ceramic-vehicle-portrait"><img src="/assets/mediterranean/ev-front-v2.webp" width="420" height="420" alt="Electric vehicle illustration"></div><div><span class="ceramic-kicker">AT A GLANCE</span><h2>Ready for your next journey.</h2>${ceramicFacts([...ceramicSpecs(a),['Linked sessions',String(ceramicVehicleEvents(id).length)]])}<p class="muted">Live charging state appears when observations are available.</p></div></section>${ceramicChartToggle('vehicle:'+id,'Battery & charging')}${ceramicCharts.has('vehicle:'+id)?tPanel(a.channels.filter(c=>c.capability_type==='sensor'),'vehicle:'+id):''}`}</div>`;
};
document.addEventListener('click',event=>{
  const view=event.target.closest('[data-med-equipment-view]');
  if(view){state.ceramicEquipmentView=view.dataset.medEquipmentView;render();}
  const tab=event.target.closest('[data-med-vehicle-tab]');
  if(tab){state.vehicleTab=tab.dataset.medVehicleTab;render();document.querySelector(`[data-med-vehicle-tab="${state.vehicleTab}"]`)?.focus({preventScroll:true});}
  const plan=event.target.closest('[data-med-vehicle-plan]');
  if(plan){const id=plan.dataset.medVehiclePlan;const ev=sessionAssets().find(a=>a.id===id&&a.asset_type==='ev');const charger=sessionAssets().find(a=>a.asset_type==='ev_charger'&&ceramicCanControl(a.id));if(ev&&charger&&ceramicCanControl(id))editSession(null,charger.id,id).catch(e=>toast(e.message));}
});
document.addEventListener('click',event=>{if(event.target.closest('[data-open-vehicle],[data-personal-asset]'))state.vehicleTab='overview';},true);
