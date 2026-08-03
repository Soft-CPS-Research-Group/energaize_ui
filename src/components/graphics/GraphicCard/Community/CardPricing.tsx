import { useState, useMemo, type SetStateAction, useEffect } from 'react';
import {
    ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { Button } from "react-bootstrap";
import DateRangeSlider from "../DateRangeSlider";
import "./CardPricing.css";


interface PricingDataItem {
    timestamp: string | number;
    [key: string]: any;
}

interface InternalDataItem extends PricingDataItem {
    timestamp: number;
    'Time Step': string;
}

interface CardPricingProps {
    data: PricingDataItem[];
    title: string;
    isLive: boolean;
}

const PRICING_KEY = 'electricity_pricing-$/kWh';

const intervals = [
    { value: 0.25,  label: "15 sec"  },
    { value: 0.5,   label: "30 sec"  },
    { value: 1,     label: "1 min" },
    { value: 5,     label: "5 min" },
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

const getDayTransitionTicks = (data: InternalDataItem[]): string[] => {
    if (data.length === 0) return [];
    const ticks: string[] = [];
    let lastDateStr = "";
    data.forEach((item) => {
        const currentDateStr = new Date(item.timestamp).toISOString().slice(0, 10);
        if (currentDateStr !== lastDateStr) {
            ticks.push(item['Time Step']);
            lastDateStr = currentDateStr;
        }
    });
    return ticks;
};

const aggregateGroup = (groupStart: number, group: InternalDataItem[]) => {
    if (group.length === 0) return null;
    const values = group
        .map((item) => parseFloat(item[PRICING_KEY]))
        .filter((val) => !isNaN(val));
    return {
        timestamp: groupStart,
        'Time Step': group[0]['Time Step'],
        [PRICING_KEY]: values.length > 0 ? values.reduce((sum, v) => sum + v, 0) : null,
    };
};

const aggregateData = (data: InternalDataItem[], intervalMinutes: number) => {
    if (!data.length) return [];
    const intervalMs = intervalMinutes * 60 * 1000;
    const result: any[] = [];
    let groupStart = data[0].timestamp;
    let tempGroup: InternalDataItem[] = [];

    for (const item of data) {
        if (item.timestamp - groupStart < intervalMs) {
            tempGroup.push(item);
        } else {
            if (tempGroup.length > 0) result.push(aggregateGroup(groupStart, tempGroup));
            groupStart = item.timestamp;
            tempGroup = [item];
        }
    }
    if (tempGroup.length > 0) result.push(aggregateGroup(groupStart, tempGroup));
    return result.filter(Boolean);
};

// Dados já vêm ordenados por timestamp (garantido em updatedData), por isso
// usamos binary search em vez de filter() linear sobre o array inteiro.
const lowerBound = (arr: InternalDataItem[], target: number): number => {
    let l = 0, r = arr.length;
    while (l < r) {
        const m = (l + r) >> 1;
        if (arr[m].timestamp < target) l = m + 1; else r = m;
    }
    return l;
};

const upperBound = (arr: InternalDataItem[], target: number): number => {
    let l = 0, r = arr.length;
    while (l < r) {
        const m = (l + r) >> 1;
        if (arr[m].timestamp <= target) l = m + 1; else r = m;
    }
    return l;
};

function CardPricing({ data, title, isLive}: CardPricingProps) {
    const updatedData = useMemo<InternalDataItem[]>(() => {
        if (!data || data.length === 0) return [];
        return data.map((item) => ({
            ...item,
            'Time Step': String(item['timestamp']),
            timestamp: new Date(item['timestamp']).getTime(),
        })).sort((a, b) => a.timestamp - b.timestamp);
    }, [data]);

    const metadata = useMemo(() => {
        if (updatedData.length === 0) return { min: 0, max: 0, baseInt: 1 };
        const min = floorToMidnightUTC(updatedData[0].timestamp);
        const max = ceilToEndOfDayUTC(updatedData[updatedData.length - 1].timestamp);
        const baseInt = updatedData.length > 1
            ? Math.max(0.25, (updatedData[1].timestamp - updatedData[0].timestamp) / 60000)
            : 1;
        return { min, max, baseInt };
    }, [updatedData]);

    const [sliderValues, setSliderValues] = useState<number[]>([0, 0]);
    const [intervalInput, setIntervalInput] = useState<number>(0);
    const [init, setInit] = useState(false);

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
            const defaultEnd = ceilToEndOfDayUTC(updatedData[pointsPerDay * 10]?.timestamp ?? metadata.max);
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

    // Corrigido: estava num useMemo (anti-padrão — side-effects/setState não pertencem
    // a um useMemo, o React pode recalculá-lo ou descartá-lo sem aviso). Passou a useEffect.
    useEffect(() => {
        const viable = intervals.find(({ value }) => checkViability(value));
        if (viable) {
            const currentIsButton = intervals.some(({ value }) => value === intervalInput && checkViability(value));
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

    const xAxisTicks = useMemo(
        () => getDayTransitionTicks(aggregatedData),
        [aggregatedData]
    );

    const handleSliderChange = (values: SetStateAction<number[]>) => {
        if (!isLive) {
            setSliderValues(values as number[]);
        }
    }
    const handleApplyInterval = (interval: number) => setIntervalInput(Math.max(metadata.baseInt, interval));

    if (!data || data.length === 0) {
        return <div style={{ color: '#9e9e9e', padding: '20px' }}>No pricing data available.</div>;
    }

    return (
        <div className="pricing-card">
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

                <ResponsiveContainer width="100%" height={363}>
                    <ComposedChart
                        data={aggregatedData}
                        barGap={0}
                        margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
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
                            tick={{ fontSize: 11, fill: '#888' }}
                            width={80}
                            tickFormatter={(value) => Number(value).toString()}
                            label={{
                                value: '$/kWh',
                                angle: -90,
                                position: 'insideLeft',
                                fill: '#888',
                                fontSize: 12,
                                offset: 10
                            }}
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
                                                <div
                                                    key={i}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 8,
                                                        marginBottom: 4,
                                                    }}
                                                >
                                                    <span
                                                        style={{
                                                            width: 10,
                                                            height: 10,
                                                            borderRadius: '50%',
                                                            background: entry.color,
                                                            flexShrink: 0,
                                                        }}
                                                    />

                                                    <span style={{ color: '#bbb' }}>
                                                        {entry.name}
                                                    </span>

                                                    <span style={{ marginLeft: 'auto', fontWeight: 'bold' }}>
                                                        {`${Number(entry.value)} $/kWh`}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            }}
                        />
                        <Legend verticalAlign="top" height={36} />
                        <Line
                            type="monotone"
                            dataKey={PRICING_KEY}
                            name="Price"
                            stroke="#FF7300"
                            dot={false}
                            strokeWidth={2}
                        />
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

export default CardPricing;