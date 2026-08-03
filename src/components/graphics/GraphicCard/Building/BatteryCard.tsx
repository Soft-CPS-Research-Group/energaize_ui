import { useState, useMemo, useEffect, type SetStateAction } from "react";
import {
    ComposedChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    Line
} from "recharts";
import DateRangeSlider from "../DateRangeSlider";
import { Button } from "react-bootstrap";
import "./BatteryCard.css";

type SeriesKey = "Battery (Dis)Charge-kWh" | "Battery Soc-%";

interface BatteryData {
    timestamp: string | number | Date;
    "Battery Soc-%": string;
    "Battery (Dis)Charge-kWh": string | number;
}

interface InternalBatteryItem {
    timestamp: number;
    "Time Step": string;
    "Battery Soc-%": number | null;
    "Battery (Dis)Charge-kWh": string | number;
}

interface CardBatteryProps {
    data: BatteryData[];
    title: string;
    isLive: boolean;
}

const SERIES_COLORS: Record<SeriesKey, string> = {
    "Battery (Dis)Charge-kWh": "#8884d8",
    "Battery Soc-%": "#FF7300",
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

const aggregateGroup = (groupStart: number, group: InternalBatteryItem[]) => {
    const validSOC = group
        .filter((i) => i["Battery Soc-%"] !== null)
        .map((i) => i["Battery Soc-%"] as number);

    const avgSOC =
        validSOC.length
            ? validSOC.reduce((sum: number, v: number) => sum + v, 0) / validSOC.length
            : null;

    const totalDischarge = group.reduce(
        (sum, i) => sum + Number(i["Battery (Dis)Charge-kWh"] || 0),
        0
    );

    return {
        timestamp: groupStart,
        "Time Step": group[0]["Time Step"],
        "Battery Soc-%": avgSOC,
        "Battery (Dis)Charge-kWh": totalDischarge,
    };
};

const aggregateData = (data: InternalBatteryItem[], intervalMinutes: number) => {
    if (!data.length) return [];
    const intervalMs = intervalMinutes * 60 * 1000;
    const result: any[] = [];
    let groupStart = data[0].timestamp;
    let tempGroup: InternalBatteryItem[] = [];

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

const getMidnightTicks = (data: any[]): string[] => {
    const seen = new Set<string>();
    const ticks: string[] = [];
    for (const item of data) {
        const datePart = item["Time Step"].split("T")[0];
        if (!seen.has(datePart)) {
            seen.add(datePart);
            ticks.push(item["Time Step"]);
        }
    }
    return ticks;
};

// Dados já vêm ordenados por timestamp (garantido em updatedData), por isso
// usamos binary search em vez de filter() linear sobre o array inteiro.
const lowerBound = (arr: InternalBatteryItem[], target: number): number => {
    let l = 0, r = arr.length;
    while (l < r) {
        const m = (l + r) >> 1;
        if (arr[m].timestamp < target) l = m + 1; else r = m;
    }
    return l;
};

const upperBound = (arr: InternalBatteryItem[], target: number): number => {
    let l = 0, r = arr.length;
    while (l < r) {
        const m = (l + r) >> 1;
        if (arr[m].timestamp <= target) l = m + 1; else r = m;
    }
    return l;
};

function CardBattery({ data, title, isLive}: CardBatteryProps) {

    const updatedData = useMemo<InternalBatteryItem[]>(() => {
        if (!data || data.length === 0) return [];
        return data
            .map((item) => ({
                ...item,
                "Time Step": new Date(item.timestamp).toISOString(),
                timestamp: new Date(item.timestamp).getTime(),
                "Battery Soc-%":
                    item["Battery Soc-%"] === "-1.00" || item["Battery Soc-%"] === "-0.1"
                        ? null
                        : parseFloat(item["Battery Soc-%"]),
            }))
            .sort((a, b) => a.timestamp - b.timestamp);
    }, [data]);

    const metadata = useMemo(() => {
        if (updatedData.length === 0) return { min: 0, max: 0, baseInt: 1 };
        const min = floorToMidnightUTC(updatedData[0].timestamp);
        const max = ceilToEndOfDayUTC(updatedData[updatedData.length - 1].timestamp);
        const baseInt =
            updatedData.length > 1
                ? Math.max(0.25, (updatedData[1].timestamp - updatedData[0].timestamp) / 60000)
                : 1;
        return { min, max, baseInt };
    }, [updatedData]);

    const [sliderValues, setSliderValues] = useState<number[]>([0, 0]);
    const [intervalInput, setIntervalInput] = useState<number>(0);
    const [init, setInit] = useState(false);
    const [visibleSeries, setVisibleSeries] = useState<Record<SeriesKey, boolean>>({
        "Battery (Dis)Charge-kWh": true,
        "Battery Soc-%": true,
    });

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

    // Filtro via binary search (O(log n)) em vez de .filter() linear (O(n)) sobre o array inteiro
    const filteredData = useMemo(() => {
        if (updatedData.length === 0) return [];
        const lo = lowerBound(updatedData, sliderValues[0]);
        const hi = upperBound(updatedData, sliderValues[1]);
        return updatedData.slice(lo, hi);
    }, [updatedData, sliderValues]);

    useEffect(() => {
        if (!init && updatedData.length > 0) {
            const pointsPerDay = Math.floor((24 * 60) / metadata.baseInt);
            const defaultEnd = ceilToEndOfDayUTC(
                updatedData[pointsPerDay * 10]?.timestamp ?? metadata.max
            );
            const initialSlider: number[] = [metadata.min, defaultEnd];
            setSliderValues(initialSlider);

            // Bug corrigido: faltava o "return" dentro do .find(), o que fazia
            // "viable" ser sempre undefined e este ramo nunca definir o intervalInput.
            const viable = intervals.find(({ value }) => checkViability(value));
            setIntervalInput(viable ? viable.value : Math.max(metadata.baseInt, 1));

            setInit(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sliderValues, isLive]);

    // Clamp de segurança: nunca deixa o intervalo cair a 0 (o que faria aggregateData
    // não agregar nada e desenhar um ponto por cada registo bruto).
    const safeInterval = Math.max(intervalInput, metadata.baseInt || 1);

    const aggregatedData = useMemo(
        () => aggregateData(filteredData, safeInterval),
        [filteredData, safeInterval]
    );

    const xAxisTicks = useMemo(() => getMidnightTicks(aggregatedData), [aggregatedData]);

    const handleSliderChange = (values: SetStateAction<number[]>) =>{
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
        <div className="battery-card">
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
                                        variant={safeInterval === value ? "primary" : "secondary"}
                                        className={safeInterval === value ? "btn-interval active" : "btn-interval"}
                                        onClick={() => handleApplyInterval(value)}
                                    >
                                        {label}
                                    </Button>
                                ))
                        ) : (
                            <span className="auto-adj-badge">
                                <i className="bi bi-cpu-fill me-1"></i>
                                AUTO: {safeInterval} MIN
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
                                style={{
                                    accentColor: SERIES_COLORS[key],
                                    cursor: "pointer",
                                }}
                            />
                            <span className="series-label">{key}</span>
                        </div>
                    ))}
                </div>

                <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart
                        data={aggregatedData}
                        margin={{ top: 10, right: 40, left: 0, bottom: 0 }}
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
                            tick={{ fontSize: 11, fill: "#888" }}
                            width={35}
                            label={{ value: "kWh", angle: -90, position: "insideLeft", fill: "#888", fontSize: 12 }}
                        />
                        <YAxis
                            yAxisId="right"
                            orientation="right"
                            domain={[0, 100]}
                            tick={{ fontSize: 11, fill: "#888" }}
                            width={45}
                            label={{ value: "SOC %", angle: -90, position: "insideRight", fill: "#888", fontSize: 12 }}
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

                                            const isSOC = entry.dataKey?.includes("Soc");

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
                                                    }} /><span style={{ color: '#bbb' }}>
                                                        {entry.name}
                                                    </span>
                                                    <span style={{
                                                        marginLeft: 'auto',
                                                        fontWeight: 'bold'
                                                    }}>
                                                        {isSOC
                                                            ? `${Number(entry.value).toFixed(1)} %`
                                                            : `${Number(entry.value).toFixed(3)} kWh`}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            }}
                        />
                        <Legend iconType="rect" />

                        {visibleSeries["Battery (Dis)Charge-kWh"] && (
                            <Bar dataKey="Battery (Dis)Charge-kWh" fill={SERIES_COLORS["Battery (Dis)Charge-kWh"]} />
                        )}
                        {visibleSeries["Battery Soc-%"] && (
                            <Line
                                yAxisId="right"
                                type="monotone"
                                dataKey="Battery Soc-%"
                                stroke={SERIES_COLORS["Battery Soc-%"]}
                                dot={false}
                            />
                        )}
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

export default CardBattery;