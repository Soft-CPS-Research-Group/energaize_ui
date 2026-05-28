const BASES = {
  community: process.env.COMMUNITY_API_URL || "http://193.136.62.78:8017",
  access: process.env.ACCESS_API_URL || "http://193.136.62.78:8018",
  telemetry: process.env.TELEMETRY_API_URL || "http://193.136.62.78:8019",
  flexibility: process.env.FLEXIBILITY_API_URL || "http://193.136.62.78:8020"
};

const PASSWORD = process.env.SEED_USER_PASSWORD || "MockPass123!";

if (typeof fetch !== "function") {
  console.error("This seed script requires Node.js 18+ because it uses the built-in fetch API.");
  process.exit(1);
}

function joinUrl(base, path) {
  return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

async function request(service, path, options = {}) {
  const response = await fetch(joinUrl(BASES[service], path), {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${service} ${path} failed (${response.status}): ${text || response.statusText}`);
  }

  if (response.status === 204) return undefined;
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

async function optionalRequest(service, path, fallback) {
  try {
    return await request(service, path);
  } catch (error) {
    console.warn(`WARN ${error.message}`);
    return fallback;
  }
}

function assetName(asset) {
  return asset?.data?.name || asset?.name || "";
}

function assetSiteId(asset) {
  return asset?.data?.site_Id || asset?.data?.site_id || asset?.site_Id || asset?.site_id || "";
}

function assetType(asset) {
  return asset?.asset_type || asset?.data?.asset_type || "";
}

function assetId(asset) {
  return asset?.id;
}

function roleId(role) {
  return role?.role_id || role?.id;
}

async function ensureUser(email, name, timezone = "Europe/Lisbon") {
  const users = await request("community", "/api/users/");
  const existing = users.find((user) => user.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    console.log(`OK user ${email} (${existing.id})`);
    return existing;
  }

  const created = await request("community", "/api/users/", {
    method: "POST",
    body: { name, email, password: PASSWORD, timezone }
  });
  console.log(`CREATED user ${email} (${created.id})`);
  return created;
}

async function ensureRole(roleName, description, permissions) {
  const roles = await request("access", "/api/roles/");
  const existing = roles.find((role) => role.role_name === roleName);
  if (existing) {
    console.log(`OK role ${roleName} (${roleId(existing)})`);
    return existing;
  }

  const created = await request("access", "/api/roles/", {
    method: "POST",
    body: { role_name: roleName, description, permissions }
  });
  console.log(`CREATED role ${roleName} (${roleId(created)})`);
  return created;
}

async function ensureRec() {
  const recs = await request("community", "/api/recs/");
  const existing = recs.find((rec) => rec.name === "EnergAIze Demo REC");
  if (existing) {
    console.log(`OK REC ${existing.name} (${existing.id})`);
    return existing;
  }

  const created = await request("community", "/api/recs/", {
    method: "POST",
    body: {
      name: "EnergAIze Demo REC",
      action_frequency: "daily",
      localization: {
        name: "Porto, PT",
        latitude: 41.1579,
        longitude: -8.6291
      },
      power_limit_export: { megawatts: 5 },
      power_limit_import: { megawatts: 3 }
    }
  });
  console.log(`CREATED REC ${created.name} (${created.id})`);
  return created;
}

async function ensureSite(recId, site_type, objective_preference, label) {
  const sites = await request("community", "/api/sites/");
  const existing = sites.find(
    (site) =>
      site.assigned_rec_id === recId &&
      site.site_type === site_type &&
      site.objective_preference === objective_preference
  );
  if (existing) {
    console.log(`OK site ${label} (${existing.id})`);
    return existing;
  }

  const created = await request("community", "/api/sites/", {
    method: "POST",
    body: {
      site_type,
      objective_preference,
      assigned_rec_id: recId,
      name: label,
      location: label,
      is_community_site: site_type === "community"
    }
  });
  console.log(`CREATED site ${label} (${created.id})`);
  return created;
}

async function ensureAsset(assetPath, match, payload) {
  const assets = await request("community", "/api/assets/");
  const existing = assets.find(match);
  if (existing) {
    console.log(`OK asset ${assetName(existing)} (${assetId(existing)})`);
    return existing;
  }

  const created = await request("community", assetPath, {
    method: "POST",
    body: payload
  });
  console.log(`CREATED asset ${assetName(created)} (${assetId(created)})`);
  return created;
}

async function ensureRecMembership(userId, recId, member_type = "individual") {
  const user = await request("community", `/api/users/${userId}`);
  if ((user.rec_memberships || []).some((membership) => membership.rec_id === recId)) {
    console.log(`OK REC membership user=${userId} rec=${recId}`);
    return;
  }

  await request("community", `/api/users/${userId}/rec-memberships`, {
    method: "POST",
    body: { member_type, membership_status: "active", rec_id: recId }
  });
  console.log(`CREATED REC membership user=${userId} rec=${recId}`);
}

async function ensureSiteAccess(userId, siteId, relation) {
  const user = await request("community", `/api/users/${userId}`);
  if ((user.site_accesses || []).some((access) => access.site_id === siteId)) {
    console.log(`OK site access user=${userId} site=${siteId}`);
    return;
  }

  await request("community", `/api/users/${userId}/site-accesses`, {
    method: "POST",
    body: {
      validity_start: "2026-01-01",
      validity_end: "2027-01-01",
      relation,
      site_id: siteId
    }
  });
  console.log(`CREATED site access user=${userId} site=${siteId}`);
}

async function ensureAssetOwnership(userId, energyAssetId, ownership_type = "owned") {
  const user = await request("community", `/api/users/${userId}`);
  if ((user.asset_ownerships || []).some((ownership) => ownership.energy_asset_id === energyAssetId)) {
    console.log(`OK asset ownership user=${userId} asset=${energyAssetId}`);
    return;
  }

  await request("community", `/api/users/${userId}/asset-ownerships`, {
    method: "POST",
    body: { ownership_type, energy_asset_id: energyAssetId }
  });
  console.log(`CREATED asset ownership user=${userId} asset=${energyAssetId}`);
}

async function ensureEnergyContract(siteId) {
  const contracts = await request("community", "/api/energy-contracts/");
  const existing = contracts.find((contract) => contract.site_id === siteId) || contracts[0];
  if (existing) {
    console.log(`OK energy contract available (${existing.id})`);
    return existing;
  }

  const created = await request("community", "/api/energy-contracts/", {
    method: "POST",
    body: {
      site_id: siteId,
      grid_price: { value: 0.22 },
      carbon_weight: { value: 0.18 },
      community_buy_price: { value: 0.16 },
      community_sell_price: { value: 0.09 },
      max_power: { value: 600 },
      phase_connection_type: "three_phase",
      power_limit_import: { megawatts: 0.4 },
      power_limit_export: { megawatts: 0.2 }
    }
  });
  console.log(`CREATED energy contract site=${siteId} (${created.id})`);
  return created;
}

async function ensureTelemetryProfile(asset) {
  const profiles = await request("telemetry", "/api/telemetry-profiles/");
  let profile = profiles.find((item) => item.asset_id === assetId(asset));
  if (!profile) {
    profile = await request("telemetry", "/api/telemetry-profiles/", {
      method: "POST",
      body: { asset_id: assetId(asset), asset_type: assetType(asset) }
    });
    console.log(`CREATED telemetry profile asset=${assetId(asset)} (${profile.profile_id})`);
  } else {
    console.log(`OK telemetry profile asset=${assetId(asset)} (${profile.profile_id})`);
  }

  const capabilities = await request("telemetry", `/api/capabilities/by-profile/${profile.profile_id}`);
  const wanted = [
    { name: "active_power", description: "Active power", capability_type: "sensor", unit: "kW", data_type: "float" },
    { name: "status", description: "Operational status", capability_type: "sensor", unit: "state", data_type: "string" }
  ];

  for (const capability of wanted) {
    if (capabilities.some((item) => item.name === capability.name)) {
      console.log(`OK telemetry capability ${capability.name} profile=${profile.profile_id}`);
      continue;
    }
    try {
      await request("telemetry", "/api/capabilities/", {
        method: "POST",
        body: { profile_id: profile.profile_id, ...capability }
      });
      console.log(`CREATED telemetry capability ${capability.name} profile=${profile.profile_id}`);
    } catch (error) {
      console.warn(`WARN telemetry capability ${capability.name} skipped: ${error.message}`);
    }
  }

  return profile;
}

async function ensureCalendar(userId) {
  const calendars = await request("flexibility", `/api/calendars/by-user/${userId}`);
  const existing = calendars.find((calendar) => calendar.summary === "Prosumer availability");
  if (existing) {
    console.log(`OK calendar ${existing.summary} (${existing.calendar_id})`);
    return existing;
  }

  const created = await request("flexibility", "/api/calendars/", {
    method: "POST",
    body: {
      user_id: userId,
      summary: "Prosumer availability",
      description: "Default flexibility windows for the demo prosumer.",
      timezone: "Europe/Lisbon"
    }
  });
  console.log(`CREATED calendar ${created.summary} (${created.calendar_id})`);
  return created;
}

async function ensureEvChargingEvent(ev, charger, calendar) {
  const events = await request("flexibility", "/api/flexibility-events/");
  const existing = events.find(
    (event) => event.asset_id === assetId(ev) && event.title === "Demo managed EV charging"
  );
  if (existing) {
    console.log(`OK flexibility event ${existing.title} (${existing.event_id})`);
    return existing;
  }

  try {
    const created = await request("flexibility", "/api/flexibility-events/ev-charging", {
      method: "POST",
      body: {
        asset_id: assetId(ev),
        calendar_id: calendar.calendar_id,
        mode: "flexible",
        recurrence: { freq: "daily", interval: 1 },
        title: "Demo managed EV charging",
        description: "Managed charging between arrival and departure targets.",
        soc_at_arrival: 35,
        soc_at_departure: 85,
        charger_id: assetId(charger)
      }
    });
    console.log(`CREATED flexibility event ${created.title} (${created.event_id})`);
    return created;
  } catch (error) {
    console.warn(`WARN flexibility event skipped: ${error.message}`);
    return null;
  }
}

async function ensureFlexOffer(eventId) {
  const offers = await optionalRequest("flexibility", `/api/flex-offers/by-event/${eventId}`, []);
  if (offers.length > 0) {
    console.log(`OK flex offer event=${eventId} (${offers[0].flex_offer_id})`);
    return offers[0];
  }

  const now = new Date();
  const earliest = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const latest = new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString();
  const created = await request("flexibility", `/api/flex-offers/by-event/${eventId}`, {
    method: "POST",
    body: {
      time_flexibility: {
        earliest_start_time: earliest,
        latest_start_time: latest
      },
      energy_profiles: [
        { duration_minutes: 60, energy_min_kwh: 2.5, energy_max_kwh: 5.5 },
        { duration_minutes: 120, energy_min_kwh: 4.0, energy_max_kwh: 9.0 }
      ]
    }
  });
  console.log(`CREATED flex offer event=${eventId} (${created.flex_offer_id})`);
  return created;
}

async function main() {
  console.log("Seeding EnergAIze community backend mock data via API...");

  const [recManager, prosumer] = await Promise.all([
    ensureUser("rec@energaize.io", "REC Manager"),
    ensureUser("prosumer@energaize.io", "Prosumer")
  ]);

  await Promise.all([
    ensureRole("rec_manager", "Manage RECs, sites, assets and memberships.", [
      { action: "manage", resource_type: "rec" },
      { action: "manage", resource_type: "site" },
      { action: "manage", resource_type: "asset" }
    ]),
    ensureRole("prosumer", "View assigned sites and manage flexibility preferences.", [
      { action: "read", resource_type: "site" },
      { action: "read", resource_type: "asset" }
    ])
  ]);

  const rec = await ensureRec();
  const communitySite = await ensureSite(rec.id, "industrial", "reliability", "Shared infrastructure");
  const prosumerSite = await ensureSite(rec.id, "residential", "self_consumption", "Prosumer House 1");
  const commercialSite = await ensureSite(rec.id, "commercial", "reliability", "Commercial Pilot");

  await Promise.all([
    ensureRecMembership(recManager.id, rec.id, "organization"),
    ensureRecMembership(prosumer.id, rec.id, "individual"),
    ensureSiteAccess(prosumer.id, prosumerSite.id, "owner"),
    ensureSiteAccess(recManager.id, communitySite.id, "manager"),
    ensureSiteAccess(recManager.id, prosumerSite.id, "manager"),
    ensureSiteAccess(recManager.id, commercialSite.id, "manager"),
    ensureEnergyContract(prosumerSite.id),
    ensureEnergyContract(commercialSite.id)
  ]);

  const commonManufacturer = { name: "EnergAIze Mock", country: "PT" };
  const singlePhase = { phases: [{ index: 1 }] };
  const threePhase = { phases: [{ index: 1 }, { index: 2 }, { index: 3 }] };

  const gridMeter = await ensureAsset(
    "/api/assets/grid-meters",
    (asset) => assetName(asset) === "Demo Main Grid Meter",
    {
      name: "Demo Main Grid Meter",
      manufacturer: commonManufacturer,
      phase_connection: threePhase,
      site_Id: communitySite.id,
      meter_id: "DEMO-GM-001"
    }
  );

  const pv = await ensureAsset(
    "/api/assets/pv-systems",
    (asset) => assetName(asset) === "Demo Rooftop PV",
    {
      name: "Demo Rooftop PV",
      manufacturer: commonManufacturer,
      phase_connection: singlePhase,
      site_Id: prosumerSite.id,
      nominal_power_kw: 6,
      number_of_panels: 16,
      min_power_kw: 0,
      max_power_kw: 6,
      inverter_capacity_kw: 5.5,
      orientation: {
        azimuth_deg: 180,
        tilt_deg: 30,
        reference: "true",
        orientation_type: "fixed"
      }
    }
  );

  const battery = await ensureAsset(
    "/api/assets/batteries",
    (asset) => assetName(asset) === "Demo Home Battery",
    {
      name: "Demo Home Battery",
      manufacturer: commonManufacturer,
      phase_connection: singlePhase,
      site_Id: prosumerSite.id,
      capacity_kwh: 13.5,
      nominal_power_kw: 5,
      max_charge_kw: 5,
      max_discharge_kw: 5,
      min_charge_kw: 0,
      min_discharge_kw: 0,
      roundtrip_efficiency: 0.91,
      charging_efficiency: 0.95,
      discharging_efficiency: 0.95,
      max_state_of_charge: 95,
      min_state_of_charge: 20
    }
  );

  const charger = await ensureAsset(
    "/api/assets/ev-chargers",
    (asset) => assetName(asset) === "Demo EV Charger",
    {
      name: "Demo EV Charger",
      manufacturer: commonManufacturer,
      phase_connection: singlePhase,
      site_Id: prosumerSite.id,
      nominal_power_kw: 7.4,
      efficiency: 0.94,
      max_charging_power: 7.4,
      min_charging_power: 1.4,
      max_discharging_power: 3.6,
      plugs: ["type2"],
      serial_number: "DEMO-EVSE-001",
      charger_type: "ac"
    }
  );

  const load = await ensureAsset(
    "/api/assets/non-shiftable-loads",
    (asset) => assetName(asset) === "Demo Base Load",
    {
      name: "Demo Base Load",
      manufacturer: commonManufacturer,
      phase_connection: singlePhase,
      site_Id: commercialSite.id,
      consumption: 2.4
    }
  );

  const ev = await ensureAsset(
    "/api/assets/evs",
    (asset) => assetName(asset) === "Demo Electric Vehicle",
    {
      name: "Demo Electric Vehicle",
      manufacturer: { name: "Mock EV", country: "PT" },
      battery_capacity_kwh: 58,
      charging_efficiency: 0.92,
      discharging_efficiency: 0.88,
      max_charging_power_kw: 7.4,
      max_discharging_power_kw: 3.6,
      vin: "DEMO-EV-0001",
      vehicle_to_grid_allowed: true
    }
  );

  for (const asset of [pv, battery, charger, ev]) {
    await ensureAssetOwnership(prosumer.id, assetId(asset), "owned");
  }
  await ensureAssetOwnership(recManager.id, assetId(gridMeter), "owned");
  await ensureAssetOwnership(recManager.id, assetId(load), "owned");

  for (const asset of [gridMeter, pv, battery, charger, load, ev]) {
    await ensureTelemetryProfile(asset);
  }

  const calendar = await ensureCalendar(prosumer.id);
  const event = await ensureEvChargingEvent(ev, charger, calendar);
  if (event) {
    await ensureFlexOffer(event.event_id);
  }

  console.log("Seed complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
