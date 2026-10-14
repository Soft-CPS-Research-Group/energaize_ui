/* Small original product illustrations. Vector geometry stays crisp in exported topology SVGs. */
"use strict";
let productArtId = 0;
function vectorProductArt(kind = "home") {
  const id = "product-" + ++productArtId,
    paint = `url(#${id})`,
    dark = "#284e49",
    accent = "#21a589",
    light = "#d8e9e7";
  const house = `<path d="M22 46 50 24 80 43v36H22z" fill="${paint}" stroke="#b6cac6"/><path class="art-roof" d="m16 47 34-28 37 25-8 7-29-22-26 24z" fill="${dark}"/><path d="M50 29v50h30V43z" fill="${light}"/><rect x="33" y="51" width="13" height="28" rx="2" fill="${accent}"/><rect x="58" y="49" width="14" height="13" rx="2" fill="#7db7bd"/><path d="M65 49v13M58 55h14" stroke="#e8fbff"/><path d="M29 81h54" stroke="#9fb9b3" stroke-width="3" stroke-linecap="round"/>`;
  const shapes = {
    pump: `<path d="M21 70h60v10H21z" fill="${dark}"/><rect x="23" y="38" width="48" height="34" rx="12" fill="${paint}" stroke="#aabfbc"/><circle cx="45" cy="55" r="12" fill="${accent}"/><path d="M71 47h14V27H70" stroke="${dark}" stroke-width="9" fill="none"/><path d="M21 51H11V37" stroke="${dark}" stroke-width="9" fill="none"/>`,
    wind: `<path d="M50 41v43M38 84h25" stroke="${dark}" stroke-width="4"/><path d="m49 37-4-27q10-4 10 9l-2 20 25 10q1 10-10 5L50 43 29 62q-9-4 1-12z" fill="${paint}" stroke="#9db9b0"/><circle cx="51" cy="40" r="5" fill="${accent}"/>`,
    device: `<rect x="24" y="22" width="53" height="59" rx="12" fill="${paint}" stroke="#aabfbc"/><rect x="33" y="32" width="35" height="22" rx="5" fill="${dark}"/><circle cx="51" cy="68" r="6" fill="${accent}"/>`,
    office: `<rect x="18" y="21" width="64" height="63" rx="5" fill="${paint}" stroke="#b6cac6"/>${[31, 48, 65].map((y) => [28, 45, 62].map((x) => `<rect x="${x}" y="${y}" width="10" height="10" rx="2" fill="#7faeaa"/>`).join("")).join("")}`,
    apartment: `<path d="M21 19h56v65H21z" fill="${paint}" stroke="#b6cac6"/><path d="M77 19 86 28v56h-9" fill="${light}"/><path d="M18 45h62M18 66h62" stroke="${dark}" stroke-width="4"/><path d="M30 27h13v13H30zM53 27h13v13H53zM30 50h13v11H30zM53 50h13v11H53z" fill="#7db7bd"/>`,
    store: `<rect x="19" y="39" width="65" height="44" fill="${paint}" stroke="#b6cac6"/><path d="m16 38 9-16h53l9 16" fill="${dark}"/><path d="M16 38h71v9H16z" fill="${accent}"/><rect x="29" y="54" width="24" height="22" fill="#8cc4c0"/><rect x="63" y="54" width="12" height="29" fill="${dark}"/>`,
    factory: `<path d="M18 43 40 31v14l22-14v14l22-14v51H18z" fill="${paint}" stroke="#b6cac6"/><path d="M23 40V15h10v20" fill="${dark}"/><path d="M28 56h10v13H28zM48 56h10v13H48zM68 56h10v13H68z" fill="${accent}"/>`,
    home: house,
    building: `<path d="M25 22h42l12 8v52H25z" fill="${paint}" stroke="#b6cac6"/><path d="M67 22 79 30v52H67z" fill="${light}"/>${[33, 49, 65].map((y) => [34, 52].map((x) => `<rect x="${x}" y="${y}" width="9" height="9" rx="2" fill="${y === 49 ? accent : "#7fa5a3"}"/>`).join("")).join("")}<path d="M44 82V68h14v14" fill="${dark}"/>`,
    community: `<g transform="translate(29 -3) scale(.72)">${house}</g><g transform="translate(2 26) scale(.72)">${house}</g>`,
    car: `<path d="m17 51 13-21q3-4 8-4h28q7 0 12 7l9 18 5 6v18H10V59z" fill="${paint}" stroke="#b4c9c5"/><path d="m28 48 10-15h25q5 0 8 4l7 11z" fill="${dark}"/><path d="M51 33v15" stroke="#d4e6e5" stroke-width="3"/><path d="M12 62h77" stroke="${light}" stroke-width="3"/><rect x="15" y="56" width="14" height="6" rx="3" fill="${accent}"/><rect x="73" y="56" width="14" height="6" rx="3" fill="${accent}"/><circle cx="28" cy="75" r="10" fill="${dark}"/><circle cx="28" cy="75" r="4" fill="#a9c2bd"/><circle cx="76" cy="75" r="10" fill="${dark}"/><circle cx="76" cy="75" r="4" fill="#a9c2bd"/>`,
    charger: `<rect x="29" y="14" width="37" height="69" rx="10" fill="${paint}" stroke="#aabfbc"/><rect x="36" y="24" width="23" height="24" rx="4" fill="${dark}"/><path d="m49 28-8 12h7l-2 6 9-12h-7z" fill="#66dcc1"/><circle cx="48" cy="64" r="6" fill="${accent}"/><path class="art-hose" d="M66 37q18-1 18 17v13q0 13-10 13" stroke="${dark}" stroke-width="5" fill="none" stroke-linecap="round"/><rect x="68" y="71" width="7" height="13" rx="2" fill="${dark}"/>`,
    appliance: `<rect x="23" y="15" width="54" height="70" rx="8" fill="${paint}" stroke="#b0c5c0"/><path d="M24 34h52" stroke="#c2d4cf"/><rect x="30" y="23" width="17" height="5" rx="2" fill="${dark}"/><circle cx="67" cy="26" r="4" fill="${accent}"/><circle cx="50" cy="58" r="19" fill="#9fbbb5"/><g class="art-drum"><circle cx="50" cy="58" r="14" fill="${dark}"/><path d="M38 59q6-7 12 0t12-1v4a13 13 0 0 1-24 0z" fill="#65c9c0"/><path d="M42 49q5-4 10-2" stroke="#d5f7f2" stroke-width="2" stroke-linecap="round" fill="none"/></g>`,
    battery: `<rect x="29" y="18" width="43" height="67" rx="9" fill="${paint}" stroke="#b0c5c0"/><rect x="39" y="13" width="22" height="5" rx="2" fill="${dark}"/><rect class="art-charge" x="38" y="29" width="24" height="8" rx="4" fill="${accent}"/><path d="m53 43-14 19h12l-3 14 17-23H53z" fill="${dark}"/>`,
    sun: `<circle class="art-sun" cx="73" cy="25" r="11" fill="#efc86d"/><path d="M26 83 33 68M73 83 67 68" stroke="${dark}" stroke-width="4"/><path d="m23 35 52 1 11 35H14z" fill="${dark}" stroke="#829f9a" stroke-width="2"/><path d="m39 36-4 34M57 36l2 34M25 47h53M20 59h62" stroke="#8fc2bd" stroke-width="1.5"/>`,
    bolt: `<rect x="26" y="16" width="48" height="69" rx="10" fill="${paint}" stroke="#acc5bd"/><path d="M28 69h44v8a6 6 0 0 1-6 6H34a6 6 0 0 1-6-6z" fill="${light}"/><rect x="33" y="26" width="34" height="24" rx="4" fill="${dark}"/><g class="art-meter" stroke="#86ead0" stroke-width="2" stroke-linecap="round"><path d="M38 32h6v10h-6zM49 32h6v10h-6zM60 32v10" fill="none"/></g><path d="M39 46h22" stroke="#729d92" stroke-width="1.5"/><circle cx="39" cy="59" r="2.5" fill="${accent}"/><circle cx="61" cy="59" r="3.5" fill="#b2c9c2"/><path d="M37 73v5M46 73v5M55 73v5M64 73v5" stroke="${dark}" stroke-width="3" stroke-linecap="round"/>`,
    network: `<path d="m49 15-24 69M49 15l27 69M38 46h23M31 65h37M25 84l36-38M76 84 38 46M35 32h29M28 47h43" fill="none" stroke="${dark}" stroke-width="4" stroke-linejoin="round"/><path class="art-grid" d="M24 46v13M73 46v13M31 31v9M68 31v9" stroke="${accent}" stroke-width="3"/>`,
    heat: `<rect x="19" y="25" width="65" height="54" rx="8" fill="${paint}" stroke="#b0c5c0"/><circle cx="44" cy="51" r="19" fill="${dark}"/><g fill="#9fd4c7"><path d="M44 49q-17-15-15-1 2 9 15 4zM46 49q15-17 1-15-9 2-4 15zM46 53q17 15 15 1-2-9-15-4zM42 53q-15 17-1 15 9-2 4-15z"/></g><path d="M70 38h7M70 45h7M70 52h7M70 59h7" stroke="#9ab6ac" stroke-width="2"/>`,
  };
  return `<svg class="product-art" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff"/><stop offset="1" stop-color="#e2eeea"/></linearGradient></defs><ellipse cx="51" cy="87" rx="35" ry="5" fill="#173f36" opacity=".08"/>${shapes[kind] || shapes.home}</svg>`;
}
function productArt(kind) { return vectorProductArt(kind); }

