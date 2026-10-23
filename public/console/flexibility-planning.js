/* The backend expands recurrence, applies exceptions and resolves conflicts. */
'use strict';
const FlexPlan = { asset: '', key: '', raw: null, result: null, error: null, pending: false, sequence: 0 };
const FlexHomePlan = { key: '', raw: null, rows: null, error: null, sequence: 0 };
const flexDateTime = value => new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const flexLabels = { eligible: 'Available request', conflict: 'Overlapping requests · review needed', superseded: 'Replaced by a higher-priority request', cancelled: 'Cancelled', needs_attention: 'Review the time window or running requirement', suggestion: 'Predicted use · confirm your needs', blocked_by_declared_request: 'Prediction covered by a declared request' };

async function requireFlexAuthor(event) {
  const access = await B.request('flexibility', '/api/flexibility/events/' + event.event_id + '/access');
  if (!access.can_edit) throw Error('Only the author with current equipment access can change this request.');
  return access;
}
async function flexRequestDetails(eventId) {
  const event = connection.raw.events.find(e => e.event_id === eventId);
  if (!event) throw Error('Reload the calendar to view this request.');
  const [access, revisions, delivery] = await Promise.all([
    B.request('flexibility', '/api/flexibility/events/' + eventId + '/access'),
    B.request('flexibility', '/api/flexibility/events/' + eventId + '/revisions'),
    B.request('flexibility', '/api/flexibility/events/' + eventId + '/delivery'),
  ]);
  const latest = delivery.changes[0];
  const pending = latest?.deliveries.filter(d => d.state === 'pending').length || 0;
  const deliveryText = !latest?.deliveries.length ? 'Saved in Flexibility. No consumer is connected to this change.' :
    pending ? 'Saved in Flexibility. Waiting for ' + pending + ' consumer acknowledgement(s).' :
      'Connected consumers have acknowledged this change.';
  drawer('Request details', `<h3>${esc(event.title)}</h3><p>Created by ${esc(access.author_name || (access.legacy_unattributed ? 'Unknown (older request)' : 'Former account'))} · revision ${esc(access.revision)}</p><p>${access.can_edit ? 'You can edit or cancel your request.' : 'Read only. Changes require the author and current equipment access.'}</p><h3>Who can view this request</h3><ul>${access.readers.map(p => `<li>${esc(p.name)}${p.is_author ? ' · author' : ''}</li>`).join('')}</ul><p class="footnote">${esc(access.sharing)}</p><p>Sharing is managed through the home and equipment access settings.</p><h3>Saved changes</h3><ul>${revisions.map(r => `<li>Revision ${r.revision} · ${esc(flexDateTime(r.recorded_at))} · ${esc(r.snapshot.status)}</li>`).join('') || '<li>No recorded revisions for this older request.</li>'}</ul><h3>Delivery to connected services</h3><p role="status">${esc(deliveryText)}</p><p class="footnote">Acknowledgement confirms that a service applied the change. It does not confirm a physical action on the equipment.</p>`, '<button type="button" class="btn" data-flex-details-refresh>Refresh details</button>');
  overlay.querySelector('[data-flex-details-refresh]').onclick = () => flexRequestDetails(eventId).catch(e => toast(e.message));
}

function refreshFlexPlan() { FlexPlan.key = ''; FlexPlan.sequence++; render(); }
function loadFlexPlan(assets, start, end) {
  const key = [person().id, ...assets.map(a => a.id).sort(), start.toISOString(), end.toISOString()].join('|');
  if (key === FlexPlan.key && FlexPlan.raw === connection.raw) return;
  FlexPlan.key = key; FlexPlan.raw = connection.raw; FlexPlan.result = null; FlexPlan.error = null;
  const sequence = ++FlexPlan.sequence;
  if (!assets.length) { FlexPlan.pending = false; return; }
  FlexPlan.pending = true;
  // Requests are bounded to 100 equipment items per API call.
  const groups = Array.from({ length: Math.ceil(assets.length / 100) }, (_, i) => assets.slice(i * 100, i * 100 + 100));
  Promise.all(groups.map(group => B.request('flexibility', '/api/flexibility/effective', 'POST', {
    schema_version: 1, asset_ids: group.map(a => a.id), from: start.toISOString(), until: end.toISOString(),
  }))).then(results => {
    if (sequence !== FlexPlan.sequence) return;
    FlexPlan.result = { occurrences: results.flatMap(r => r.occurrences), predictions: results.flatMap(r => r.predictions), computed_at: results[0]?.computed_at };
  }).catch(error => { if (sequence === FlexPlan.sequence) FlexPlan.error = error.message; })
    .finally(() => { if (sequence === FlexPlan.sequence) { FlexPlan.pending = false; render(); } });
}

