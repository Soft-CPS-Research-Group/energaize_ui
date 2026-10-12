import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, History, Link2, Radio, RefreshCw, X } from 'lucide-react';
import { DayPicker, type DateRange } from 'react-day-picker';
import { Line, ReferenceArea, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import { resolveAxisTickStepMs } from '../utils/timeseriesGranularity';
import { TimeseriesPlot } from '../components/charts/TimeseriesPlot';
import type { MeasurementChannel } from './measurementChannels';
import { compactPoints, loadWindow, mergeWindow, plotRows, type MeasurementRequest, type MeasurementSeries, type TimeWindow } from './measurementData';

export interface MeasurementChartProps {
  incremental?: boolean; queryKey?: string; series?: (MeasurementChannel & {color: string})[];
  request: MeasurementRequest; endpoint?: string; latestEndpoint?: string; initialEnd?: number;
  title: string; unit?: string; note?: string; expectedSeconds?: number | null;
  onLink?: () => void; onUnlink?: () => void;
}
const presets = [{ label: '1h', ms: 3600000 }, { label: '6h', ms: 21600000 }, { label: '24h', ms: 86400000 }, { label: '7d', ms: 604800000 }, { label: '30d', ms: 2592000000 }];
const date = (t: number, time = true) => new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) });
const localInput = (t: number) => { const d = new Date(t); return new Date(t - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
export function MeasurementChart(props: MeasurementChartProps) {
  const [duration, setDuration] = useState(3600000), [live, setLive] = useState(false);
  const [range, setRange] = useState<TimeWindow | null>(null), [result, setResult] = useState<MeasurementSeries>({ points: [] });
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState(0), [refresh, setRefresh] = useState(0);
  const [picker, setPicker] = useState(false), [draft, setDraft] = useState<DateRange>(), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [selectingEnd, setSelectingEnd] = useState(false);
  const [liveStarted, setLiveStarted] = useState<number | null>(null);
  const [retainedHistory, setRetainedHistory] = useState<{ range: TimeWindow; data: MeasurementSeries; queryKey?: string } | null>(null);
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null);
  const cache = useRef<{ range: TimeWindow; data: MeasurementSeries; queryKey?: string }>();
  const latestRequest = useRef<AbortController>();
  const cancelLatest = () => latestRequest.current?.abort();
  useEffect(() => () => latestRequest.current?.abort(), []);
  const requestRef = useRef(props.request); requestRef.current = props.request;
  const durationRef = useRef(duration); durationRef.current = duration;
  // Initialise at the latest stored window, explicitly labelled Historical. Live always uses wall time.
  useEffect(() => {
    const controller = new AbortController(); let mounted = true;
    cache.current = undefined; setResult({ points: [] }); setRange(null); setError(''); setRetainedHistory(null); setLiveStarted(null);
    async function initialise() {
      try {
        const last = props.latestEndpoint ? await requestRef.current(props.latestEndpoint, controller.signal) : null;
        const fresh = !props.initialEnd && !!last?.point && Date.now() - Date.parse(last.point.timestamp) <= (props.expectedSeconds || 15) * 3000;
        const end = props.initialEnd || (fresh ? Date.now() : last?.point ? Date.parse(last.point.timestamp) + 1 : Date.now());
        if (mounted) { setLiveStarted(fresh ? Date.now() : null); setLive(fresh); setRange({ start: end - durationRef.current, end }); }
      } catch (e) { if (mounted) setError((e as Error).message); }
    }
    if (props.endpoint) void initialise();
    return () => { mounted = false; controller.abort(); };
  }, [props.endpoint, props.latestEndpoint, props.initialEnd]);
  useEffect(() => {
    if (!live) return;
    const tick = () => { if (!document.hidden) { const end = Date.now(); setRange({ start: end - duration, end }); } };
    tick(); const timer = setInterval(tick, 15000); document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [live, duration]);
  useEffect(() => {
    if (!range || !props.endpoint) return;
    if (props.series && !props.series.length) { setResult({ points: [] }); cache.current = undefined; setLoading(false); setError(''); return; }
    const controller = new AbortController(); let mounted = true;
    setLoading(true); setProgress(0); setError('');
    const previous = cache.current;
    const incremental = props.incremental !== false && live && previous && previous.queryKey === props.queryKey && previous.range.start <= range.start && previous.range.end >= range.start && previous.range.end < range.end;
    const queryRange = incremental ? { start: Math.max(range.start, previous.range.end - 30000), end: range.end } : range;
    void loadWindow(requestRef.current, props.endpoint, queryRange, controller.signal, count => { if (mounted) setProgress(count); }).then(data => {
      if (!mounted) return;
      if (incremental) {
        const merged = mergeWindow(previous.data.points, data.points, range);
        data = { ...data, points: compactPoints(merged, range), sample_count: undefined,
          resolution: previous.data.resolution, bucket_seconds: Math.max(previous.data.bucket_seconds || 0, merged.length > 1200 ? (range.end - range.start) / 240000 : 0),
          generated_count: undefined };
      }
      cache.current = { range, data, queryKey: props.queryKey }; setResult(data);
    }).catch(e => { if (mounted && !controller.signal.aborted) setError((e as Error).message); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; controller.abort(); };
  }, [range, props.endpoint, props.queryKey, live, refresh]);
  // Old demonstration data must remain explicitly historical while we watch the
  // current window. Never stretch September timestamps into today's Live axis.
  const showingRetained = !!(live && retainedHistory && range && retainedHistory.range.end < range.start && !result.points.some(p => Date.parse(p.timestamp) >= range.start && typeof p.value === 'number'));
  const displayResult = showingRetained ? retainedHistory!.data : result;
  const displayRange = showingRetained ? retainedHistory!.range : range;
  const plotSeries = useMemo(() => {
    const channels = props.series || [{ id: 'value', title: props.title, unit: props.unit, expectedSeconds: props.expectedSeconds, color: 'var(--brand)' }];
    return channels.map(c => ({ ...c, rows: plotRows({ ...displayResult, points: props.series ? displayResult.points.filter(p => p.channelId === c.id) : displayResult.points }, c.expectedSeconds).map(r => ({ ...r, [c.id]: r.value })) }));
  }, [displayResult, props.series, props.title, props.unit, props.expectedSeconds]);
  const rows = useMemo(() => plotSeries.flatMap(c => c.rows).sort((a, b) => a.epochMs - b.epochMs), [plotSeries]);
  const unitGroups = useMemo(() => {
    const groups = new Map<string, typeof plotSeries>();
    plotSeries.forEach(c => { const key = c.unit && !/unconfirmed|unknown/i.test(c.unit) ? c.unit : c.id; groups.set(key, [...(groups.get(key) || []), c]); });
    return [...groups.values()];
  }, [plotSeries]);
  const ticks = useMemo(() => { if (!displayRange) return []; const step = resolveAxisTickStepMs(displayRange.start, displayRange.end, 60000); const values: number[] = []; for (let t = Math.ceil(displayRange.start / step) * step; t < displayRange.end; t += step) values.push(t); return values; }, [displayRange]);
  const numeric = rows.filter(r => r.value !== null), last = numeric[numeric.length - 1];
  const stale = live && (!last || Date.now() - last.epochMs > Math.max(props.expectedSeconds || 15, displayResult.bucket_seconds || 0) * 3000);
  const toggleLive = () => {
    cancelLatest();
    if (live) { if (showingRetained) { setRange(retainedHistory!.range); setResult(retainedHistory!.data); cache.current = retainedHistory!; } setLive(false); return; }
    setRetainedHistory(cache.current?.data.points.length ? cache.current : null);
    setLiveStarted(Date.now()); setLive(true);
  };
  const choose = (ms: number) => { cancelLatest(); setDuration(ms); if (showingRetained) setLive(false); const end = live && !showingRetained ? Date.now() : displayRange?.end || Date.now(); setRange({ start: end - ms, end }); };
  const shift = (direction: number) => { cancelLatest(); if (displayRange) { setLive(false); const delta = displayRange.end - displayRange.start; setRange({ start: displayRange.start + delta * direction, end: displayRange.end + delta * direction }); } };
  const openPicker = () => { if (displayRange) { setFrom(localInput(displayRange.start)); setTo(localInput(displayRange.end)); setDraft({ from: new Date(displayRange.start), to: new Date(displayRange.end - 1) }); } setSelectingEnd(false); setPicker(!picker); };
  const selectDay = (day: Date) => {
    const selected = new Date(day); selected.setHours(0, 0, 0, 0);
    if (!selectingEnd || !draft?.from) { setDraft({ from: selected }); setFrom(localInput(+selected)); setTo(''); setSelectingEnd(true); return; }
    const first = new Date(Math.min(+draft.from, +selected)), last = new Date(Math.max(+draft.from, +selected));
    const until = new Date(last); until.setDate(until.getDate() + 1);
    setDraft({ from: first, to: last }); setFrom(localInput(+first)); setTo(localInput(+until)); setSelectingEnd(false);
  };
  const editDates = (start: string, end: string) => {
    setFrom(start); setTo(end); setSelectingEnd(false);
    setDraft({ from: Number.isFinite(Date.parse(start)) ? new Date(start) : undefined, to: Number.isFinite(Date.parse(end)) ? new Date(Date.parse(end) - 1) : undefined });
  };
  const latestWindow = async () => {
    cancelLatest(); const controller = new AbortController(); latestRequest.current = controller;
    try {
      setError('');
      const last = props.latestEndpoint ? await requestRef.current(props.latestEndpoint, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])) : null;
      if (controller.signal.aborted) return;
      const end = props.initialEnd || (last?.point ? Date.parse(last.point.timestamp) + 1 : Date.now());
      setLive(false); setRange({ start: end - durationRef.current, end });
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
  };
  const validDraft = Date.parse(to) > Date.parse(from) && Date.parse(to) - Date.parse(from) <= 31 * 86400000;
  const applyDates = () => { if (!validDraft) return; cancelLatest(); setLive(false); setRange({ start: Date.parse(from), end: Date.parse(to) }); setDuration(Date.parse(to) - Date.parse(from)); setPicker(false); };
  const zoom = () => { cancelLatest(); if (drag && Math.abs(drag.end - drag.start) >= 1000) { setLive(false); const next = { start: Math.min(drag.start, drag.end), end: Math.max(drag.start, drag.end) }; setRange(next); setDuration(next.end - next.start); } setDrag(null); };
  return <div className="telemetry-workspace" role="region" aria-label={`${props.title} chart`}>
    <div className="telemetry-toolbar"><div className="telemetry-presets" role="group" aria-label="Time window">{presets.map(p => <button key={p.label} className={duration === p.ms ? 'is-active' : ''} onClick={() => choose(p.ms)}>{p.label}</button>)}</div>
      <div className="telemetry-tools"><button aria-label="Previous window" onClick={() => shift(-1)} disabled={!range}><ChevronLeft size={16} /></button><button aria-label="Next window" onClick={() => shift(1)} disabled={!displayRange || displayRange.end >= Date.now()}><ChevronRight size={16} /></button>
      <button className="telemetry-date" onClick={openPicker} aria-expanded={picker}><CalendarDays size={15} />{displayRange ? `${date(displayRange.start)} — ${date(displayRange.end)}` : 'Select dates'}</button>
      <button aria-label="Latest stored window" title="Latest stored window" onClick={() => void latestWindow()} disabled={!props.endpoint}><History size={15} /></button><button title={live ? stale ? "Waiting for new readings · checking every 15 seconds" : "Receiving readings · checking every 15 seconds" : "Follow incoming readings"} className={live ? 'is-active' : ''} aria-pressed={live} onClick={toggleLive} disabled={!props.endpoint}><Radio size={15} />Live</button><button aria-label="Refresh measurements" disabled={loading || !props.endpoint} onClick={() => { if (!range) void latestWindow(); else setRefresh(v => v + 1); }}><RefreshCw size={15} className={loading ? 'is-refreshing' : ''} /></button></div>
      {picker && <div className="telemetry-calendar"><div className="telemetry-calendar-head"><strong>Choose a time window</strong><button aria-label="Close calendar" onClick={() => setPicker(false)}><X size={16} /></button></div>
        <p className="telemetry-calendar-hint">{selectingEnd ? 'Select the last day. Both days are included.' : 'Select a start day, then an end day.'}</p>
        <DayPicker mode="range" weekStartsOn={1} selected={draft} defaultMonth={draft?.from} onSelect={() => {}} onDayClick={selectDay} />
        <div className="telemetry-date-fields"><label>From<input aria-label="Start date and time" type="datetime-local" value={from} onInput={e => editDates(e.currentTarget.value, to)} onChange={e => editDates(e.target.value, to)} /></label><label>Until<input aria-label="End date and time" type="datetime-local" value={to} onInput={e => editDates(from, e.currentTarget.value)} onChange={e => editDates(from, e.target.value)} /></label></div><div className="telemetry-calendar-foot"><small>Local time · end time is exclusive · max. 31 days</small><button disabled={!validDraft} onClick={applyDates}>Apply range</button></div></div>}
    </div>
    {live && showingRetained && <div className="telemetry-live-context" role="status">{showingRetained ? `No recent readings. Showing stored history from ${date(displayRange!.start)} to ${date(displayRange!.end)}. Live is checking the current time every 15 s.` : `Historical readings + live updates · live started ${date(liveStarted || Date.now())}.`}</div>}
    {displayResult.errors?.length ? <p className="telemetry-series-errors" role="status">{displayResult.errors.join(' · ')}</p> : null}
    {props.series && !props.series.length ? <div className="telemetry-empty"><h3>Select a measurement below</h3><p>Use the pills to show or hide readings. Additional channels are available under Measurement channels.</p></div> : !props.endpoint ? <div className="telemetry-empty"><Link2 size={26} /><h3>No measurement source linked</h3><p>Connect this sensor to a stored field to see its readings.</p></div> : error ? <div className="telemetry-empty" role="alert"><h3>Could not load measurements</h3><p>{error}</p><button onClick={() => { if (!range) void latestWindow(); else setRefresh(v => v + 1); }}>Retry</button></div> : !numeric.length ? <div className="telemetry-empty"><Radio size={26} /><h3>{loading ? 'Loading measurements' : 'No readings in this window'}</h3><p>{loading ? 'Reading the selected sensor through Telemetry.' : live ? 'Live is on. New readings will appear here automatically.' : 'Choose another period or turn on Live.'}</p></div> : <div className="telemetry-canvas" aria-label="Measurement chart">
      {unitGroups.map((group) => <div className="telemetry-unit-plot" key={group[0].id}>

      <TimeseriesPlot data={group.flatMap(c => c.rows).sort((a, b) => a.epochMs - b.epochMs)} height={unitGroups.length > 1 ? 270 : 350} margin={{ top: 18, right: 24, left: 14, bottom: 28 }} onMouseDown={s => { const t = Number(s.activeLabel); if (Number.isFinite(t)) setDrag({ start: t, end: t }); }} onMouseMove={s => { const t = Number(s.activeLabel); if (drag && Number.isFinite(t)) setDrag({ ...drag, end: t }); }} onMouseUp={zoom} onMouseLeave={() => setDrag(null)}>
        <XAxis height={48} label={{ value: `Time (${Intl.DateTimeFormat().resolvedOptions().timeZone})`, position: "insideBottom", offset: -16, fill: "var(--muted)", fontSize: 11 }} type="number" dataKey="epochMs" scale="time" ticks={ticks} domain={displayRange ? [displayRange.start, displayRange.end + (live && !showingRetained ? Math.min(300000, duration * .05) : 0)] : ['dataMin', 'dataMax']} allowDataOverflow axisLine={false} tickLine={false} minTickGap={65} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickMargin={14} tickFormatter={v => duration > 86400000 ? date(v, duration <= 3 * 86400000) : new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} />
        <YAxis label={{ value: group[0].unit || "Unit unconfirmed", angle: -90, position: "insideLeft", fill: "var(--muted)", fontSize: 11 }} width={76} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} domain={['auto', 'auto']} tickFormatter={v => Number(v).toLocaleString('en-GB', { maximumSignificantDigits: 4, notation: Math.abs(v) >= 100000 ? 'compact' : 'standard' })} />
        <Tooltip content={({ active, label }) => {
          if (!active || !Number.isFinite(Number(label))) return null;
          const hits = group.map(c => {
            const nearest = c.rows.reduce<(typeof c.rows)[number] | null>((best, row) => !best || Math.abs(row.epochMs - Number(label)) < Math.abs(best.epochMs - Number(label)) ? row : best, null);
            const tolerance = Math.max((c.expectedSeconds || 0) * 1500, (displayResult.bucket_seconds || 0) * 2000);
            return { c, row: nearest && Math.abs(nearest.epochMs - Number(label)) <= tolerance ? nearest : null };
          });
          return <div className="telemetry-tooltip"><small>{date(Number(label))}</small>{hits.map(({ c, row }) => <div key={c.id}><small style={{ color: c.color }}>{c.title}</small><strong>{row?.value == null ? 'No reading' : row.value.toLocaleString('en-GB', { maximumSignificantDigits: 6 })} <span>{c.unit || 'Unit unconfirmed'}</span></strong>{row && <small>{date(row.epochMs)}{row.generated ? ' · generated by source' : ''}</small>}</div>)}</div>;
        }} />
        {group.map(c => <Line key={c.id} data={c.rows} name={c.title} type="linear" dataKey={c.id} stroke={c.color} strokeWidth={2.2} dot={c.rows.filter(r => r.value !== null).length === 1} activeDot={false} connectNulls={false} isAnimationActive={false} />)}
        {live && !showingRetained && liveStarted !== null && displayRange && liveStarted >= displayRange.start && liveStarted <= displayRange.end && <ReferenceLine x={liveStarted} stroke="var(--muted)" strokeDasharray="4 4" label={{ value: 'Live started', position: 'insideTopRight', fill: 'var(--muted)', fontSize: 10 }} />}
        {drag && <ReferenceArea x1={Math.min(drag.start, drag.end)} x2={Math.max(drag.start, drag.end)} fill="var(--brand)" fillOpacity={0.1} strokeOpacity={0} />}
      </TimeseriesPlot></div>)}</div>}
    <span className="chart-sr-only" role="status">{loading ? `Loading measurements${progress ? ` · ${progress.toLocaleString()} samples` : ''}` : ''}</span>

  </div>;
}
