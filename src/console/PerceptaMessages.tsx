import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, Download, Pause, Play, Radio, RefreshCw, Search } from 'lucide-react';
import { FieldValues, cyclePeriod, cycleRefreshSeconds } from './CycleReadings';
import { runtimeRequest } from '../api/runtimeApi';
import { displayMeasurementName } from './PerceptaMeasurementEditor';

type Consumption = {
  value: number | null; unit: string; ev_charging_energy: number | null; missing_chargers: string[];
  status: 'measured' | 'estimated' | 'incomplete';
  grid_meter_status?: 'main_meters_only' | 'roles_required' | 'readings_missing' | 'inventory_unavailable';
  excluded_grid_meters?: number;
};
export type PerceptaMessage = { id: string; timestamp: string; payload: Record<string, unknown>; truncated: boolean; calculations?: {non_shiftable_load?: Consumption} };
export type MeasurementNames = Record<string, { equipment?: string; measurement: string }>;
type MessageBatch = { site_id: string; checked_at: string; available: boolean; source: string | null; messages: PerceptaMessage[]; notice: string | null; measurement_names?: MeasurementNames | null };
const time = (value: string) => new Date(value).toLocaleString('en-GB');
const sections = ['observations', 'derived_data', 'forecasts', 'community', 'decisions'];
const title = (s: string) => s === 'derived_data' ? 'Calculated readings' : s.charAt(0).toUpperCase() + s.slice(1);
const hasValues = (v: unknown) => !!v && typeof v === 'object' && Object.keys(v).length > 0;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function MessageEquipment({ entities, names }: { entities: unknown; names: MeasurementNames }) {
  return <details open><summary>Equipment readings</summary>
    {Object.entries(record(entities)).map(([key, entity]) => {
      const parameters = Object.entries(record(record(entity).parameters));
      const equipment = parameters.find(([id]) => names[id]?.equipment);
      const forecast = record(entity).entity_type_id === 'forecast_service';
      return <section className="percepta-message-equipment" key={key} aria-label={forecast ? 'Predictor forecasts' : undefined}>
        <h4>{forecast ? 'Predictor forecasts' : equipment ? names[equipment[0]].equipment : displayMeasurementName(String(record(entity).entity_type_id || key))}</h4>
        <dl>{parameters.map(([id, data]) => {
          const measurement = record(data);
          const values = Array.isArray(measurement.final_values) ? measurement.final_values : [];
          const first = record(values[0]).value;
          const unit = typeof measurement.measurement_unit === 'string' ? measurement.measurement_unit : '';
          if (forecast) {
            const intervals = measurement.generated === false ? values.map(record).filter(v =>
              typeof v.value === 'number' && Number.isFinite(v.value) &&
              typeof v.period_start === 'string' && typeof v.period_end === 'string') : [];
            const label = displayMeasurementName(names[id]?.measurement || String(measurement.parameter_type_id || id));
            return <div key={id}><dt>{label}</dt><dd>{intervals.length ? <>
              {intervals.length} {intervals.length === 1 ? 'interval' : 'intervals'} · {String(intervals[0].value)} {unit} in the first interval
              <br/><small>{time(String(intervals[0].period_start))} – {time(String(intervals[intervals.length - 1].period_end))}</small>
            </> : 'No received forecast'}</dd></div>;
          }
          return <div key={id}><dt>{displayMeasurementName(names[id]?.measurement || String(measurement.parameter_type_id || id))}</dt>
            <dd>{typeof first === 'number' || typeof first === 'string' ? `${first} ${unit}`.trim() : 'No reading'}{measurement.generated === true ? ' · Generated' : ''}</dd>
          </div>;
        })}</dl>
      </section>;
    })}
  </details>;
}

