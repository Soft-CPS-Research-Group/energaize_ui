import { useState, useMemo, useEffect, type SetStateAction } from 'react';
import {
    ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    ReferenceLine, Line
} from 'recharts';
import { Button } from "react-bootstrap";
import DateRangeSlider from "../DateRangeSlider";
import "./CardCharger.css";

const floorToMidnightLocal = (ts: number): number => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
};

const ceilToEndOfDayLocal = (ts: number): number => {
    const d = new Date(ts);
    d.setHours(23, 59, 59, 999);
    return d.getTime();
};

const getLocalDateKey = (ts: number): string => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const intervals = [
    { value: 0.25, label: "15 sec"  },
    { value: 0.5, label: "30 sec"  },
    { value: 1, label: "1 min" },
    { value: 5, label: "5 min" },
    { value: 15, label: "15 min" },
    { value: 60, label: "1h" },
    { value: 720, label: "12h"},
    { value: 1440, label: "1d" },
    { value: 10080, label: "7d"},
    { value: 43200, label: "30d"}
];

const MAX_POINTS = 800;
const LIVE_WINDOW_MIN = 10;

const aggregateGroup = (groupStart: number, group: any[]) => {
    const values = group.map(i => i['Power']).filter(v => v !== null && !isNaN(v));
    return {
        timestamp: groupStart,
        'Time Step': group[0]['Time Step'],
        'electric_vehicle': group[0]['electric_vehicle'],
        'Power': values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    };
};

const aggregateData = (data: any[], intervalMinutes: number) => {
    if (!data.length) return [];
    const intervalMs = intervalMinutes * 60 * 1000;
    const result: any[] = [];
    let groupStart = data[0].timestamp;
    let tempGroup: any[] = [];
    for (const item of data) {
        if (item.timestamp - groupStart < intervalMs) {
            tempGroup.push(item);
        } else {
            result.push(aggregateGroup(groupStart, tempGroup));
            groupStart = item.timestamp;
            tempGroup = [item];
        }
    }
    if (tempGroup.length > 0) result.push(aggregateGroup(groupStart, tempGroup));
    return result;
};

const getDayTransitionTicks = (data: any[]): string[] => {
    if (!data.length) return [];
    const ticks: string[] = [];
    let lastDateStr = "";
    for (const item of data) {
        const d = getLocalDateKey(item.timestamp);
        if (d !== lastDateStr) { ticks.push(item['Time Step']); lastDateStr = d; }
    }
    return ticks;
};

const getClosestData = (targetTs: number, aggregatedData: any[]): string => {
    if (!aggregatedData.length) return "";
    let closest = aggregatedData[0];
    let minDiff = Math.abs(targetTs - closest.timestamp);
    for (let i = 1; i < aggregatedData.length; i++) {
        const item = aggregatedData[i];
        if (item.timestamp === targetTs) return item['Time Step'];
        const diff = Math.abs(targetTs - item.timestamp);
        if (diff < minDiff) { minDiff = diff; closest = item; }
    }
    return closest['Time Step'];
};

type EVEventType = 'arrival' | 'departure' | 'collision' | 'swap';

interface EVEvent {
    type: EVEventType;
    name?: string;
    from?: string;
    to?: string;
    events?: Array<{ evName: string; type: 'arrival' | 'departure'; timestamp: number }>;
}

type EVEventMap = Map<string, EVEvent>;