function siteIllustration(value) {
  return (
    {
      residential: "home",
      commercial: "office",
      industrial: "factory",
      utility: "network",
      detached_house: "home",
      semi_detached_house: "community",
      apartment: "apartment",
      apartment_building: "building",
      office: "office",
      retail: "store",
      hotel: "building",
      restaurant: "store",
      school: "office",
      healthcare: "office",
      factory: "factory",
      warehouse: "factory",
      agriculture: "home",
      generation: "sun",
      storage: "battery",
      charging_hub: "charger",
      water_facility: "pump",
    }[value] || "home"
  );
}
const illustratedSymbol = symbolNode;
symbolNode = function (cx, cy, label, ic, act, primary = false) {
  const site =
    act[0] === "site"
      ? scoped().find((s) => s.id === act[1])
      : primary && state.site
        ? chosen()
        : null;
  if (site?.photo) return illustratedSymbol(cx, cy, label, ic, act, primary);
  const asset =
    act[0] === "asset" ? currentAssets().find((a) => a.id === act[1]) : null;
  const kind = asset
    ? {
        ev_charger: "charger",
        appliance: "appliance",
        heat_pump: "heat",
        heater: "heat",
        pv_system: "sun",
        grid_meter: "bolt",
        ev: "car",
        battery: "battery",
        water_pump: "pump",
        micro_wind_turbine: "wind",
        thermal_storage: "heat",
        generic_device: "device",
        non_shiftable_load: "device",
      }[asset.assetType || asset.asset_type] || "device"
    : site
      ? siteIllustration(
          site.sourcePayload?.subtype ||
            site.sourcePayload?.site_type ||
            site.type,
        )
      : ic === "tree"
        ? "community"
        : ic;
  const words = String(label).split(/\s+/),
    lines = [""];
  for (const word of words) {
    const i = lines.length - 1;
    if (lines[i] && (lines[i] + " " + word).length > 22) lines.push(word);
    else lines[i] += (lines[i] ? " " : "") + word;
  }
  const visible = lines.slice(0, 2);
  if (lines.length > 2) visible[1] = visible[1].slice(0, 20) + "…";
  return `<g class="symbol-node product-node" role="button" tabindex="0" aria-label="${esc(label)}" data-${act[0]}="${esc(act[1])}" transform="translate(${cx} ${cy})"><g transform="translate(-42 -45)">${vectorProductArt(kind).replace('viewBox="0 0 100 100"', 'width="84" height="84" viewBox="0 0 100 100"')}</g><text x="0" y="54" text-anchor="middle" class="symbol-name">${visible.map((line, i) => `<tspan x="0" dy="${i ? 18 : 0}">${esc(line)}</tspan>`).join("")}</text></g>`;
};
