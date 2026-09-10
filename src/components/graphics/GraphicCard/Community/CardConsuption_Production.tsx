import { useState, useMemo, type SetStateAction, useEffect } from "react";
import {
    ResponsiveContainer,
    ComposedChart,
    CartesianGrid,
    XAxis,
    YAxis,
    Tooltip,
    Legend,
    Bar
} from "recharts";
import { Button } from "react-bootstrap";
import DateRangeSlider from "../DateRangeSlider";
import "./CardConsunption_Production.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConsumptionProductionDTO {
    timestamp: string;
    'Non-shiftable Load-kWh': number;
    'Net Electricity Consumption-kWh': number;
    'Energy Production from PV-kWh': number;
}

interface DataItem {
    timestamp: number;
    'Time Step': string;
    'Non-shiftable Load-kWh': number;
    'Net Electricity Consumption-kWh': number;
    'Energy Production from PV-kWh': number;
}

type SeriesKey =
    | 'Non-shiftable Load-kWh'
    | 'Net Electricity Consumption-kWh'
    | 'Energy Production from PV-kWh';

interface Props {
    data: ConsumptionProductionDTO[];
    title: string;
    isLive: boolean;
}

const SERIES_COLORS: Record<SeriesKey, string> = {
    'Non-shiftable Load-kWh': '#8884d8',
    'Net Electricity Consumption-kWh': '#82ca9d',
    'Energy Production from PV-kWh': '#F5C227',
};

const SERIES_NAMES: Record<SeriesKey, string> = {
    'Non-shiftable Load-kWh': 'Non-shiftable Load',
    'Net Electricity Consumption-kWh': 'Net Consumption',
    'Energy Production from PV-kWh': 'PV Production',
};

const intervals = [
    { value: 0.25, label: "15 sec" },
    { value: 0.5, label: "30 sec" },
    { value: 1, label: "1 min" },
    { value: 5, label: "5 min" },
    { value: 15, label: "15 min" },
    { value: 60, label: "1h" },
    { value: 720, label: "12h" },
    { value: 1440, label: "1d" },
    { value: 10080, label: "7d" },
    { value: 43200, label: "30d" }
];

const MAX_POINTS = 300;
const LIVE_WINDOW_MIN = 10;

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

const getLocalDateKey = (ts: number): string => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");

    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

const aggregateGroup = (
    groupStart: number,
    group: DataItem[]
): DataItem => {

    const sumKeys: SeriesKey[] = [
        'Non-shiftable Load-kWh',
        'Net Electricity Consumption-kWh',
        'Energy Production from PV-kWh',
    ];

    const aggregated: any = {
        timestamp: groupStart,
        'Time Step': group[0]['Time Step'],
    };

    sumKeys.forEach((key) => {
        const values = group
            .map((i) => i[key])
            .filter((v) => v != null && !isNaN(v));

        aggregated[key] = values.length
            ? values.reduce((a, b) => a + b, 0)
            : null;
    });

    return aggregated;
};

const aggregateData = (
    data: DataItem[],
    intervalMinutes: number
): DataItem[] => {

    if (!data.length) return [];

    const intervalMs = intervalMinutes * 60 * 1000;

    const result: DataItem[] = [];

    let groupStart = data[0].timestamp;
    let tempGroup: DataItem[] = [];

    for (const item of data) {

        if (item.timestamp - groupStart < intervalMs) {
            tempGroup.push(item);
        } else {

            result.push(
                aggregateGroup(
                    groupStart,
                    tempGroup
                )
            );

            groupStart = item.timestamp;
            tempGroup = [item];
        }
    }

    if (tempGroup.length > 0) {
        result.push(
            aggregateGroup(
                groupStart,
                tempGroup
            )
        );
    }

    return result;
};

// ---------------------------------------------------------------------------
// X axis
// ---------------------------------------------------------------------------

const getDayTransitionTicks = (
    data: DataItem[]
): string[] => {

    if (data.length === 0) return [];

    const ticks: string[] = [];
    let lastDateStr = "";

    data.forEach((item) => {

        const currentDateStr =
            getLocalDateKey(item.timestamp);

        if (currentDateStr !== lastDateStr) {

            ticks.push(item['Time Step']);

            lastDateStr = currentDateStr;
        }
    });

    return ticks;
};

// ---------------------------------------------------------------------------
// Binary search
// ---------------------------------------------------------------------------