function flexRow(e) {
  const forecast = e.source === 'forecast', asset = equipmentRecord(e.asset_id), canEdit = !forecast && e.status !== 'cancelled' && asset?.asset_type !== 'ev' && flexCanEdit(e);
  const detail = forecast ? `${e.duration_minutes} minute typical use · ${e.sample_count} observed sessions` : flexRequirement(e);
  return `<article class="flex-agenda-item ${e.resolution === 'cancelled' ? 'flex-cancelled' : ''}"><span class="flex-agenda-icon">${icon(flexKinds[asset?.asset_type]?.[1] || 'clock')}</span><div><strong>${esc(forecast ? 'Predicted use' : e.title)}</strong><p>${esc(asset?.data.name || 'Equipment')}</p><p>${esc(flexDateTime(e.starts_at))} — ${esc(flexDateTime(e.ends_at))}</p><small>${esc(detail)}</small><small class="flex-resolution" data-resolution="${esc(e.resolution)}">${esc(flexLabels[e.resolution] || e.resolution)}</small>${e.latest_start && e.resolution === 'eligible' ? `<small>Cycle can start as late as ${esc(flexDateTime(e.latest_start))}</small>` : ''}${e.exception_revision ? '<small>Changed for this occurrence</small>' : ''}${e.resolution === 'needs_attention' ? `<small>${esc(e.timing_status === 'running_time_required' ? 'This older pump request needs a running time; its flow value cannot determine a duration.' : (e.timing_status || '').replaceAll('_', ' '))} Edit this occurrence to complete its requirements.</small>` : ''}${forecast ? '<small>This pattern is a suggestion, not permission to operate equipment.</small>' : ''}${!forecast ? `<small>Revision ${esc(e.revision)} · ${e.created_by === person().id ? 'Your request' : 'Shared request'}</small><button class="btn text" data-flex-details="${esc(e.event_id)}">Details & access</button>` : ''}${canEdit ? `<div class="actions"><button type="button" class="btn text" data-flex-occ-edit="${esc(e.occurrence_id)}">Edit</button><button type="button" class="btn text" data-flex-occ-cancel="${esc(e.occurrence_id)}">Cancel</button></div>` : ''}</div></article>`;
}