const getEVEvents = (data: any[], aggregatedData: any[]) => {
    const eventsByStep: Record<string, EVEvent> = {};

    for (let i = 1; i < data.length; i++) {
        const prev = data[i - 1];
        const curr = data[i];
        const prevEV = (prev['electric_vehicle'] && prev['electric_vehicle'] !== 'none') ? prev['electric_vehicle'] : 'none';
        const currEV = (curr['electric_vehicle'] && curr['electric_vehicle'] !== 'none') ? curr['electric_vehicle'] : 'none';
        if (prevEV === currEV) continue;

        const aux        = getClosestData(curr.timestamp, aggregatedData);
        
        const isArrival  = prevEV === 'none' && currEV !== 'none';
        const isDeparture = prevEV !== 'none' && currEV === 'none';
        const existing   = eventsByStep[aux];
        
        /*if (isArrival || isDeparture) {
            const options: Intl.DateTimeFormatOptions = {
                timeZone: 'Europe/Lisbon',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                day: '2-digit',
                month: '2-digit'
            };

            const tipo = isArrival ? 'ARRIVAL' : 'DEPARTURE';
            const originalHora = new Date(curr.timestamp).toLocaleString('pt-PT', options);

            // O aux é o "Time Step" (ISO String) vindo do getClosestData
            const aproxHora = new Date(aux).toLocaleString('pt-PT', options);

            console.log(`[${tipo}] Original: ${originalHora} | Aproximada (5min): ${aproxHora} | Veículo: ${isArrival ? currEV : prevEV}`);
        }*/
        
        if (existing) {
            if (existing.type === 'collision') {
                existing.events!.push({
                    evName: isArrival ? currEV : prevEV,
                    type: isArrival ? 'arrival' : 'departure',
                    timestamp: curr.timestamp,
                });
            } else if ((existing.type === 'arrival' && isArrival) || (existing.type === 'departure' && isDeparture)) {
                eventsByStep[aux] = {
                    type: 'collision',
                    events: [
                        { evName: existing.name!, type: existing.type as 'arrival' | 'departure', timestamp: curr.timestamp },
                        { evName: isArrival ? currEV : prevEV, type: isArrival ? 'arrival' : 'departure', timestamp: curr.timestamp },
                    ],
                };
            } else if ((existing.type === 'arrival' && isDeparture) || (existing.type === 'departure' && isArrival)) {
                eventsByStep[aux] = {
                    type: 'swap',
                    from: isDeparture ? prevEV : existing.name,
                    to:   isArrival   ? currEV : existing.name,
                };
            } else if (existing.type === 'swap') {
                eventsByStep[aux] = {
                    type: 'collision',
                    events: [
                        { evName: existing.from!, type: 'departure', timestamp: curr.timestamp },
                        { evName: existing.to!,   type: 'arrival',   timestamp: curr.timestamp },
                        { evName: isArrival ? currEV : prevEV, type: isArrival ? 'arrival' : 'departure', timestamp: curr.timestamp },
                    ],
                };
            }
        } else if (isArrival) {
            eventsByStep[aux] = { type: 'arrival', name: currEV };
        } else if (isDeparture) {
            eventsByStep[aux] = { type: 'departure', name: prevEV };
        }
    }

    const arrivals   = Object.entries(eventsByStep).filter(([,v]) => v.type === 'arrival')  .map(([k]) => k);
    const departures = Object.entries(eventsByStep).filter(([,v]) => v.type === 'departure').map(([k]) => k);
    const collisions = Object.entries(eventsByStep).filter(([,v]) => v.type === 'collision').map(([k]) => k);
    const swaps      = Object.entries(eventsByStep).filter(([,v]) => v.type === 'swap')     .map(([k]) => k);

    const eventMap: EVEventMap = new Map(Object.entries(eventsByStep));

    return { arrivals, departures, collisions, swaps, eventMap };
};

const shortenEVName = (name: string) => name.replace(/Electric_Vehicle?-?/i, 'EV-');

const EVENT_LABELS: Record<EVEventType, string> = {
    arrival:   'Arrival',
    departure: 'Departure',
    swap:      'EV Exchange',
    collision: 'Data Overlap',
};
const EVENT_COLORS: Record<EVEventType, string> = {
    arrival:   '#22c55e',
    departure: '#ef4444',
    swap:      '#f59e0b',
    collision: '#d946ef',
};

interface CustomTooltipProps {
    active?: boolean;
    payload?: any[];
    label?: string;
    eventMap: EVEventMap;
}

