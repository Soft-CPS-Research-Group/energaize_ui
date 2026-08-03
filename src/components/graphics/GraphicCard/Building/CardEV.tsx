import { useState, useMemo, useEffect, type SetStateAction } from 'react';
import {
    ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, Line, ReferenceLine
} from 'recharts';
import { Button } from "react-bootstrap";
import DateRangeSlider from "../DateRangeSlider";
import "./CardEV.css";

interface EVDataItem {
    timestamp: string | number;
    'EV Estimated SOC Arrival-%': string | number | null;
    'EV Required SOC Departure-%': string | number | null;
    'EV SOC-%': string | number | null;
    'EV Departure Time'?: string;
    'EV Arrival Time'?: string;
    [key: string]: any;
}

interface EVProps {
    data: EVDataItem[];
    title: string;
    isLive: boolean;
}

type SeriesKey =
    | 'EV Estimated SOC Arrival-%'
    | 'EV Required SOC Departure-%'
    | 'EV SOC-%'
    | 'EV Arrival Time'
    | 'EV Departure Time';

const SERIES_COLORS: Record<SeriesKey, string> = {
    'EV Estimated SOC Arrival-%': '#0088FE',
    'EV Required SOC Departure-%': '#FF7300',
    'EV SOC-%': '#F5C227',
    'EV Arrival Time': '#28a745',
    'EV Departure Time': '#dc3545',
};