sessionsView = function () {
  const all = sessionAssets().filter(a => flexKinds[a.asset_type]);
  if (FlexPlan.asset && !all.some(a => a.id === FlexPlan.asset)) FlexPlan.asset = '';
  const assets = FlexPlan.asset ? all.filter(a => a.id === FlexPlan.asset) : all;
  const month = FlexCalendar.month, first = new Date(month.getFullYear(), month.getMonth(), 1), start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const end = new Date(start); end.setDate(end.getDate() + 42);
  loadFlexPlan(assets, start, end);
  const events = FlexPlan.result?.occurrences || [], predictions = FlexPlan.result?.predictions || [];
  const selected = FlexCalendar.day || flexDay(new Date()), dayRows = flexDayEvents(events, selected);
  const suggested = flexDayEvents(predictions.filter(p => p.resolution === 'suggestion'), selected);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const day = new Date(start); day.setDate(day.getDate() + i);
    const key = flexDay(day), rows = flexDayEvents(events.filter(e => e.status !== 'cancelled'), key), guesses = flexDayEvents(predictions.filter(p => p.resolution === 'suggestion'), key);
    return `<div class="flex-day ${day.getMonth() !== month.getMonth() ? 'outside' : ''} ${key === selected ? 'selected' : ''} ${key === flexDay(new Date()) ? 'today' : ''}"><button class="flex-day-pick" data-flex-day="${key}" aria-pressed="${key === selected}" aria-label="${day.toLocaleDateString('en-GB', { dateStyle: 'full' })}, ${rows.length} requests"><span>${day.getDate()}</span>${rows.length ? `<small>${rows.length} request${rows.length === 1 ? '' : 's'}</small>` : ''}</button><div class="flex-day-events">${rows.slice(0, 2).map(e => `<button data-flex-day="${key}" class="calendar-event" title="${esc(flexLabels[e.resolution])}">${e.recurrence ? '↻ ' : ''}${esc(equipmentRecord(e.asset_id)?.data.name || e.title)}</button>`).join('')}${guesses.length ? `<button class="calendar-event forecast" data-flex-day="${key}">◌ ${guesses.length} prediction${guesses.length === 1 ? '' : 's'}</button>` : ''}${rows.length > 2 ? `<button data-flex-day="${key}">+${rows.length - 2} more</button>` : ''}</div></div>`;
  }).join('');
  const issueCount = events.filter(e => ['conflict', 'needs_attention'].includes(e.resolution)).length;
  return title('Flexibility', 'Your equipment, available times and requirements.', (all.some(a => flexCanRequest(a.id)) ? button('New request', 'new-session', 'plus', true) : '<span class="footnote">Read-only calendar</span>')) +
    `<div class="flex-planning-toolbar"><label class="formlabel">Equipment<select data-flex-filter aria-label="Filter flexibility by equipment"><option value="">All equipment</option>${all.map(a => `<option value="${a.id}" ${a.id === FlexPlan.asset ? 'selected' : ''}>${esc(a.data.name)} · ${esc(flexKinds[a.asset_type][0])}</option>`).join('')}</select></label><div class="actions"><button class="btn" data-flex-rules ${!assets.length ? 'disabled' : ''}>Rules & predictions</button><button class="btn text" data-flex-refresh>Refresh</button></div></div>` +
    (FlexPlan.pending ? '<p class="notice" role="status">Loading saved requests and predictions…</p>' : FlexPlan.error ? `<p class="notice" role="alert">${esc(FlexPlan.error)} <button type="button" class="btn text" data-flex-refresh>Try again</button></p>` : issueCount ? `<p class="notice" role="status">${issueCount} occurrence${issueCount === 1 ? '' : 's'} need attention. Select the day to review overlapping requests or clock changes.</p>` : '') +
    `<div class="flex-calendar-key"><span>● One-off</span><span>↻ Recurring</span><span>◌ Prediction to review</span></div><div class="flex-planner"><section class="flex-calendar" aria-label="Flexibility calendar"><header><h2>${month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h2><div class="actions"><button class="btn text" data-flex-month="today">Today</button><button class="icon-btn" aria-label="Previous month" data-flex-month="-1">${icon('left')}</button><button class="icon-btn" aria-label="Next month" data-flex-month="1">${icon('right')}</button></div></header><div class="flex-weekdays">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<span>${d}</span>`).join('')}</div><div class="flex-days">${cells}</div></section><aside class="flex-agenda"><div class="eyebrow">SELECTED DAY</div><h2>${new Date(selected + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</h2>${dayRows.map(flexRow).join('')}${suggested.map(flexRow).join('')}${!dayRows.length && !suggested.length ? `<div class="flex-day-empty">${icon('clock')}<h3>${FlexPlan.pending ? 'Loading…' : FlexPlan.error ? 'Calendar unavailable' : 'No plans for this day'}</h3><p>${FlexPlan.error ? 'Refresh to retrieve saved requests.' : 'Choose equipment and add its available time window.'}</p></div>` : ''}${assets.some(a => flexCanRequest(a.id)) ? `<button class="btn primary" data-flex-add="${selected}">${icon('plus')} Plan something</button>` : ''}</aside></div><p class="footnote">Times are shown in ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}. Recurrences follow their saved time zone. Requests and predictions do not confirm equipment execution.</p>`;
};

const planEditSession = editSession;
editSession = async (id = null, assetId = null, vehicleId = null, occurrence = null) => {
  if (id) {
    const event = connection.raw.events.find(e => e.event_id === id);
    if (!event) throw Error('Reload the calendar before editing.');
    if (event.mode === 'forecast') { toast('Automatic forecasts are supplied by the system.'); return; }
    await requireFlexAuthor(event);
  }
  return planEditSession(id, assetId || (!id && FlexPlan.asset) || null, vehicleId, occurrence);
};

personalChargingPlan = function (site) {
  const ids = availableAssets().filter(a => a.site_id === site.id && a.asset_type === 'ev_charger').map(a => a.id);
  if (!ids.length) return '';
  const now = new Date(), bucket = Math.floor(+now / 900000), key = [person().id, site.id, bucket, ...ids.sort()].join('|');
  if (FlexHomePlan.key !== key || FlexHomePlan.raw !== connection.raw) {
    FlexHomePlan.key = key; FlexHomePlan.raw = connection.raw; FlexHomePlan.rows = null; FlexHomePlan.error = null;
    const sequence = ++FlexHomePlan.sequence;
    B.request('flexibility', '/api/flexibility/effective', 'POST', { asset_ids: ids, from: now.toISOString(), until: new Date(+now + 31 * 86400000).toISOString() })
      .then(result => { if (sequence === FlexHomePlan.sequence) FlexHomePlan.rows = result.effective; })
      .catch(error => { if (sequence === FlexHomePlan.sequence) FlexHomePlan.error = error.message; })
      .finally(() => { if (sequence === FlexHomePlan.sequence) render(); });
  }
  const next = (FlexHomePlan.rows || []).filter(e => e.session_type === 'ev_charging' && Date.parse(e.ends_at) > +now).sort((a, b) => Date.parse(a.ends_at) - Date.parse(b.ends_at))[0];
  const text = FlexHomePlan.error ? 'The charging plan could not be loaded. Open Flexibility to retry.' : FlexHomePlan.rows === null ? 'Loading your saved charging plan…' : next ? flexDateTime(next.ends_at) + ' · ' + flexRequirement(next) : 'No applicable charging request in the next 31 days. Review any conflicts in Flexibility.';
  return `<section class="personal-next-plan"><span class="plan-product-art">${productArt('charger')}</span><div><h2>${next ? 'Next departure' : 'Your charging plan'}</h2><p>${esc(text)}</p><small>Requested target · charging completion is not confirmed</small></div><button class="btn" data-op-page="sessions">View plan</button></section>`;
};

async function flexOccurrenceAction(occurrence, cancel) {
  const source = connection.raw.events.find(e => e.event_id === occurrence.event_id);
  if (!source) throw Error('Reload the calendar before editing this request.');
  await requireFlexAuthor(source);
  const single = async () => {
    if (!cancel) return editSession(source.event_id, null, null, occurrence);
    drawer('Cancel this occurrence', `<p>Cancel ${esc(source.title)} on ${esc(flexDateTime(occurrence.starts_at))}? Other dates in the series stay available.</p>`, save('Cancel this occurrence'), () => saveRemote(async () => {
      await requireFlexAuthor(source);
      await B.request('flexibility', '/api/flexibility/events/' + source.event_id + '/exceptions', 'PUT', {
        action: 'cancel', occurrence_at: occurrence.occurrence_at, expected_event_revision: source.revision,
        expected_exception_revision: occurrence.exception_revision || 0,
      });
    }));
  };
  if (!source.recurrence) return cancel ? cancelSession(source.event_id) : editSession(source.event_id);
  drawer(cancel ? 'Cancel recurring request' : 'Edit recurring request', `<p>${esc(source.title)} · ${esc(flexDateTime(occurrence.starts_at))}</p><p>Choose which dates to change.</p><div class="flex-scope-actions"><button type="button" class="btn primary" data-flex-only>This occurrence only</button><button type="button" class="btn" data-flex-series>The entire series</button></div>`);
  overlay.querySelector('[data-flex-only]').onclick = () => single().catch(e => toast(e.message));
  overlay.querySelector('[data-flex-series]').onclick = () => (cancel ? cancelSession(source.event_id) : editSession(source.event_id)).catch(e => toast(e.message));
}

cancelSession = async function (id) {
  const event = connection.raw.events.find(e => e.event_id === id);
  if (!event || !sessionVisible(event) || event.mode === 'forecast') return;
  await requireFlexAuthor(event);
  drawer(event.recurrence ? 'Cancel entire series' : 'Cancel request', `<p>Cancel ${esc(event.title)}${event.recurrence ? ' on every date in this series' : ''}? The cancellation is kept in the request history.</p>`, save('Cancel request'), () => saveRemote(async () => {
    if (event.mode === 'forecast') { toast('Automatic forecasts are supplied by the system.'); return; }
    await requireFlexAuthor(event);
    await B.request('flexibility', '/api/flexibility-events/' + id + '?expected_revision=' + event.revision, 'DELETE');
  }));
};

async function flexRules(assetId) {
  const assets = sessionAssets().filter(a => flexKinds[a.asset_type]);
  if (!assetId) {
    drawer('Equipment rules & predictions', '<p>Choose the equipment whose rules you want to review.</p>' + formSelect('equipment', assets.map(a => [a.id, a.data.name + ' · ' + flexKinds[a.asset_type][0]]), assets[0]?.id), save('Continue'), d => flexRules(String(d.get('equipment'))).catch(e => toast(e.message)));
    return;
  }
  const asset = assets.find(a => a.id === assetId);
  if (!asset) return;
  const [policy, forecasts, observations] = await Promise.all([
    B.request('flexibility', '/api/flexibility/assets/' + assetId + '/policy'),
    B.request('flexibility', '/api/flexibility/assets/' + assetId + '/forecasts'),
    B.request('flexibility', '/api/flexibility/assets/' + assetId + '/observation-channels').catch(e => ({ channels: [], error: e.message })),
  ]);
  const p = policy.settings, canEdit = flexCanRequest(assetId);
  const latest = forecasts.jobs[0], prediction = forecasts.prediction;
  const stateText = { disabled: 'Predictions are off', not_requested: 'No prediction requested yet', pending: 'Waiting for the prediction service', running: 'Learning from observed activity', completed: 'Prediction completed', insufficient_data: 'More observed history is needed', failed: 'Prediction could not be completed' }[forecasts.state];
  const numberField = (label, name, min, max, step = 1) => `<label class="formlabel">${label}<input type="number" name="${name}" min="${min}" ${max ? `max="${max}"` : ''} step="${step}" value="${esc(p[name])}" required></label>`;
  drawer('Rules & predictions · ' + esc(asset.data.name), `<p>One-off requests can override a routine for this equipment. Overlapping requests from different people require review.</p><fieldset ${!canEdit ? 'disabled' : ''} class="flex-rules-fields"><label class="formlabel">When your requests overlap<select name="explicit_priority"><option value="punctual_first" ${p.explicit_priority === 'punctual_first' ? 'selected' : ''}>Prefer one-off requests</option><option value="recurrent_first" ${p.explicit_priority === 'recurrent_first' ? 'selected' : ''}>Prefer recurring requests</option></select></label><label class="flex-check"><input type="checkbox" name="forecast_enabled" ${p.forecast_enabled ? 'checked' : ''}> Suggest likely usage from observed history</label><p class="footnote">Predictions do not set a target charge, temperature or permission to run a cycle. Confirm your needs with a request.</p><label class="formlabel">Observed power or activity channel<select name="observation_channel_id"><option value="">Select a linked channel</option>${observations.channels.map(c => `<option value="${esc(c.capability_id)}" ${c.capability_id === p.observation_channel_id ? 'selected' : ''} ${!c.eligible ? 'disabled' : ''}>${esc(c.name)}${c.unit ? ' (' + esc(c.unit) + ')' : ''}${!c.eligible ? ' · ' + esc(c.reason) : ''}</option>`).join('')}</select></label>${observations.error ? `<p role="alert">${esc(observations.error)}</p>` : ''}<div class="flex-rule-grid">${numberField('Active above (channel units)', 'active_above', 0, null, 'any')}${numberField('Maximum gap between readings (minutes)', 'maximum_gap_minutes', 1, 180)}${numberField('History (days)', 'history_days', 7, 365)}${numberField('Minimum complete sessions', 'minimum_sessions', 3, 1000)}${numberField('Look ahead (days)', 'horizon_days', 1, 14)}${numberField('Refresh every (minutes)', 'refresh_minutes', 15, 10080)}${numberField('Prediction validity (hours)', 'prediction_valid_hours', 1, 168)}<label class="formlabel">Time zone<input name="timezone" value="${esc(p.timezone)}" required placeholder="Europe/Lisbon"></label></div></fieldset><section class="flex-prediction-state"><h3>${esc(stateText || forecasts.state)}</h3>${latest?.error ? `<p role="alert">${esc(latest.error)}</p>` : ''}${latest?.result?.reason ? `<p>${esc(latest.result.reason)}</p>` : ''}${latest?.result ? `<p>${latest.result.session_count} complete observed sessions.</p>` : ''}${prediction ? `<p>${prediction.usable ? 'Current' : 'Expired or replaced by newer rules'} · valid until ${esc(flexDateTime(prediction.valid_until))}</p><p>${prediction.result.windows.length} predicted usage windows.</p>${prediction.result.evaluation?.test_sessions ? `<p>Checked against ${prediction.result.evaluation.test_sessions} later sessions: average start-time error ${prediction.result.evaluation.start_mae_minutes} min; duration error ${prediction.result.evaluation.duration_mae_minutes} min.</p>` : '<p>Not enough later observations for an accuracy estimate.</p>'}` : ''}<div class="actions">${canEdit && p.forecast_enabled ? '<button type="button" class="btn" data-flex-predict>Calculate prediction now</button>' : ''}<button type="button" class="btn text" data-flex-status>Refresh status</button></div></section><p role="alert" class="flex-rule-error" hidden></p>`, canEdit ? save('Save equipment rules') : '', async data => {
    const error = overlay.querySelector('.flex-rule-error'), submit = overlay.querySelector('[type="submit"]');
    try {
      submit.disabled = true;
      await checkPermission('asset', assetId, 'request');
      const settings = { ...p, explicit_priority: String(data.get('explicit_priority')), forecast_enabled: data.has('forecast_enabled'), forecast_usage: 'suggestions', observation_channel_id: String(data.get('observation_channel_id')) || null, timezone: String(data.get('timezone')) };
      for (const name of ['active_above', 'maximum_gap_minutes', 'history_days', 'minimum_sessions', 'horizon_days', 'refresh_minutes', 'prediction_valid_hours']) settings[name] = Number(data.get(name));
      await B.request('flexibility', '/api/flexibility/assets/' + assetId + '/policy', 'PUT', { expected_revision: policy.revision, settings });
      refreshFlexPlan(); await flexRules(assetId); toast('Equipment rules saved.');
    } catch (e) { error.hidden = false; error.textContent = e.message; submit.disabled = false; }
  });
  overlay.querySelector('[data-flex-status]').onclick = () => { refreshFlexPlan(); flexRules(assetId).catch(e => toast(e.message)); };
  const calculate = overlay.querySelector('[data-flex-predict]');
  if (calculate) calculate.onclick = async () => {
    calculate.disabled = true;
    try { await B.request('flexibility', '/api/flexibility/assets/' + assetId + '/forecasts', 'POST', {}); await flexRules(assetId); }
    catch (e) { toast(e.message); calculate.disabled = false; }
  };
}

document.addEventListener('change', e => {
  if (e.target.matches('[data-flex-filter]')) { FlexPlan.asset = e.target.value; render(); }
});
document.addEventListener('click', e => {
  const details = e.target.closest('[data-flex-details]');
  if (details) { flexRequestDetails(details.dataset.flexDetails).catch(e => toast(e.message)); return; }
  const button = e.target.closest('[data-flex-occ-edit],[data-flex-occ-cancel],[data-flex-rules],[data-flex-refresh]');
  if (!button) return;
  if (button.hasAttribute('data-flex-refresh')) { refreshFlexPlan(); return; }
  if (button.hasAttribute('data-flex-rules')) { flexRules(FlexPlan.asset || null).catch(e => toast(e.message)); return; }
  const id = button.dataset.flexOccEdit || button.dataset.flexOccCancel, occurrence = FlexPlan.result?.occurrences.find(r => r.occurrence_id === id);
  if (occurrence) flexOccurrenceAction(occurrence, !!button.dataset.flexOccCancel).catch(e => toast(e.message));
});

// Refresh other people's edits and prediction expiry without interrupting an open form.
setInterval(() => {
  if (state.loggedIn && state.operationsPage === 'sessions' && !connection.loading && !overlay.querySelector('[role="dialog"]')) refreshFlexPlan();
}, 60000);