const CustomTooltip = ({ active, payload, label, eventMap }: CustomTooltipProps) => {
    if (!active || !payload?.length) return null;

    const power = payload.find(p => p.dataKey === 'Power');
    const event = label ? eventMap.get(label) : undefined;

    return (
        <div style={{
            backgroundColor: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: 8,
            padding: '10px 14px',
            color: '#fff',
            fontSize: 12,
            minWidth: 180,
        }}>
            <div>
                {label ? new Date(label).toLocaleString() : ''}
            </div>

            {power && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: event ? 10 : 0 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#0088FE', flexShrink: 0 }} />
                    <span style={{ color: '#bbb' }}>Power</span>
                    <span style={{ marginLeft: 'auto', fontWeight: 'bold' }}>
                        {Number(power.value).toFixed(3)} kWh
                    </span>
                </div>
            )}

            {event && (
                <>
                    <div style={{ borderTop: '1px solid #2a2a2a', margin: '6px 0' }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{
                            width: 8, height: 8, borderRadius: '50%',
                            background: EVENT_COLORS[event.type], flexShrink: 0,
                        }} />
                        <span style={{ color: EVENT_COLORS[event.type], fontWeight: 'bold', fontSize: 11 }}>
                            {EVENT_LABELS[event.type]}
                        </span>
                    </div>

                    {(event.type === 'arrival' || event.type === 'departure') && event.name && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 14 }}>
                            <span style={{ color: EVENT_COLORS[event.type], fontWeight: 'bold' }}>
                                {event.type === 'arrival' ? '↑' : '↓'}
                            </span>
                            <span>{shortenEVName(event.name)}</span>
                        </div>
                    )}

                    {event.type === 'swap' && (
                        <div style={{ paddingLeft: 14, display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ color: '#ef4444', fontWeight: 'bold' }}>↓</span>
                                <span style={{ color: '#bbb' }}>{shortenEVName(event.from!)}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ color: '#22c55e', fontWeight: 'bold' }}>↑</span>
                                <span style={{ color: '#bbb' }}>{shortenEVName(event.to!)}</span>
                            </div>
                        </div>
                    )}

                    {event.type === 'collision' && event.events && (
                        <div style={{ paddingLeft: 14, display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {[...event.events]
                                .sort((a, b) => a.timestamp - b.timestamp)
                                .map((ev, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{
                                            color: ev.type === 'arrival' ? '#22c55e' : '#ef4444',
                                            fontWeight: 'bold',
                                        }}>
                                            {ev.type === 'arrival' ? '↑' : '↓'}
                                        </span>
                                        <span style={{ color: '#bbb' }}>{shortenEVName(ev.evName)}</span>
                                        <span style={{ color: '#555', fontSize: 10 }}>({ev.type})</span>
                                    </div>
                                ))
                            }
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

interface ChargerData {
    timestamp: string | number | Date;
    Power: string | number;
    electric_vehicle: string;
}
interface Props { data: ChargerData[]; title: string; isLive: boolean }

function CardCharger({ data, title, isLive}: Props) {

    const updatedData = useMemo(() => {
        if (!data || data.length === 0) return [];
        return data
            .map(item => ({
                ...item,
                'Time Step': new Date(item.timestamp).toISOString(),
                timestamp:   new Date(item.timestamp).getTime(),
                'Power': typeof item.Power === 'string' ? parseFloat(item.Power) : item.Power,
            }))
            .sort((a, b) => a.timestamp - b.timestamp);
    }, [data]);

    const metadata = useMemo(() => {
        if (updatedData.length === 0) return { min: 0, max: 0, baseInt: 1 };
        const min     = floorToMidnightLocal(updatedData[0].timestamp);
        const max     = ceilToEndOfDayLocal(updatedData[updatedData.length - 1].timestamp);
        const baseInt = updatedData.length > 1
            ? Math.max(0.25, (updatedData[1].timestamp - updatedData[0].timestamp) / 60000)
            : 1;
        return { min, max, baseInt };
    }, [updatedData]);

    const [sliderValues,   setSliderValues]   = useState<number[]>([0, 0]);
    const [intervalInput,  setIntervalInput]  = useState<number>(0);
    const [init,           setInit]           = useState(false);

    const filteredData = useMemo(
        () => updatedData.filter(i => i.timestamp >= sliderValues[0] && i.timestamp <= sliderValues[1]),
        [updatedData, sliderValues]
    );

    const checkViability = (interval: number): boolean => {
        if (isLive){
            const timeMs = LIVE_WINDOW_MIN * 60 * 1000;
            const intervalMs = interval * 60 * 1000;

            return intervalMs < timeMs;
        }
        const timeMs = sliderValues[1] - sliderValues[0];
        const intervalMs = interval * 60 * 1000;

        if (intervalMs > timeMs) return false;

        const qtdPoints = timeMs / intervalMs;
        return qtdPoints <= MAX_POINTS;
    };

    useEffect(() => {
        if (!init && updatedData.length > 0) {
            const ppd        = Math.floor((24 * 60) / metadata.baseInt);
            const defaultEnd = ceilToEndOfDayLocal(updatedData[ppd * 10]?.timestamp ?? metadata.max);
            setSliderValues([metadata.min, defaultEnd]);
            const viable = intervals.find(({ value }) => checkViability(value));
            if (viable) setIntervalInput(viable.value);
            setInit(true);
        }
    }, [updatedData, init, metadata]);

    useEffect(() => {
        const viable = intervals.find(({ value }) => checkViability(value));
        if (viable) {
            const ok = intervals.some(({ value }) => value === intervalInput && checkViability(value));
            if (!ok) setIntervalInput(viable.value);
        } else {
            const auto = Math.max(metadata.baseInt, Math.ceil((sliderValues[1] - sliderValues[0]) / (MAX_POINTS * 60 * 1000)));
            setIntervalInput(auto);
        }
    }, [sliderValues, isLive]);

    const aggregatedData = useMemo(() => aggregateData(filteredData, intervalInput),   [filteredData, intervalInput]);
    const xAxisTicks     = useMemo(() => getDayTransitionTicks(aggregatedData),         [aggregatedData]);
    const { arrivals, departures, collisions, swaps, eventMap } = useMemo(
        () => getEVEvents(filteredData, aggregatedData),
        [filteredData, aggregatedData]
    );

    const handleSliderChange  = (v: SetStateAction<number[]>) => {
        if (!isLive) {
            setSliderValues(v as number[]);
        }
    }
    const handleApplyInterval = (interval: number) => setIntervalInput(Math.max(metadata.baseInt, interval));

    if (!data || data.length === 0)
        return <div style={{ color: "#9e9e9e", padding: "20px" }}>No data available.</div>;

    return (
        <div className="charger-card">
            <div className="card-body">

                <div className="card-top">
                    <span className="fw-bold">{title}</span>
                    <div className="card-info">
                        {intervals.filter(({ value }) => checkViability(value)).length > 0
                            ? intervals.filter(({ value }) => checkViability(value)).map(({ value, label }) => (
                                <Button key={value} size="sm"
                                        variant={intervalInput === value ? "primary" : "secondary"}
                                        className={intervalInput === value ? "btn-interval active" : "btn-interval"}
                                        onClick={() => handleApplyInterval(value)}>
                                    {label}
                                </Button>
                            ))
                            : <span className="auto-adj-badge">
                                <i className="bi bi-cpu-fill me-1" />
                                AUTO: {intervalInput} MIN
                              </span>
                        }
                    </div>
                </div>

                <div className="series-container">
                    <div className="series-item">
                        <span className="ev-legend-dot" style={{ background: '#0088FE' }} />
                        <span className="series-label">Power (kWh)</span>
                    </div>
                    <div className="series-item">
                        <span className="ev-legend-line" style={{ background: '#22c55e' }} />
                        <span className="series-label">EV Arrival</span>
                    </div>
                    <div className="series-item">
                        <span className="ev-legend-line" style={{ background: '#ef4444' }} />
                        <span className="series-label">EV Departure</span>
                    </div>
                    <div className="series-item">
                        <span className="ev-legend-line" style={{
                            background: 'repeating-linear-gradient(to right, #f59e0b 0, #f59e0b 5px, transparent 5px, transparent 8px)'
                        }} />
                        <span className="series-label">EV Exchange (Swap)</span>
                    </div>
                    <div className="series-item">
                        <span className="ev-legend-line" style={{
                            background: '#d946ef', height: '4px',
                            boxShadow: '0 0 4px rgba(217,70,239,0.5)'
                        }} />
                        <span className="series-label">Data Overlap / Conflict</span>
                    </div>
                </div>

                <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={aggregatedData} stackOffset="sign"
                                   margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>

                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
                        <XAxis
                            dataKey="Time Step"
                            ticks={xAxisTicks}
                            tickFormatter={(t) => t.slice(0, 10)}
                            angle={-30}
                            textAnchor="end"
                            height={70}
                            dy={5}
                            interval="preserveStartEnd"
                            tick={{ fontSize: 10, fill: '#888' }}
                        />
                        <YAxis
                            yAxisId="left"
                            orientation="left"
                            tick={{ fontSize: 11, fill: "#888" }}
                            width={60}
                            label={{
                                value: "kWh",
                                angle: -90,
                                position: "insideLeft",
                                offset: 10,
                                fill: "#888",
                                fontSize: 12
                            }}
                        />

                        <Tooltip
                            content={(props) => (
                                <CustomTooltip {...props as any} eventMap={eventMap} />
                            )}
                        />

                        <Legend iconType="rect" />

                        <Line yAxisId="left" type="monotone" dataKey="Power"
                              stroke="#0088FE" dot={false} strokeWidth={2} />

                        {arrivals.map(ts => (
                            <ReferenceLine key={`arr-${ts}`} x={ts} yAxisId="left"
                                           stroke="#22c55e" strokeWidth={2} strokeDasharray="6 3" />
                        ))}
                        {departures.map(ts => (
                            <ReferenceLine key={`dep-${ts}`} x={ts} yAxisId="left"
                                           stroke="#ef4444" strokeWidth={2} strokeDasharray="6 3" />
                        ))}
                        {swaps.map(ts => (
                            <ReferenceLine key={`swap-${ts}`} x={ts} yAxisId="left"
                                           stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 3" />
                        ))}
                        {collisions.map(ts => (
                            <ReferenceLine key={`col-${ts}`} x={ts} yAxisId="left"
                                           stroke="#d946ef" strokeWidth={2} strokeDasharray="6 3" />
                        ))}

                    </ComposedChart>
                </ResponsiveContainer>

                <div className="mt-4">
                    <DateRangeSlider
                        minTimestamp={metadata.min}
                        maxTimestamp={metadata.max}
                        sliderValues={sliderValues}
                        onSliderChange={handleSliderChange}
                    />
                </div>
            </div>
        </div>
    );
}

export default CardCharger;