const lowerBound = (
    arr: DataItem[],
    target: number
): number => {

    let l = 0;
    let r = arr.length;

    while (l < r) {

        const m = (l + r) >> 1;

        if (arr[m].timestamp < target) {
            l = m + 1;
        } else {
            r = m;
        }
    }

    return l;
};

const upperBound = (
    arr: DataItem[],
    target: number
): number => {

    let l = 0;
    let r = arr.length;

    while (l < r) {

        const m = (l + r) >> 1;

        if (arr[m].timestamp <= target) {
            l = m + 1;
        } else {
            r = m;
        }
    }

    return l;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function CardConsumption_Production({
                                        data,
                                        title,
                                        isLive
                                    }: Props) {

    const updatedData = useMemo<DataItem[]>(() => {

        if (!data || data.length === 0) {
            return [];
        }

        return data
            .map((item) => ({
                ...item,
                'Time Step': item.timestamp,
                timestamp: new Date(item.timestamp).getTime(),
            }))
            .sort(
                (a, b) =>
                    a.timestamp - b.timestamp
            );

    }, [data]);

    // -----------------------------------------------------------------------
    // Metadata
    // -----------------------------------------------------------------------

    const metadata = useMemo(() => {

        if (updatedData.length === 0) {

            return {
                min: 0,
                max: 0,
                baseInt: 1,
                sliderStep: 24 * 60 * 60 * 1000,
            };
        }

        // Agora usamos os timestamps REAIS dos dados.
        const min =
            updatedData[0].timestamp;

        const max =
            updatedData[
            updatedData.length - 1
                ].timestamp;

        const baseInt =
            updatedData.length > 1
                ? Math.max(
                    0.25,
                    (
                        updatedData[1].timestamp -
                        updatedData[0].timestamp
                    ) / 60000
                )
                : 1;

        const totalMinutes =
            (max - min) / 60000;

        let sliderStep: number;

        // Menos de 1 hora -> minuto a minuto
        if (totalMinutes < 60) {

            sliderStep =
                60 * 1000;

            // Menos de 1 dia -> hora a hora
        } else if (totalMinutes < 24 * 60) {

            sliderStep =
                60 * 60 * 1000;

            // 1 dia ou mais -> dia a dia
        } else {

            sliderStep =
                24 * 60 * 60 * 1000;
        }

        return {
            min,
            max,
            baseInt,
            sliderStep,
        };

    }, [updatedData]);

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    const [sliderValues, setSliderValues] =
        useState<number[]>([0, 0]);

    const [intervalInput, setIntervalInput] =
        useState<number>(0);

    const [visibleSeries, setVisibleSeries] =
        useState<Record<SeriesKey, boolean>>({

            'Non-shiftable Load-kWh':
                true,

            'Net Electricity Consumption-kWh':
                true,

            'Energy Production from PV-kWh':
                true,
        });

    const [init, setInit] =
        useState(false);

    // -----------------------------------------------------------------------
    // Interval viability
    // -----------------------------------------------------------------------

    const checkViability = (
        interval: number
    ): boolean => {

        if (isLive) {

            const timeMs =
                LIVE_WINDOW_MIN *
                60 *
                1000;

            const intervalMs =
                interval *
                60 *
                1000;

            return intervalMs < timeMs;
        }

        const timeMs =
            sliderValues[1] -
            sliderValues[0];

        const intervalMs =
            interval *
            60 *
            1000;

        if (intervalMs > timeMs) {
            return false;
        }

        const qtdPoints =
            timeMs / intervalMs;

        return qtdPoints <= MAX_POINTS;
    };

    // -----------------------------------------------------------------------
    // Automatically select viable interval
    // -----------------------------------------------------------------------

    useEffect(() => {

        const viable =
            intervals.find(
                ({ value }) =>
                    checkViability(value)
            );

        if (viable) {

            const currentIsButton =
                intervals.some(
                    ({ value }) =>
                        value === intervalInput &&
                        checkViability(value)
                );

            if (!currentIsButton) {
                setIntervalInput(
                    viable.value
                );
            }

        } else {

            const auto =
                Math.max(
                    metadata.baseInt,
                    Math.ceil(
                        (
                            sliderValues[1] -
                            sliderValues[0]
                        ) /
                        (
                            MAX_POINTS *
                            60 *
                            1000
                        )
                    )
                );

            setIntervalInput(auto);
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sliderValues, isLive]);

    // -----------------------------------------------------------------------
    // Filter
    // -----------------------------------------------------------------------

    const filteredData = useMemo(() => {

        if (updatedData.length === 0) {
            return [];
        }

        const lo =
            lowerBound(
                updatedData,
                sliderValues[0]
            );

        const hi =
            upperBound(
                updatedData,
                sliderValues[1]
            );

        return updatedData.slice(
            lo,
            hi
        );

    }, [updatedData, sliderValues]);

    // -----------------------------------------------------------------------
    // Initial slider
    // -----------------------------------------------------------------------

    useEffect(() => {

        if (
            !init &&
            updatedData.length > 0
        ) {

            // Usa exatamente o período disponível
            const initialSlider: number[] = [
                metadata.min,
                metadata.max,
            ];

            setSliderValues(
                initialSlider
            );

            const viable =
                intervals.find(
                    ({ value }) =>
                        checkViability(value)
                );

            setIntervalInput(
                viable
                    ? viable.value
                    : Math.max(
                        metadata.baseInt,
                        1
                    )
            );

            setInit(true);
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        updatedData,
        init,
        metadata
    ]);

    // -----------------------------------------------------------------------
    // Safe interval
    // -----------------------------------------------------------------------

    const safeInterval =
        Math.max(
            intervalInput,
            metadata.baseInt || 1
        );

    // -----------------------------------------------------------------------
    // Aggregated data
    // -----------------------------------------------------------------------

    const aggregatedData =
        useMemo(
            () =>
                aggregateData(
                    filteredData,
                    safeInterval
                ),
            [
                filteredData,
                safeInterval
            ]
        );

    // -----------------------------------------------------------------------
    // X axis ticks
    // -----------------------------------------------------------------------

    const xAxisTicks =
        useMemo(
            () =>
                getDayTransitionTicks(
                    aggregatedData
                ),
            [aggregatedData]
        );

    // -----------------------------------------------------------------------
    // Handlers
    // -----------------------------------------------------------------------

    const handleSliderChange = (
        values: SetStateAction<number[]>
    ) => {

        if (!isLive) {

            setSliderValues(
                values as number[]
            );
        }
    };

    const handleCheckboxChange = (
        key: SeriesKey
    ) => {

        setVisibleSeries((previous) => ({
            ...previous,
            [key]:
                !previous[key],
        }));
    };

    const handleApplyInterval = (
        interval: number
    ) => {

        setIntervalInput(
            Math.max(
                metadata.baseInt,
                interval
            )
        );
    };

    // -----------------------------------------------------------------------
    // Empty state
    // -----------------------------------------------------------------------

    if (
        !data ||
        data.length === 0
    ) {

        return (
            <div
                style={{
                    color: '#9e9e9e',
                    padding: '20px'
                }}
            >
                No data available.
            </div>
        );
    }

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

    return (
        <div className="consumption-production-card">

            <div className="card-body">

                <div className="card-top">

                    <span className="fw-bold">
                        {title}
                    </span>

                    <div className="card-info">

                        {
                            intervals.filter(
                                ({ value }) =>
                                    checkViability(value)
                            ).length > 0
                                ? (
                                    intervals
                                        .filter(
                                            ({ value }) =>
                                                checkViability(
                                                    value
                                                )
                                        )
                                        .map(
                                            ({
                                                 value,
                                                 label
                                             }) => (

                                                <Button
                                                    key={value}
                                                    size="sm"
                                                    variant={
                                                        safeInterval === value
                                                            ? "primary"
                                                            : "secondary"
                                                    }
                                                    className={
                                                        safeInterval === value
                                                            ? "btn-interval active"
                                                            : "btn-interval"
                                                    }
                                                    onClick={() =>
                                                        handleApplyInterval(
                                                            value
                                                        )
                                                    }
                                                >
                                                    {label}
                                                </Button>
                                            )
                                        )
                                )
                                : (
                                    <span className="auto-adj-badge">
                                        <i className="bi bi-cpu-fill me-1"></i>
                                        AUTO: {safeInterval} MIN
                                    </span>
                                )
                        }

                    </div>
                </div>

                <div className="series-container">

                    {
                        (
                            Object.keys(
                                visibleSeries
                            ) as SeriesKey[]
                        ).map((key) => (

                            <div
                                key={key}
                                className="series-item"
                                onClick={() =>
                                    handleCheckboxChange(
                                        key
                                    )
                                }
                            >

                                <input
                                    type="checkbox"
                                    readOnly
                                    checked={
                                        visibleSeries[key]
                                    }
                                    style={{
                                        accentColor:
                                            SERIES_COLORS[key],
                                        cursor:
                                            'pointer'
                                    }}
                                />

                                <span className="series-label">
                                    {SERIES_NAMES[key]}
                                </span>

                            </div>
                        ))
                    }

                </div>

                <ResponsiveContainer
                    width="100%"
                    height={300}
                >

                    <ComposedChart
                        data={aggregatedData}
                        barGap={0}
                        margin={{
                            top: 10,
                            right: 20,
                            left: 0,
                            bottom: 0
                        }}
                    >

                        <CartesianGrid
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="#333"
                        />

                        <XAxis
                            dataKey="Time Step"
                            ticks={xAxisTicks}
                            tickFormatter={(t) =>
                                t.slice(0, 10)
                            }
                            angle={-30}
                            textAnchor="end"
                            height={70}
                            dy={5}
                            interval="preserveStartEnd"
                            tick={{
                                fontSize: 10,
                                fill: '#888'
                            }}
                        />

                        <YAxis
                            tick={{
                                fontSize: 11,
                                fill: '#888'
                            }}
                            width={70}
                            tickFormatter={(value) =>
                                Number(value).toString()
                            }
                            label={{
                                value: 'kWh',
                                angle: -90,
                                position: 'insideLeft',
                                fill: '#888',
                                fontSize: 12,
                                offset: 10
                            }}
                        />

                        <Tooltip
                            content={({
                                          active,
                                          payload,
                                          label
                                      }) => {

                                if (
                                    !active ||
                                    !payload?.length
                                ) {
                                    return null;
                                }

                                return (
                                    <div
                                        style={{
                                            backgroundColor:
                                                '#1a1a1a',
                                            border:
                                                '1px solid #333',
                                            borderRadius: 8,
                                            padding:
                                                '10px 14px',
                                            color: '#fff',
                                            fontSize: 12,
                                            minWidth: 180,
                                        }}
                                    >

                                        <div
                                            style={{
                                                marginBottom: 6
                                            }}
                                        >
                                            {
                                                label
                                                    ? new Date(
                                                        label
                                                    ).toLocaleString()
                                                    : ''
                                            }
                                        </div>

                                        {
                                            payload.map(
                                                (
                                                    entry: any,
                                                    i: number
                                                ) => {

                                                    if (
                                                        entry.value === null ||
                                                        entry.value === undefined
                                                    ) {
                                                        return null;
                                                    }

                                                    return (
                                                        <div
                                                            key={i}
                                                            style={{
                                                                display:
                                                                    'flex',
                                                                alignItems:
                                                                    'center',
                                                                gap: 8,
                                                                marginBottom: 4,
                                                            }}
                                                        >

                                                            <span
                                                                style={{
                                                                    width: 10,
                                                                    height: 10,
                                                                    borderRadius:
                                                                        '50%',
                                                                    background:
                                                                    entry.color,
                                                                    flexShrink:
                                                                        0,
                                                                }}
                                                            />

                                                            <span
                                                                style={{
                                                                    color:
                                                                        '#bbb'
                                                                }}
                                                            >
                                                                {
                                                                    entry.name
                                                                }
                                                            </span>

                                                            <span
                                                                style={{
                                                                    marginLeft:
                                                                        'auto',
                                                                    fontWeight:
                                                                        'bold'
                                                                }}
                                                            >
                                                                {
                                                                    `${Number(
                                                                        entry.value
                                                                    ).toFixed(
                                                                        3
                                                                    )} kWh`
                                                                }
                                                            </span>

                                                        </div>
                                                    );
                                                }
                                            )
                                        }

                                    </div>
                                );
                            }}
                        />

                        <Legend
                            iconType="rect"
                        />

                        {
                            (
                                Object.keys(
                                    visibleSeries
                                ) as SeriesKey[]
                            ).map(
                                (key) =>
                                    visibleSeries[key] && (

                                        <Bar
                                            key={key}
                                            dataKey={key}
                                            fill={
                                                SERIES_COLORS[key]
                                            }
                                            name={
                                                SERIES_NAMES[key]
                                            }
                                        />

                                    )
                            )
                        }

                    </ComposedChart>

                </ResponsiveContainer>

                <div className="mt-4">

                    <DateRangeSlider
                        minTimestamp={
                            metadata.min
                        }
                        maxTimestamp={
                            metadata.max
                        }
                        sliderValues={
                            sliderValues
                        }
                        onSliderChange={
                            handleSliderChange
                        }
                        step={
                            metadata.sliderStep
                        }
                    />

                </div>

            </div>

        </div>
    );
}

export default CardConsumption_Production;