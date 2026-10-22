/* One-off availability requests, edited in a central wizard. The API remains the
   authority for eligibility, ownership and equipment constraints. */
"use strict";
paths.left = "m15 5-7 7 7 7";
paths.appliance =
  "M5 3h14v18H5z M5 7h14 M8 5h.01 M11 5h.01 M16 5h.01 M16 14a4 4 0 1 1-8 0 4 4 0 0 1 8 0z";
const FlexCalendar = {
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  day: null,
};
const flexDay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const flexKinds = {
  ev_charger: ["EV charging", "car", "Ready for your next journey"],
  appliance: ["Appliance", "appliance", "Finish a cycle when you need it"],
  heat_pump: ["Heat pump", "heat", "Set your comfort window"],
  heater: ["Heater", "heat", "Keep your space comfortable"],
  water_pump: ["Water pump", "pump", "Choose running time and availability"],
};
function flexDayEvents(events, key) {
  const start = new Date(key + "T00:00:00"),
    end = new Date(start);
  end.setDate(end.getDate() + 1);
  return events
    .filter(
      (e) =>
        e.starts_at &&
        e.ends_at &&
        new Date(e.starts_at) < end &&
        new Date(e.ends_at) > start,
    )
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
}
function flexRequirement(e) {
  const d = e.type_specific_data || {};
  return e.session_type === "ev_charging"
    ? "At least " +
        Number(d.soc_at_departure * 100).toLocaleString("en-GB", {
          maximumFractionDigits: 1,
        }) +
        "% at departure"
    : e.session_type === "appliance"
      ? (d.cycle_snapshot?.name ? d.cycle_snapshot.name + ' · ' : '') + (d.duration_minutes
        ? d.duration_minutes + " minute cycle"
        : "Saved equipment cycle")
      : e.session_type === 'water_pump'
        ? d.duration_minutes ? `${Math.floor(d.duration_minutes / 60) ? Math.floor(d.duration_minutes / 60) + ' h ' : ''}${d.duration_minutes % 60 ? d.duration_minutes % 60 + ' min ' : ''}total running time`.trim() : 'Choose the required running time'
      : "Target " +
        d.setpoint +
        " °C";
}
sessionsView = function () {
  const month = FlexCalendar.month,
    sourceEvents = connection.raw.events.filter(sessionVisible),
    first = new Date(month.getFullYear(), month.getMonth(), 1),
    start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const rangeEnd = new Date(start);
  rangeEnd.setDate(rangeEnd.getDate() + 42);
  const events = window.FlexRecurrence
    ? window.FlexRecurrence.expand(sourceEvents, start, rangeEnd)
    : sourceEvents;
  const selected = FlexCalendar.day || flexDay(new Date()),
    dayEvents = flexDayEvents(events, selected),
    label = month.toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
    });
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = flexDay(d),
      items = flexDayEvents(events, key);
    return `<div class="flex-day ${d.getMonth() !== month.getMonth() ? "outside" : ""} ${key === selected ? "selected" : ""} ${key === flexDay(new Date()) ? "today" : ""}"><button class="flex-day-pick" data-flex-day="${key}" aria-label="${d.toLocaleDateString("en-GB", { dateStyle: "full" })}, ${items.length} plans" aria-pressed="${key === selected}"><span>${d.getDate()}</span>${items.length ? `<small>${items.length} plan${items.length === 1 ? "" : "s"}</small>` : ""}</button><div class="flex-day-events">${items
      .slice(0, 2)
      .map(
        (e) =>
          `<button ${e.mode === "forecast" ? `data-flex-day="${flexDay(new Date(e.starts_at))}"` : `data-edit-session="${esc(e.event_id)}"`} class="calendar-event ${e.mode === "forecast" ? "forecast" : ""}" title="${esc(e.title)} · ${e.mode === "forecast" ? "Automatic forecast" : e.mode === "recurrent" ? "Recurring request" : "One-off request"}">${e.mode === "forecast" ? "◌ " : e.mode === "recurrent" ? "↻ " : ""}${esc(e.title)}</button>`,
      )
      .join(
        "",
      )}${items.length > 2 ? `<button data-flex-day="${key}">+${items.length - 2} more</button>` : ""}</div></div>`;
  }).join("");
  return (
    title(
      "Flexibility",
      person().role === "manager"
        ? "Plan equipment availability across your community."
        : "Choose when your equipment is available.",
      button("New request", "new-session", "plus", true),
    ) +
    `<div class="flex-calendar-key"><span>● One-off</span><span>↻ Recurring</span><span>◌ Automatic forecast</span></div><div class="flex-planner"><section class="flex-calendar" aria-label="Flexibility calendar"><header><h2>${label}</h2><div class="actions"><button class="btn text" data-flex-month="today">Today</button><button class="icon-btn" aria-label="Previous month" data-flex-month="-1">${icon("left")}</button><button class="icon-btn" aria-label="Next month" data-flex-month="1">${icon("right")}</button></div></header><div class="flex-weekdays">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((v) => `<span>${v}</span>`).join("")}</div><div class="flex-days">${cells}</div></section><aside class="flex-agenda"><div class="eyebrow">SELECTED DAY</div><h2>${new Date(selected + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}</h2>${dayEvents.length ? dayEvents.map((e) => `<article class="flex-agenda-item"><span class="flex-agenda-icon">${icon(flexKinds[equipmentRecord(e.asset_id)?.asset_type]?.[1] || "clock")}</span><div><button ${e.mode === "forecast" ? `data-flex-day="${flexDay(new Date(e.starts_at))}"` : `data-edit-session="${esc(e.event_id)}"`}><strong>${esc(e.title)}</strong></button><p>${esc(equipmentRecord(e.asset_id)?.data.name || "Equipment")}</p><p>${esc(new Date(e.starts_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))} — ${esc(new Date(e.ends_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</p><small>${esc(flexRequirement(e))}</small>${e.mode === "forecast" ? "<small>Automatic forecast · supplied by the system</small>" : ""}${e.mode === "recurrent" ? "<small>Recurring request · editing changes the series</small>" : ""}<div class="actions" ${e.mode === "forecast" ? "hidden" : ""}><button class="btn text" ${e.mode === "forecast" ? `data-flex-day="${flexDay(new Date(e.starts_at))}"` : `data-edit-session="${esc(e.event_id)}"`}>Edit</button>${equipmentRecord(e.asset_id)?.asset_type !== "ev" ? `<button class="btn text" data-cancel-session="${esc(e.event_id)}">Cancel request</button>` : ""}</div></div></article>`).join("") : `<div class="flex-day-empty">${icon("clock")}<h3>No plans for this day</h3><p>Add a charging request or make time for an appliance cycle.</p></div>`}<button class="btn primary" data-flex-add="${selected}">${icon("plus")} Plan something</button><p class="footnote">Requests describe your needs. They do not confirm equipment execution.</p></aside></div>${sourceEvents.some((e) => !e.starts_at || !e.ends_at) ? '<p class="notice">Some legacy requests have no scheduled dates and cannot appear on the calendar.</p>' : ""}`
  );
};
document.addEventListener("click", (e) => {
  const b = e.target.closest(
    "[data-flex-day],[data-flex-month],[data-flex-add]",
  );
  if (!b) return;
  if (b.dataset.flexDay) {
    FlexCalendar.day = b.dataset.flexDay;
    render();
  }
  if (b.dataset.flexMonth) {
    if (b.dataset.flexMonth === "today") {
      FlexCalendar.month = new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        1,
      );
      FlexCalendar.day = flexDay(new Date());
    } else {
      FlexCalendar.month = new Date(
        FlexCalendar.month.getFullYear(),
        FlexCalendar.month.getMonth() + Number(b.dataset.flexMonth),
        1,
      );
      FlexCalendar.day = flexDay(FlexCalendar.month);
    }
    render();
  }
  if (b.dataset.flexAdd) {
    FlexCalendar.day = b.dataset.flexAdd;
    editSession().catch((e) => toast(e.message));
  }
});
editSession = async function (id = null, assetId = null, vehicleId = null, occurrence = null) {
  const sourceEvent = id
    ? connection.raw.events.find((e) => e.event_id === id)
    : null;
  const event = occurrence && sourceEvent ? { ...sourceEvent, ...occurrence, mode: 'punctual', recurrence: null } : sourceEvent;
  if (event && !sessionVisible(event)) return;
  if (event?.mode === "forecast") {
    toast("Automatic forecasts are supplied by the system.");
    return;
  }
  if (equipmentRecord(event?.asset_id || assetId)?.asset_type === "ev") {
    toast(
      "Vehicle sessions come from observed data. Create a flexibility request on a charger.",
    );
    return;
  }
  const assets = sessionAssets().filter(
    (a) =>
      flexKinds[a.asset_type] &&
      (person().role === "manager" ||
        connection.permissions.get(permissionKey("asset", a.id, "control"))),
  );
  if (!assets.length) {
    toast(
      "No controllable equipment is assigned to you. Your manager can associate a charger or appliance.",
    );
    return;
  }
  const selected =
    assets.find((a) => a.id === (event?.asset_id || assetId)) || assets[0];
  if ((event || assetId) && selected.id !== (event?.asset_id || assetId)) {
    toast("This equipment is not available to your account.");
    return;
  }
  const defs = await operationSchemas("flexibility");
  let asset = selected,
    kind = null,
    editor = null,
    step = event || assetId ? 1 : 0,
    busy = false,
    buildVersion = 0;
  const drafts = new Map();
  let originalInputs = {};
  const day = FlexCalendar.day || flexDay(new Date());
  let start = new Date(day + "T18:00:00");
  if (day === flexDay(new Date()) && start < new Date())
    start = new Date(Math.ceil(Date.now() / 3600000) * 3600000);
  const end = new Date(start.getTime() + 7200000);
  const steps = ["Equipment", "Your needs", "Review"];
  drawer(
    occurrence ? "Edit this occurrence" : event ? "Edit request" : "New request",
    `<ol class="wizard-steps">${steps.map((s, i) => `<li><button type="button" data-flex-step="${i}" disabled><span>${i + 1}</span>${s}</button></li>`).join("")}</ol><div class="flex-request-body"><section data-flex-panel="0"><h3>What would you like to plan?</h3><p class="subtitle">Choose the equipment you want to make available.</p><div class="flex-type-choices">${Object.entries(
      flexKinds,
    )
      .filter(([key]) => assets.some((a) => a.asset_type === key))
      .map(
        ([key, [name, glyph, note]]) =>
          `<button type="button" data-flex-kind="${key}" aria-pressed="${asset.asset_type === key}"><span class="flex-type-art">${productArt(glyph)}</span><strong>${name}</strong><small>${note}</small></button>`,
      )
      .join(
        "",
      )}</div><div data-flex-equipment></div></section><section data-flex-panel="1"><div class="flex-request-identity"><span data-flex-glyph></span><div><h3 data-flex-name></h3><p class="subtitle">${event?.mode === "recurrent" ? "Changes apply to every occurrence in this series." : "Choose your time window and target."}</p></div></div><div data-flex-fields></div><div class="repeat-plan"><label>Repeat<select data-repeat><option value="">Does not repeat</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select></label><div data-repeat-options hidden><label>Every<input data-repeat-interval type="number" min="1" max="365" value="1"></label><label>Ends<select data-repeat-end><option value="count">After a number of occurrences</option><option value="until">On a date</option><option value="never">No end date</option></select></label><label data-count-label>Occurrences<input data-repeat-count type="number" min="1" max="365" value="12" required></label><label data-until-label hidden>Last day<input data-repeat-until type="date"></label><div data-repeat-days hidden>${["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map((d, i) => `<label><input type="checkbox" data-repeat-day="${d}">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]}</label>`).join("")}</div><small>Including the first request. Times follow the request’s time zone.</small></div></div><p class="footnote">Times shown in ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}.</p></section><section data-flex-panel="2"><h3>Ready to save your plan?</h3><dl class="definition-list" data-flex-review></dl><p class="footnote">You can come back to the calendar to edit or cancel this request.</p></section></div><p role="alert" class="wizard-error" hidden></p><footer class="wizard-footer"><button type="button" class="btn text" data-action="close">Cancel</button><div class="actions"><button type="button" class="btn" data-flex-back>Back</button><button type="submit" class="btn primary" data-flex-next>Continue</button></div></footer>`,
    "",
    submit,
  );
  const modal = overlay.querySelector(".drawer"),
    form = modal.querySelector("form"),
    error = modal.querySelector(".wizard-error");
  modal.classList.add("equipment-wizard", "flex-request");
  modal.parentElement.classList.add("wizard-backdrop");
  form.noValidate = true;
  const repeat = modal.querySelector("[data-repeat]");
  if (occurrence) modal.querySelector('.repeat-plan').hidden = true;
  let recurrenceChanged = false;
  repeat.value = event?.recurrence?.freq || "";
  modal.querySelector("[data-repeat-interval]").value =
    event?.recurrence?.interval || 1;
  modal.querySelector("[data-repeat-count]").value =
    event?.recurrence?.count || 12;
  modal.querySelector("[data-repeat-end]").value = event?.recurrence?.until
    ? "until"
    : event?.recurrence && !event.recurrence.count
      ? "never"
      : "count";
  modal.querySelector("[data-repeat-until]").value = event?.recurrence?.until
    ? flexDay(new Date(event.recurrence.until))
    : "";
  for (const n of modal.querySelectorAll("[data-repeat-day]"))
    n.checked = (event?.recurrence?.by_day || "")
      .split(",")
      .includes(n.dataset.repeatDay);
  function repeatState() {
    const ending = modal.querySelector("[data-repeat-end]").value;
    modal.querySelector("[data-repeat-options]").hidden = !repeat.value;
    modal.querySelector("[data-count-label]").hidden = ending !== "count";
    modal.querySelector("[data-repeat-count]").disabled = ending !== "count";
    modal.querySelector("[data-until-label]").hidden = ending !== "until";
    modal.querySelector("[data-repeat-until]").disabled = ending !== "until";
    modal.querySelector("[data-repeat-until]").required = ending === "until";
    modal.querySelector("[data-repeat-days]").hidden =
      repeat.value !== "WEEKLY";
  }
  repeatState();
  modal.querySelector(".repeat-plan").addEventListener("change", () => {
    recurrenceChanged = true;
    repeatState();
  });
  function repetition() {
    if (event && !recurrenceChanged)
      return { mode: event.mode, recurrence: event.recurrence };
    return {
      mode: repeat.value ? "recurrent" : "punctual",
      recurrence: repeat.value
        ? {
            freq: repeat.value,
            interval: Number(
              modal.querySelector("[data-repeat-interval]").value,
            ),
            ...(modal.querySelector("[data-repeat-end]").value === "count"
              ? {
                  count: Number(
                    modal.querySelector("[data-repeat-count]").value,
                  ),
                }
              : {}),
            ...(modal.querySelector("[data-repeat-end]").value === "until"
              ? {
                  until: new Date(
                    modal.querySelector("[data-repeat-until]").value +
                      "T23:59:59",
                  ).toISOString(),
                }
              : {}),
            ...(repeat.value === "WEEKLY" &&
            modal.querySelector("[data-repeat-day]:checked")
              ? {
                  by_day: [
                    ...modal.querySelectorAll("[data-repeat-day]:checked"),
                  ]
                    .map((n) => n.dataset.repeatDay)
                    .join(","),
                }
              : {}),
          }
        : null,
    };
  }
  function pick() {
    const matching = assets.filter((a) => a.asset_type === asset.asset_type);
    modal.querySelector("[data-flex-equipment]").hidden = matching.length === 1;
    modal.querySelector("[data-flex-equipment]").innerHTML = formSelect(
      "equipment",
      matching.map((a) => [a.id, a.data.name]),
      asset.id,
    );
    modal.querySelector('[name="equipment"]').onchange = (e) => {
      if (editor) drafts.set(asset.id, editor.read());
      asset = assets.find((a) => a.id === e.target.value);
      editor = null;
    };
    modal
      .querySelectorAll("[data-flex-kind]")
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String(b.dataset.flexKind === asset.asset_type),
        ),
      );
  }
  async function build() {
    const version = ++buildVersion;
    busy = true;
    show();
    try {
      const allowed = await B.request(
        "flexibility",
        "/api/flexibility-events/available-types/" + asset.id,
      );
      if (version !== buildVersion || !modal.isConnected) return;
      kind = event?.session_type || allowed.session_types[0];
      if (!kind || !allowed.session_types.includes(kind))
        throw Error("This equipment does not support this request.");
      const schema =
        defs[Operations.sessions[kind][1] + (event ? "Update" : "Create")];
      const value =
        drafts.get(asset.id) ||
        (event
          ? { ...event, ...event.type_specific_data }
          : {
              starts_at: start.toISOString(),
              ends_at: end.toISOString(),
              soc_at_departure: 0.8,
              ...(vehicleId && kind === "ev_charging" && sessionAssets().some(a => a.id === vehicleId && a.asset_type === "ev") ? { vehicle_id: vehicleId } : {}),
              duration_minutes: 60,
            });
      const keys = [
        "starts_at",
        "ends_at",
        ...(kind === "ev_charging"
          ? occurrence ? ["soc_at_departure"] : ["soc_at_departure", "soc_at_arrival", "vehicle_id"]
          : kind === "appliance"
            ? ["selected_power_profile"]
            : kind === 'water_pump' ? ['duration_minutes']
            : ["setpoint"]),
      ];
      const properties = Object.fromEntries(
        keys
          .filter((k) => schema.properties[k])
          .map((k) => [k, schema.properties[k]]),
      );
      editor = DomainForm.build(
        {
          ...schema,
          properties,
          required: [
            "starts_at",
            "ends_at",
            ...(kind === "ev_charging"
              ? ["soc_at_departure"]
              : kind === "appliance"
                ? ['selected_power_profile']
                : kind === 'water_pump' ? ['duration_minutes']
                : ["setpoint"]),
          ],
        },
        value,
        defs,
        {
          order: keys,
          choices: {
            vehicle_id: sessionAssets()
              .filter((a) => a.asset_type === "ev")
              .map((a) => [a.id, a.data.name]),
            selected_power_profile: [
              ...(asset.data.power_profiles || []).map(p => [p.id, p.name]),
              ...(event?.type_specific_data?.selected_power_profile && !(asset.data.power_profiles || []).some(p => p.id === event.type_specific_data.selected_power_profile)
                ? [[event.type_specific_data.selected_power_profile, event.type_specific_data.cycle_snapshot?.name || 'Saved cycle']] : []),
            ],
          },
        },
        "",
        true,
      );
      const departureTime = editor.node.querySelector('[data-field="ends_at"]');
      const departureLabel = departureTime?.closest('.domain-field')?.querySelector('.formlabel');
      if (departureLabel) departureLabel.firstChild.textContent = 'Ready by *';
      originalInputs = editor.read();
      modal.querySelector("[data-flex-fields]").replaceChildren(editor.node);
      const needText = modal.querySelector('[data-flex-name]').parentElement.querySelector('.subtitle');
      needText.textContent = kind === 'appliance' ? 'Choose a cycle saved on this machine and when it can run.'
        : kind === 'water_pump' ? 'Choose how long the pump needs to run within the available window.'
        : ['heat_pump','electric_heater'].includes(kind) ? 'Choose when you need comfort and your target temperature.'
        : 'Choose when the car is available and the charge you need at departure.';
      if (kind === 'appliance') {
        const cycle = editor.node.querySelector('[data-field="selected_power_profile"]');
        if (cycle) cycle.closest('.domain-field').querySelector('.formlabel').firstChild.textContent = 'Cycle *';
        const summary = document.createElement('p'); summary.className = 'footnote'; summary.setAttribute('aria-live', 'polite');
        const update = () => {
          const details = requestDetails();
          summary.textContent = details.duration_minutes ? `${details.duration_minutes} minutes. The cycle settings come from the equipment.` : 'No cycle is selected. Configure the machine’s cycles in Equipment first.';
        };
        cycle?.addEventListener('change', update); editor.node.append(summary); update();
        if (!(asset.data.power_profiles || []).length) {
          const setup = document.createElement('button'); setup.type = 'button'; setup.className = 'btn'; setup.textContent = 'Set up equipment cycles';
          setup.onclick = () => editEquipment(asset.id).catch(e => toast(e.message)); editor.node.append(setup);
        }
      }
      if (kind === 'water_pump') {
        const duration = editor.node.querySelector('[data-field="duration_minutes"]');
        duration.closest('.domain-field').hidden = true;
        const runtime = document.createElement('fieldset'); runtime.className = 'pump-runtime-fields';
        runtime.innerHTML = `<legend>Required running time</legend><label>Hours<input type="number" data-runtime-hours min="0" step="1" required value="${Math.floor(Number(value.duration_minutes || 0) / 60)}"></label><label>Minutes<input type="number" data-runtime-minutes min="0" max="59" step="1" required value="${Number(value.duration_minutes || 0) % 60}"></label>`;
        runtime.addEventListener('input', () => { duration.value = Number(runtime.querySelector('[data-runtime-hours]').value) * 60 + Number(runtime.querySelector('[data-runtime-minutes]').value); });
        editor.node.append(runtime);
      }
      const timeSummary = document.createElement('p');
      timeSummary.className = 'ceramic-time-summary';
      timeSummary.setAttribute('aria-live','polite');
      const arrivalTime = editor.node.querySelector('[data-field="starts_at"]');
      if (['heat_pump','electric_heater'].includes(kind)) {
        arrivalTime.closest('.domain-field').querySelector('.formlabel').firstChild.textContent = 'Comfort needed from *';
        if (departureLabel) departureLabel.firstChild.textContent = 'Comfort needed until *';
      } else if (kind === 'water_pump' && departureLabel) departureLabel.firstChild.textContent = 'Available until *';
      const updateTimeSummary = () => {
        const from = new Date(arrivalTime?.value), until = new Date(departureTime?.value);
        const format = new Intl.DateTimeFormat('en-GB', {weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});
        timeSummary.textContent = Number.isFinite(+from) && Number.isFinite(+until) ? format.format(from) + ' → ' + format.format(until) : 'Choose your availability window.';
      };
      [arrivalTime,departureTime].forEach(input => input?.addEventListener('input',updateTimeSummary));
      updateTimeSummary();
      editor.node.append(timeSummary);
      const soc = editor.node.querySelector('[data-field="soc_at_departure"]');
      if (soc) {
        const hero = document.createElement("div");
        hero.className = "charge-target";
        hero.innerHTML = `${productArt("car")}<div><span>Minimum departure charge</span><strong data-charge-label></strong><input type="range" min="0" max="100" step="1" aria-label="Minimum departure charge"><small>The minimum charge you need when you leave.</small></div>`;
        const slider = hero.querySelector("input"),
          output = hero.querySelector("[data-charge-label]");
        const sync = () => {
          slider.value = soc.value;
          output.textContent = soc.value + "%";
        };
        slider.oninput = () => {
          soc.value = slider.value;
          sync();
        };
        soc.addEventListener("input", sync);
        sync();
        const exact = soc.closest(".domain-field");
        exact.classList.add("charge-exact");
        exact.hidden = true;
        soc.tabIndex = -1;
        soc.setAttribute("aria-hidden", "true");
        hero.querySelector("div").append(exact);
        editor.node.prepend(hero);
      }
      if (kind === "ev_charging") {
        const optional = document.createElement("details");
        optional.className = "request-optional";
        optional.innerHTML =
          '<summary>Arrival charge & vehicle <span>Optional</span></summary><div class="optional-fields"></div>';
        for (const key of ["soc_at_arrival", "vehicle_id"]) {
          const input = editor.node.querySelector(`[data-field="${key}"]`);
          if (input) {
            optional
              .querySelector("div")
              .append(input.closest(".domain-field"));
            if (input.value) optional.open = true;
          }
        }
        editor.node.querySelector(".domain-object").append(optional);
      }
      const setpoint = editor.node.querySelector('[data-field="setpoint"]');
      if (setpoint)
        setpoint.labels[0].firstChild.textContent =
          "Target temperature (°C) *";
      modal.querySelector("[data-flex-name]").textContent = asset.data.name;
      modal.querySelector("[data-flex-glyph]").innerHTML = productArt(
        flexKinds[asset.asset_type][1],
      );
    } catch (e) {
      error.hidden = false;
      error.textContent = e.message;
      editor = null;
    } finally {
      busy = false;
      if (modal.isConnected) show();
    }
  }
  function requestDetails() {
    const data = editor.read();
    if (kind !== 'appliance') return data;
    const saved = event?.type_specific_data;
    const cycle = saved?.selected_power_profile === data.selected_power_profile && saved?.duration_minutes
      ? (saved.cycle_snapshot || {name: 'Saved cycle', duration_minutes: saved.duration_minutes})
      : (asset.data.power_profiles || []).find(p => p.id === data.selected_power_profile);
    return {...data, duration_minutes: cycle?.duration_minutes, cycle_snapshot: cycle};
  }
  function show() {
    modal
      .querySelectorAll("[data-flex-panel]")
      .forEach((p, i) => (p.hidden = i !== step));
    modal.querySelectorAll("[data-flex-step]").forEach((b, i) => {
      b.disabled = busy || i >= step || (!!event && i === 0);
      b.setAttribute("aria-current", i === step ? "step" : "false");
      b.classList.toggle("is-complete", i < step);
    });
    modal.querySelector("[data-flex-back]").hidden = step === (event ? 1 : 0);
    modal.querySelector("[data-flex-back]").disabled = busy;
    const next = modal.querySelector("[data-flex-next]");
    next.disabled = busy || (step === 1 && !editor);
    next.textContent = busy
      ? "Please wait…"
      : step === 2
        ? "Save request"
        : "Continue";
    if (step === 2) {
      const d = requestDetails();
      modal.querySelector("[data-flex-review]").innerHTML = [
        ["Equipment", asset.data.name],
        [
          "Schedule",
          occurrence ? 'This occurrence only' : repetition().mode === "recurrent"
            ? `Recurring · ${repetition().recurrence.freq.toLowerCase()}${repetition().recurrence.count ? " · " + repetition().recurrence.count + " occurrences" : ""}`
            : "One-off request",
        ],
        ["Available from", new Date(d.starts_at).toLocaleString("en-GB")],
        ["Available until", new Date(d.ends_at).toLocaleString("en-GB")],
        [
          "Requirement",
          flexRequirement({ session_type: kind, type_specific_data: d }),
        ],
        ...(d.soc_at_arrival != null
          ? [["Arrival charge", Math.round(d.soc_at_arrival * 100) + "%"]]
          : []),
        ...(d.vehicle_id
          ? [
              [
                "Vehicle",
                equipmentRecord(d.vehicle_id)?.data.name || "Selected vehicle",
              ],
            ]
          : []),
      ]
        .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
        .join("");
    }
  }
  function valid() {
    for (const input of modal
      .querySelector("[data-flex-fields]")
      .querySelectorAll("input,select,textarea"))
      if (!input.disabled && !input.closest('.domain-field[hidden]') && !input.checkValidity()) {
        const details = input.closest("details");
        if (details) details.open = true;
        input.reportValidity();
        return false;
      }
    if (repeat.value && (recurrenceChanged || !event))
      for (const input of modal.querySelectorAll("[data-repeat-options] input"))
        if (!input.disabled && !input.checkValidity()) {
          input.reportValidity();
          return false;
        }
    const d = requestDetails();
    const recurring = repetition();
    if (
      recurring.recurrence?.until &&
      Date.parse(recurring.recurrence.until) < Date.parse(d.starts_at)
    )
      throw Error("The last day must be on or after the first request.");
    if (Date.parse(d.ends_at) <= Date.parse(d.starts_at))
      throw Error("Choose an end time after the start.");
    if (
      kind === "appliance" &&
      !d.selected_power_profile
    )
      throw Error("Choose a cycle registered on this equipment.");
    if (kind === 'water_pump' && (!Number.isInteger(d.duration_minutes) || d.duration_minutes <= 0))
      throw Error('Choose a positive running time in hours and minutes.');
    if (
      d.duration_minutes &&
      d.duration_minutes * 60000 >
        Date.parse(d.ends_at) - Date.parse(d.starts_at)
    )
      throw Error(kind === 'water_pump' ? 'The required running time must fit inside the available window.' : 'The selected cycle needs to fit inside the available window.');
    return true;
  }
  async function submit() {
    if (busy) return;
    error.hidden = true;
    try {
      if (step === 0) {
        if (editor) drafts.set(asset.id, editor.read());
        step = 1;
        await build();
        return;
      }
      if (!valid()) return;
      if (step === 1) {
        step = 2;
        show();
        return;
      }
      busy = true;
      show();
      await checkPermission("asset", asset.id, "control");
      let payload = editor.read();
      if (payload.vehicle_id)
        await checkPermission("asset", payload.vehicle_id, "control");
      if (event) {
        payload = DomainForm.diff(originalInputs, payload);
        if (recurrenceChanged) Object.assign(payload, repetition());
        if (!occurrence) payload.expected_revision = sourceEvent.revision;
      } else {
        payload = {
          ...payload,
          title: asset.data.name + " request",
          description: "",
          asset_id: asset.id,
          ...repetition(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...(kind === "ev_charging" ? { charger_id: asset.id } : {}),
        };
      }
      if (occurrence) {
        if (!Object.keys(payload).length) { closeDrawer(); return; }
        await B.request('flexibility', '/api/flexibility/events/' + event.event_id + '/exceptions', 'PUT', {
          ...payload, occurrence_at: occurrence.occurrence_at, action: 'modify',
          expected_event_revision: sourceEvent.revision, expected_exception_revision: occurrence.exception_revision || 0,
        });
      } else await B.request(
        "flexibility",
        "/api/flexibility-events/" +
          Operations.sessions[kind][0] +
          (event ? "/" + event.event_id : ""),
        event ? "PATCH" : "POST",
        payload,
      );
      closeDrawer();
      try {
        await loadBackend();
        toast("Request saved.");
      } catch (e) {
        toast("Request saved. Reload the calendar to see it.");
      }
    } catch (e) {
      busy = false;
      error.hidden = false;
      error.textContent = e.message;
      show();
    }
  }
  modal.querySelectorAll("[data-flex-kind]").forEach(
    (b) =>
      (b.onclick = () => {
        if (busy) return;
        if (editor) drafts.set(asset.id, editor.read());
        asset = assets.find((a) => a.asset_type === b.dataset.flexKind);
        editor = null;
        pick();
      }),
  );
  modal.querySelector("[data-flex-back]").onclick = () => {
    step--;
    show();
  };
  modal.querySelectorAll("[data-flex-step]").forEach(
    (b, i) =>
      (b.onclick = () => {
        if (!busy && i < step) {
          step = i;
          show();
        }
      }),
  );
  pick();
  show();
  if (step === 1) await build();
};

const editableCancelSession = cancelSession;
cancelSession = async function (id) {
  const e = connection.raw.events.find((e) => e.event_id === id);
  if (e?.mode === "forecast") {
    toast("Automatic forecasts are supplied by the system.");
    return;
  }
  await editableCancelSession(id);
  if (e?.mode === "recurrent") {
    const p = overlay.querySelector(".drawer form > p");
    if (p)
      p.textContent =
        "Cancel the entire recurring series “" +
        e.title +
        "”? Every occurrence of this saved request will be removed.";
  }
};
