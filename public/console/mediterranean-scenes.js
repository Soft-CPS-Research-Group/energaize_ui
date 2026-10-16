/* Generated architectural scenes. Coordinates are measured against the full,
   uncropped image, never a viewport. The registry matches exact device sets. */
'use strict';
const MediterraneanScenes = (() => {
  const registry = {
    'building:none': { file: 'building-none', points: {} },
    'building:battery+charger+solar': { file: 'building-solar-battery-charger', points: { solar: [50, 11], battery: [72.6, 81], charger: [89.3, 83] } },
    'factory:none': { file: 'factory-none', points: {} },
    'factory:battery+charger+solar': { file: 'factory-solar-battery-charger', points: { solar: [53, 36], battery: [76, 59.5], charger: [91.1, 65.5] } },
    'house:none': { file: 'house-none', points: {} },
    'house:solar': { file: 'house-solar', points: { solar: [44, 26] } },
    'house:battery': { file: 'house-battery', points: { battery: [68.5, 69] } },
    'house:battery+solar': { file: 'house-solar-battery', points: { solar: [49, 24], battery: [58, 71.5] } },
    'house:battery+charger+solar': { file: 'house-solar-battery-charger', points: { solar: [52, 22], battery: [64.8, 71.2], charger: [83.4, 72.5] } },
  };
  const kind = asset => ({ pv_system: 'solar', battery: 'battery', ev_charger: 'charger' }[asset.assetType || asset.asset_type] || null);
  function building(site) {
    const subtype = String(site.sourcePayload?.subtype || site.subtype || '').toLowerCase();
    const type = String(site.sourcePayload?.site_type || site.type || '').toLowerCase();
    if (type === 'industrial' || /factory|warehouse|industrial/.test(subtype)) return 'factory';
    if (/apartment|building|office|retail|commercial|store/.test(subtype) || type === 'commercial') return 'building';
    if (type === 'residential' || /house|home|residential/.test(subtype)) return 'house';
    return null;
  }
  function select(site, assets) {
    const hq = site.sourcePayload?.external_references?.some(r => r.system === 'percepta-mongo' && r.identifier === 'i-charging_headquarters_3Phase/building_i-charging_headquarters_3Phase');
    if (hq) return {file:'office-charging-hq',src:'/assets/mediterranean/office-charging-hq.webp',points:{solar:[52,10],charger:[60.5,72]},exact:false,type:'office with EV charging',signature:'charger+solar'};
    const type = building(site);
    const devices = assets.filter(a => a.sourcePayload?.lifecycle_status !== 'retired').map(kind).filter(Boolean);
    const signature = [...new Set(devices)].sort().join('+') || 'none';
    // A one-device illustration cannot represent multiple devices of that type.
    const exact = devices.length === new Set(devices).size ? registry[type + ':' + signature] : null;
    const fallback = registry[type + ':none'];
    const scene = exact || fallback;
    return scene ? { ...scene, src: '/assets/mediterranean/' + scene.file + '.webp', exact: !!exact, type, signature } : null;
  }
  return { registry, kind, building, select };
})();
