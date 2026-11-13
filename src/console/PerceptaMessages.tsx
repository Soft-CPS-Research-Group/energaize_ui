import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, Download, Pause, Play, Radio, RefreshCw, Search } from 'lucide-react';
import { runtimeRequest } from '../api/runtimeApi';

type Consumption = { value: number | null; unit: string; ev_charging_energy: number | null; missing_chargers: string[]; status: 'measured' | 'estimated' | 'incomplete' };
export type PerceptaMessage = { id: string; timestamp: string; payload: Record<string, unknown>; truncated: boolean; calculations?: {non_shiftable_load?: Consumption} };
type MessageBatch = { site_id: string; checked_at: string; available: boolean; source: string | null; messages: PerceptaMessage[]; notice: string | null };
const time = (value: string) => new Date(value).toLocaleString('en-GB');
const sections = ['observations', 'forecasts', 'community', 'decisions'];
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const hasValues = (v: unknown) => !!v && typeof v === 'object' && Object.keys(v).length > 0;

/** Inspect persisted output, independently of inference and without consuming broker messages. */
export function PerceptaMessages({ siteId, siteName, onBack }: { siteId: string; siteName: string; onBack: () => void }) {
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
  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => { if (!busy) void load(); }, 5000);
    return () => window.clearInterval(timer);
  }, [load, paused, busy]);
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 5000); return () => window.clearInterval(timer); }, []);
  const items = (batch?.messages || []).filter(m => !query || `${m.timestamp} ${JSON.stringify(m.payload)}`.toLowerCase().includes(query.toLowerCase()));
  const latest = batch?.messages[0];
  const age = latest ? Math.max(0, Math.floor((clock - new Date(latest.timestamp).getTime()) / 1000)) : null;
  const status = error ? 'Update failed' : paused ? 'Paused' : !batch ? 'Connecting…' : !batch.available ? 'Source not linked' : age === null ? 'Waiting for messages' : age > 60 ? 'No recent messages' : 'Receiving recent messages';
  const text = selected ? JSON.stringify(selected.payload, null, 2) : '';
  const consumption = selected?.calculations?.non_shiftable_load;
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
    <header className="percepta-messages-heading"><div><span className="eyebrow">{siteName} · Percepta</span><h2>Messages</h2><p>Stored Percepta output. Updates every 5 seconds.</p></div>
      <div className="actions"><button className="btn" onClick={() => { setPaused(!paused); request.current?.abort(); }}><>{paused ? <Play size={15}/> : <Pause size={15}/>}</>{paused ? 'Resume' : 'Pause'}</button><button className="btn" disabled={busy} onClick={() => void load()}><RefreshCw size={15}/>{busy ? 'Updating…' : 'Refresh'}</button></div>
    </header>
    <div className="percepta-messages-status"><span role="status"><Radio size={15}/>{status}</span><span>{latest ? `Last message ${time(latest.timestamp)}` : 'No message received yet'}</span><small>{batch ? `Checked ${time(batch.checked_at)}` : 'Checking source…'}</small></div>
    {error && <p role="alert" className="notice">{error}{batch ? ' Previously loaded messages remain visible.' : ''}</p>}
    {batch?.notice && <p className="notice">{batch.notice}</p>}
    <div className="percepta-message-toolbar"><label className="percepta-message-search"><Search size={16}/><input aria-label="Search messages" placeholder="Search recent messages…" value={query} onChange={e => setQuery(e.target.value)}/></label><button className="btn text" aria-pressed={follow} onClick={() => { setFollow(!follow); if (!follow) setSelected(latest || null); }}>{follow ? 'Following latest' : 'Follow latest'}</button><span>{items.length} / {batch?.messages.length || 0} recent messages</span></div>
    <div className="percepta-message-workspace">
      <div className="percepta-message-list" aria-label="Recent messages">{items.map(m => <button key={m.id} aria-pressed={selected?.id === m.id} onClick={() => { setSelected(m); setFollow(false); setNotice(''); }}><time>{time(m.timestamp)}</time><strong>Percepta output</strong><small>{m.truncated ? 'Payload exceeds preview limit' : sections.filter(s => hasValues(m.payload[s])).map(title).join(' · ') || 'Empty payload'}</small></button>)}{!items.length && <p>{busy && !batch ? 'Loading messages…' : query ? 'No recent messages match your search.' : batch?.available ? 'No stored messages found. Waiting for Percepta output.' : 'Messages will appear when a source is linked.'}</p>}</div>
      <section className="percepta-message-inspector" aria-label="Selected message">{selected ? <><header><div><span className="eyebrow">Selected message</span><h3>{time(selected.timestamp)}</h3></div><div className="actions"><button className="btn text" disabled={selected.truncated} onClick={() => void copy()} title="Copy JSON" aria-label="Copy JSON"><Copy size={16}/></button><button className="btn text" disabled={selected.truncated} onClick={download} title="Download JSON" aria-label="Download JSON"><Download size={16}/></button></div></header>
        {consumption && <section className="percepta-calculated-consumption" aria-label="Platform calculation"><h4>Non-shiftable consumption excluding EV charging</h4>
          <strong>{consumption.value===null?'Incomplete readings':energy(consumption.value)}</strong>
          {consumption.ev_charging_energy!==null&&<p>EV charging deducted: {energy(consumption.ev_charging_energy)}{consumption.status==='estimated'?' · estimated from average power':''}</p>}
          {!!consumption.missing_chargers.length&&<p>Missing charger readings: {consumption.missing_chargers.join(', ')}</p>}
        </section>}
        <div className="percepta-message-mode"><button aria-pressed={mode === 'sections'} onClick={() => setMode('sections')}>Sections</button><button aria-pressed={mode === 'json'} onClick={() => setMode('json')}>JSON</button></div>
        {selected.truncated ? <p className="notice">This message exceeds the preview size limit. Its payload has been omitted.</p> : mode === 'json' ? <pre>{text}</pre> : sections.map(s => <details key={s} open><summary>{title(s)}<small>{hasValues(selected.payload[s]) ? `${Object.keys(selected.payload[s] as object).length} entries` : 'No entries'}</small></summary><pre>{JSON.stringify(selected.payload[s] ?? {}, null, 2)}</pre></details>)}
        {notice && <p role="status">{notice}</p>}
      </> : <div className="percepta-message-empty"><Radio size={28}/><p>Select a message to inspect its contents.</p></div>}</section>
    </div>
    <footer className="percepta-message-footnote">{batch?.source && <span>Source: {batch.source}</span>}<span>Message timestamps describe the stored output. Generated values keep their original markers.</span></footer>
  </section>;
}
