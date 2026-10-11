import type { ComponentProps } from 'react';
import { CartesianGrid, ComposedChart, ResponsiveContainer } from 'recharts';

/** Shared plotting surface for Jobs and live community measurements. */
export function TimeseriesPlot({ height = 340, children, ...props }: ComponentProps<typeof ComposedChart> & { height?: number }) {
  return <ResponsiveContainer width="100%" height={height} minWidth={0}>
    <ComposedChart margin={{ top: 16, right: 12, left: 8, bottom: 10 }} {...props}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
      {children}
    </ComposedChart>
  </ResponsiveContainer>;
}