/** Inspect persisted output, independently of inference and without consuming broker messages. */
export function PerceptaMessages({ siteId, siteName, onBack, periodSeconds }: { siteId: string; siteName: string; periodSeconds?: number; onBack: () => void }) {
  const [batch, setBatch] = useState<MessageBatch | null>(null);
  const [selected, setSelected] = useState<PerceptaMessage | null>(null);
  const [paused, setPaused] = useState(false), [follow, setFollow] = useState(true);
  const [query, setQuery] = useState(''), [mode, setMode] = useState<'sections' | 'json'>('sections');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [clock, setClock] = useState(Date.now());
  const request = useRef<AbortController | null>(null), sequence = useRef(0), following = useRef(follow);
  following.current = follow;
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const seq = ++sequence.current;
    setBusy(true);
    try {
      const result = await runtimeRequest<MessageBatch>(`/api/runtime/percepta/sites/${encodeURIComponent(siteId)}/messages`, { signal: controller.signal });
      if (seq !== sequence.current || controller.signal.aborted) return;
      if (result.site_id !== siteId) throw new Error('The message source does not match this house.');
      setBatch(result); setError(''); setClock(Date.now());
      setSelected(previous => following.current ? result.messages[0] || null : previous);
    } catch (e) {
      if (seq === sequence.current && !controller.signal.aborted) setError((e as Error).message);
    } finally { if (seq === sequence.current) setBusy(false); }
  }, [siteId]);
  useEffect(() => {
    // Reset before reading another house, including when used outside the keyed deployment view.
    setBatch(null); setSelected(null); setError(''); setQuery(''); setFollow(true); following.current = true;
    void load();
    return () => { ++sequence.current; request.current?.abort(); };
  }, [load]);
  const period = cyclePeriod(periodSeconds, batch?.messages[0]?.payload);
  const intervalSeconds=cycleRefreshSeconds(period);
  useEffect(() => {
    if (paused || busy) return;
    const check=()=>{if(!document.hidden) void load();};
    const timer = window.setTimeout(check,intervalSeconds*1000);
    document.addEventListener('visibilitychange',check);
    return ()=>{window.clearTimeout(timer);document.removeEventListener('visibilitychange',check);};
  }, [load, paused, busy, intervalSeconds]);
  const names = batch?.measurement_names || {};
  const search = query.trim().toLowerCase();
  const items = (batch?.messages || []).filter(m => {
    if (!search || `${m.timestamp} ${JSON.stringify(m.payload)}`.toLowerCase().includes(search)) return true;
    return Object.values(record(m.payload.entities)).some(entity =>
      Object.keys(record(record(entity).parameters)).some(id =>
        names[id] && `${names[id].equipment} ${displayMeasurementName(names[id].measurement)}`.toLowerCase().includes(search)
      )
    );
  });
  const latest = batch?.messages[0];
  const age = latest ? Math.max(0, Math.floor((clock - new Date(latest.timestamp).getTime()) / 1000)) : null;
  const status = error ? 'Update failed' : paused ? 'Paused' : !batch ? 'Connecting…' : !batch.available ? 'Source not linked' : age === null ? 'Waiting for messages' : age > (period ? period*2+5 : 90) ? 'No recent messages' : 'Receiving recent messages';
  const text = selected ? JSON.stringify(selected.payload, null, 2) : '';
  const consumption = selected?.calculations?.non_shiftable_load;
  const meterNote = {
    main_meters_only: 'Uses main grid meters only. Submeters and logical meters are excluded.',
    roles_required: 'Set the meter roles in Equipment so the house’s main meters can be identified.',
    readings_missing: 'Waiting for complete readings from main meters, solar or batteries.',
    inventory_unavailable: 'Meter roles are temporarily unavailable.',
  };
  const energy = (value: number) => value.toLocaleString(undefined, {maximumFractionDigits: 6}) + ' ' + consumption?.unit;
  async function copy() {
    try { await navigator.clipboard.writeText(text); setNotice('Message copied.'); }
    catch { setNotice('Copy is unavailable. Use Download JSON instead.'); }
  }
  function download() {
    if (!selected) return;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `percepta-${siteName.replace(/[^a-z0-9_-]/gi, '-')}-${selected.id}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="percepta-messages" aria-label="Percepta messages">
    <button className="btn text" onClick={onBack}><ArrowLeft size={16}/>Back to deployment</button>
    <header className="percepta-messages-heading"><div><span className="eyebrow">{siteName} · Percepta</span><h2>Messages</h2><p>Page checks every {intervalSeconds} seconds.{period && ` Each cycle covers ${period} seconds.`}</p></div>
      <div className="actions"><button className="btn" onClick={() => { setPaused(!paused); if(paused) void load(); else request.current?.abort(); }}><>{paused ? <Play size={15}/> : <Pause size={15}/>}</>{paused ? 'Resume' : 'Pause'}</button><button className="btn" disabled={busy} onClick={() => void load()}><RefreshCw size={15}/>{busy ? 'Updating…' : 'Refresh'}</button></div>
    </header>
    <div className="percepta-messages-status"><span role="status"><Radio size={15}/>{status}</span><span>{latest ? `Last message ${time(latest.timestamp)}` : 'No message received yet'}</span><small>{batch ? `Checked ${time(batch.checked_at)}` : 'Checking source…'}</small></div>
    {error && <p role="alert" className="notice">{error}{batch ? ' Previously loaded messages remain visible.' : ''}</p>}
    {batch?.notice && <p className="notice">{batch.notice}</p>}
    <div className="percepta-message-toolbar"><label className="percepta-message-search"><Search size={16}/><input aria-label="Search messages" placeholder="Search recent messages…" value={query} onChange={e => setQuery(e.target.value)}/></label><button className="btn text" aria-pressed={follow} onClick={() => { setFollow(!follow); if (!follow) setSelected(latest || null); }}>{follow ? 'Following latest' : 'Follow latest'}</button><span>{items.length} / {batch?.messages.length || 0} recent messages</span></div>
    <div className="percepta-message-workspace">
      <div className="percepta-message-list" aria-label="Recent messages">{items.map(m => <button key={m.id} aria-pressed={selected?.id === m.id} onClick={() => { setSelected(m); setFollow(false); setNotice(''); }}><time>{time(m.timestamp)}</time><strong>Percepta output</strong><small>{m.truncated ? 'Payload exceeds preview limit' : [...(hasValues(m.payload.entities) ? ['Equipment readings'] : []), ...sections.filter(s => hasValues(m.payload[s])).map(title)].join(' · ') || 'Empty payload'}</small></button>)}{!items.length && <p>{busy && !batch ? 'Loading messages…' : query ? 'No recent messages match your search.' : batch?.available ? 'No stored messages found. Waiting for Percepta output.' : 'Messages will appear when a source is linked.'}</p>}</div>
      <section className="percepta-message-inspector" aria-label="Selected message">{selected ? <><header><div><span className="eyebrow">Selected message</span><h3>{time(selected.timestamp)}</h3></div><div className="actions"><button className="btn text" disabled={selected.truncated} onClick={() => void copy()} title="Copy JSON" aria-label="Copy JSON"><Copy size={16}/></button><button className="btn text" disabled={selected.truncated} onClick={download} title="Download JSON" aria-label="Download JSON"><Download size={16}/></button></div></header>
        {consumption && <section className="percepta-calculated-consumption" aria-label="Platform calculation"><h4>Base household consumption excluding EV charging</h4>
          <strong>{consumption.value===null?'Incomplete readings':energy(consumption.value)}</strong>
          {consumption.grid_meter_status&&<p>{meterNote[consumption.grid_meter_status]}</p>}
          {consumption.ev_charging_energy!==null&&<p>EV charging deducted: {energy(consumption.ev_charging_energy)}{consumption.status==='estimated'?' · estimated from average power':''}</p>}
          {!!consumption.missing_chargers.length&&<p>Missing charger readings: {consumption.missing_chargers.join(', ')}</p>}
        </section>}
        <div className="percepta-message-mode"><button aria-pressed={mode === 'sections'} onClick={() => setMode('sections')}>Sections</button><button aria-pressed={mode === 'json'} onClick={() => setMode('json')}>JSON</button></div>
        {selected.truncated ? <p className="notice">This message exceeds the preview size limit. Its payload has been omitted.</p> : mode === 'json' ? <pre>{text}</pre> : <>{hasValues(selected.payload.entities)&&<MessageEquipment entities={selected.payload.entities} names={names}/>}
          {sections.filter(s => hasValues(selected.payload[s])).map(s => <details key={s} open><summary>{title(s)}<small>{hasValues(selected.payload[s]) ? `${Object.keys(selected.payload[s] as object).length} entries` : 'No entries'}</small></summary><FieldValues value={selected.payload[s]}/></details>)}</>}
        {notice && <p role="status">{notice}</p>}
      </> : <div className="percepta-message-empty"><Radio size={28}/><p>Select a message to inspect its contents.</p></div>}</section>
    </div>
    <footer className="percepta-message-footnote">{batch?.source && <span>Source: {batch.source}</span>}<span>Message timestamps describe the stored output. Generated values keep their original markers.</span></footer>
  </section>;
}