const SERIES_NAMES: Record<SeriesKey, string> = {
    'EV Estimated SOC Arrival-%': 'Est. Arrival %',
    'EV Required SOC Departure-%': 'Req. Departure %',
    'EV SOC-%': 'Actual SOC %',
    'EV Arrival Time': 'Arrival Time',
    'EV Departure Time': 'Departure Time',
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

const MAX_POINTS = 500;
const LIVE_WINDOW_MIN = 10;

const floorToMidnightUTC = (ts: number): number => {
    const d = new Date(ts);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
};

const ceilToEndOfDayUTC = (ts: number): number => {
    const d = new Date(ts);
    d.setUTCHours(23, 59, 59, 999);
    return d.getTime();
};

const parseSOC = (value: string | number | null): number | null => {
    if (value === "-1.00" || value === "-0.1" || value === null) return null;
    return parseFloat(value as string);
};

const SOC_KEYS: SeriesKey[] = [
    'EV Estimated SOC Arrival-%',
    'EV Required SOC Departure-%',
    'EV SOC-%',
];

const processGroup = (groupStart: number, group: any[]) => {
    const aggregated: any = {
        timestamp: groupStart,
        'Time Step': group[0]['Time Step'],
    };
    SOC_KEYS.forEach(key => {
        const values = group.map(i => i[key]).filter((v): v is number => v !== null);
        aggregated[key] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    });
    return aggregated;
};

const aggregateData = (data: any[], intervalMinutes: number, baseInt: number) => {
    if (!data.length) return [];
    if (intervalMinutes <= baseInt) {
        return data.map(i => ({ ...i }));
    }
    const intervalMs = intervalMinutes * 60 * 1000;
    const result: any[] = [];
    let groupStart = data[0].timestamp;
    let tempGroup: any[] = [];

    for (const item of data) {
        if (item.timestamp - groupStart < intervalMs) {
            tempGroup.push(item);
        } else {
            result.push(processGroup(groupStart, tempGroup));
            groupStart = item.timestamp;
            tempGroup = [item];
        }
    }
    if (tempGroup.length > 0) result.push(processGroup(groupStart, tempGroup));
    return result;
};

const getEvents = (data: any[]): Map<string, number[]> => {
    const events = new Map<string, number[]>([
        ['Arrival', []],
        ['Departure', []],
    ]);
    const seen = new Set<string>();

    for (const item of data) {
        if (item['EV Arrival Time'] && !seen.has(item['EV Arrival Time'])) {
            seen.add(item['EV Arrival Time']);
            events.get('Arrival')!.push(new Date(item['EV Arrival Time']).getTime());
        }
        if (item['EV Departure Time'] && !seen.has(item['EV Departure Time'])) {
            seen.add(item['EV Departure Time']);
            events.get('Departure')!.push(new Date(item['EV Departure Time']).getTime());
        }
    }
    return events;
}


const getDayTransitionTicks = (data: any[]): string[] => {
    if (!data.length) return [];
    const ticks: string[] = [];
    let lastDateStr = "";
    for (const item of data) {
        const currentDateStr = new Date(item.timestamp).toISOString().slice(0, 10);
        if (currentDateStr !== lastDateStr) {
            ticks.push(item['Time Step']);
            lastDateStr = currentDateStr;
        }
    }
    return ticks;
};

function CardEV({ data, title, isLive }: EVProps) {

    const updatedData = useMemo(() => {
        if (!data || data.length === 0) return [];
        return data
            .map((item) => ({
                ...item,
                'Time Step': new Date(item.timestamp).toISOString(),
                timestamp: new Date(item.timestamp).getTime(),
                'EV Estimated SOC Arrival-%': parseSOC(item['EV Estimated SOC Arrival-%']),
                'EV Required SOC Departure-%': parseSOC(item['EV Required SOC Departure-%']),
                'EV Departure Time': item['EV Departure Time']
                    ? new Date(item['EV Departure Time']).toISOString()
                    : undefined,
                'EV Arrival Time': item['EV Arrival Time']
                    ? new Date(item['EV Arrival Time']).toISOString()
                    : undefined,
                'EV SOC-%': parseSOC(item['EV SOC-%']),
            }))
    }, [data]);

    const metadata = useMemo(() => {
        if (updatedData.length === 0) return { min: 0, max: 0, baseInt: 1 };
        const min = floorToMidnightUTC(updatedData[0].timestamp);
        const max = ceilToEndOfDayUTC(updatedData[updatedData.length - 1].timestamp);
        const baseInt =
            updatedData.length > 1
                ? Math.max(1, Math.round((updatedData[1].timestamp - updatedData[0].timestamp) / 60000))
                : 1;
        return { min, max, baseInt };
    }, [updatedData]);

    const [sliderValues, setSliderValues] = useState<number[]>([0, 0]);
    const [intervalInput, setIntervalInput] = useState<number>(0);
    const [init, setInit] = useState(false);
    const [visibleSeries, setVisibleSeries] = useState<Record<SeriesKey, boolean>>({
        'EV Estimated SOC Arrival-%': true,
        'EV Required SOC Departure-%': true,
        'EV SOC-%': true,
        'EV Arrival Time': true,
        'EV Departure Time': true,
    });

    const filteredData = useMemo(
        () => updatedData.filter((i) => i.timestamp >= sliderValues[0] && i.timestamp <= sliderValues[1]),
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
            const pointsPerDay = Math.floor((24 * 60) / metadata.baseInt);
            const defaultEnd = ceilToEndOfDayUTC(
                updatedData[pointsPerDay * 10]?.timestamp ?? metadata.max
            );
            const initialSlider: number[] = [metadata.min, defaultEnd];
            setSliderValues(initialSlider);

            const viable = intervals.find(({ value }) => {
                checkViability(value);
            });
            if (viable) setIntervalInput(viable.value);

            setInit(true);
        }
    }, [updatedData, init, metadata]);

    useEffect(() => {
        const viable = intervals.find(({ value }) => checkViability(value));
        if (viable) {
            const currentIsButton = intervals.some(
                ({ value }) => value === intervalInput && checkViability(value)
            );
            if (!currentIsButton) setIntervalInput(viable.value);
        } else {
            const auto = Math.max(
                metadata.baseInt,
                Math.ceil((sliderValues[1] - sliderValues[0]) / (MAX_POINTS * 60 * 1000))
            );
            setIntervalInput(auto);
        }
    }, [sliderValues, isLive]);

    const aggregatedData = useMemo(
        () => aggregateData(filteredData, intervalInput, metadata.baseInt),
        [filteredData, intervalInput, metadata.baseInt]
    );
    
    const evEvents = useMemo(
        () => getEvents(filteredData),
        [filteredData]
    );

    const xAxisTicks = useMemo(() => getDayTransitionTicks(aggregatedData), [aggregatedData]);

    const handleSliderChange = (values: SetStateAction<number[]>) =>
    {
        if (!isLive){
            setSliderValues(values as number[]);
        }
    }

    const handleCheckboxChange = (key: SeriesKey) =>
        setVisibleSeries((p) => ({ ...p, [key]: !p[key] }));

    const handleApplyInterval = (interval: number) =>
        setIntervalInput(Math.max(metadata.baseInt, interval));

    if (!data || data.length === 0) {
        return <div style={{ color: "#9e9e9e", padding: "20px" }}>No data available.</div>;
    }

    return (
        <div className="ev-card">
            <div className="card-body">

                <div className="card-top">
                    <span className="fw-bold">{title}</span>
                    <div className="card-info">
                        {intervals.filter(({ value }) => checkViability(value)).length > 0 ? (
                            intervals
                                .filter(({ value }) => checkViability(value))
                                .map(({ value, label }) => (
                                    <Button
                                        key={value}
                                        size="sm"
                                        variant={intervalInput === value ? "primary" : "secondary"}
                                        className={intervalInput === value ? "btn-interval active" : "btn-interval"}
                                        onClick={() => handleApplyInterval(value)}
                                    >
                                        {label}
                                    </Button>
                                ))
                        ) : (
                            <span className="auto-adj-badge">
                                <i className="bi bi-cpu-fill me-1"></i>
                                AUTO: {intervalInput} MIN
                            </span>
                        )}
                    </div>
                </div>

                <div className="series-container">
                    {(Object.keys(visibleSeries) as SeriesKey[]).map((key) => (
                        <div key={key} className="series-item" onClick={() => handleCheckboxChange(key)}>
                            <input
                                type="checkbox"
                                readOnly
                                checked={visibleSeries[key]}
                                style={{ accentColor: SERIES_COLORS[key], cursor: "pointer" }}
                            />
                            <span className="series-label">{SERIES_NAMES[key]}</span>
                        </div>
                    ))}
                </div>

                <ResponsiveContainer width="100%" height={350}>
                    <ComposedChart
                        data={aggregatedData}
                        margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                    >
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
                            yAxisId="right"
                            domain={[0, 1]}
                            tickFormatter={(t) => `${(t).toFixed(0)}%`}
                            tick={{ fontSize: 11, fill: "#888" }}
                            width={40}
                            label={{ value: "SOC %", angle: -90, position: "insideLeft", fill: "#888", fontSize: 12 }}
                        />
                        <Tooltip
                            content={({ active, payload, label }) => {
                                if (!active || !payload?.length) return null;

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
                                        <div style={{ marginBottom: 6 }}>
                                            {label ? new Date(label).toLocaleString() : ''}
                                        </div>

                                        {payload.map((entry: any, i: number) => {
                                            if (entry.value === null || entry.value === undefined) return null;

                                            return (
                                                <div key={i} style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 8,
                                                    marginBottom: 4,
                                                }}>
                                                    <span style={{
                                                        width: 10,
                                                        height: 10,
                                                        borderRadius: '50%',
                                                        background: entry.color,
                                                        flexShrink: 0
                                                    }} />
                        
                                                    <span style={{ color: '#bbb' }}>
                                                        {entry.name}
                                                    </span>
                        
                                                    <span style={{
                                                        marginLeft: 'auto',
                                                        fontWeight: 'bold'
                                                    }}>
                                                        {(Number(entry.value)).toFixed(1)}%
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            }}
                        />
                        <Legend iconType="line" />

                        {visibleSeries['EV Estimated SOC Arrival-%'] && (
                            <Line yAxisId="right" type="monotone" dataKey="EV Estimated SOC Arrival-%" stroke={SERIES_COLORS['EV Estimated SOC Arrival-%']} dot={false} name={SERIES_NAMES['EV Estimated SOC Arrival-%']} />
                        )}
                        {visibleSeries['EV Required SOC Departure-%'] && (
                            <Line yAxisId="right" type="monotone" dataKey="EV Required SOC Departure-%" stroke={SERIES_COLORS['EV Required SOC Departure-%']} dot={false} name={SERIES_NAMES['EV Required SOC Departure-%']} />
                        )}
                        {visibleSeries['EV SOC-%'] && (
                            <Line yAxisId="right" type="monotone" dataKey="EV SOC-%" stroke={SERIES_COLORS['EV SOC-%']} strokeWidth={3} dot={false} name={SERIES_NAMES['EV SOC-%']} />
                        )}

                        {visibleSeries['EV Arrival Time'] && (
                            <Line yAxisId="right" name={SERIES_NAMES['EV Arrival Time']} dataKey="null" stroke={SERIES_COLORS['EV Arrival Time']} strokeDasharray="4 4" legendType="line" />
                        )}
                        {visibleSeries['EV Departure Time'] && (
                            <Line yAxisId="right" name={SERIES_NAMES['EV Departure Time']} dataKey="null" stroke={SERIES_COLORS['EV Departure Time']} strokeDasharray="4 4" legendType="line" />
                        )}

                        {visibleSeries['EV Arrival Time'] && (evEvents.get('Arrival') ?? []).map((ts, i) => {
                            const nearest = aggregatedData.reduce((prev, curr) =>
                                Math.abs(curr.timestamp - ts) < Math.abs(prev.timestamp - ts) ? curr : prev
                            )
                            return (
                                <ReferenceLine
                                    key={`arr-${i}`}
                                    yAxisId="right"
                                    x={nearest['Time Step']}
                                    stroke={SERIES_COLORS['EV Arrival Time']}
                                    strokeWidth={2}
                                    strokeDasharray="4 4"
                                />
                            );
                        })}

                        {visibleSeries['EV Departure Time'] && (evEvents.get('Departure') ?? []).map((ts, i) => {
                            const nearest = aggregatedData.reduce((prev, curr) =>
                                Math.abs(curr.timestamp - ts) < Math.abs(prev.timestamp - ts) ? curr : prev
                            );
                            
                            /*const options: Intl.DateTimeFormatOptions = {
                                timeZone: 'Europe/Lisbon',
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                            };

                            console.log('Original (PT): ' + new Date(ts).toLocaleString('pt-PT', options));
                            console.log('Aproximado (PT): ' + new Date(nearest.timestamp).toLocaleString('pt-PT', options));*/
                            
                            return (
                                <ReferenceLine
                                    key={`dep-${i}`}
                                    yAxisId="right"
                                    x={nearest['Time Step']}
                                    stroke={SERIES_COLORS['EV Departure Time']}
                                    strokeWidth={2}
                                    strokeDasharray="4 4"
                                />
                            );
                        })}
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

export default CardEV;