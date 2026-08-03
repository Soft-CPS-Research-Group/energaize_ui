import Slider from "rc-slider";
import "rc-slider/assets/index.css";
import dayjs from "dayjs";
import { useEffect, useState } from "react";

interface DateRangeSliderProps {
    minTimestamp: number;
    maxTimestamp: number;
    sliderValues: number[];
    onSliderChange: (values: number[]) => void;
}

const DateRangeSlider = ({ minTimestamp, maxTimestamp, sliderValues, onSliderChange }: DateRangeSliderProps) => {
    const formatDate = (timestamp: number) => dayjs(timestamp).format("YYYY-MM-DD");
    const step = 24 * 60 * 60 * 1000;

    // Estado local só para o desenho do handle durante o arrasto — não dispara
    // filter/aggregate/render do gráfico a cada pixel de movimento.
    const [localValues, setLocalValues] = useState<number[]>(sliderValues);
    useEffect(() => setLocalValues(sliderValues), [sliderValues]);

    return (
        <div className="p-6 w-600px mx-auto">
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                width: '100%',
                fontSize: '14px',
            }}>
                <span>Start: {formatDate(localValues[0])}</span>
                <span>End: {formatDate(localValues[1])}</span>
            </div>

            <Slider
                range
                min={minTimestamp}
                max={maxTimestamp}
                value={localValues}
                onChange={(v) => setLocalValues(v as number[])}
                // rc-slider >= 11: onChangeComplete. Versões antigas: onAfterChange.
                onChangeComplete={(v) => onSliderChange(v as number[])}
                step={step}
            />
        </div>
    );
};

export default DateRangeSlider;