/// <reference lib="webworker" />

export interface ProcessRequest {
  streaming: Record<string, Record<string, Array<{ value: number; period_start: string }>>>;
  scheduled: Record<string, Record<string, { timeseries: Array<{ value: number; period_start: string; period_end: string; [key: string]: any }>; summary: any }>>;
  maxPoints: number;
}

export interface ProcessResponse {
  streamingChartData: { series: any[]; categories: string[]; buildings: string[] };
  scheduledChartData: {
    seriesByKpi: Record<string, any[]>;
    categories: string[];
    scopes: string[];
    stats: any[];
  };
}

// LTTB algorithm — preserves peaks and valleys
function lttb<T extends { timestamp: string; [key: string]: any }>(
  data: T[],
  threshold: number,
  valueKey: string,
): T[] {
  if (threshold >= data.length || threshold === 0) return data;

  const sampled: T[] = [];
  let a = 0;
  sampled.push(data[a]);

  const bucketSize = (data.length - 2) / (threshold - 2);

  for (let i = 0; i < threshold - 2; i++) {
    const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length);

    let avgX = 0, avgY = 0;
    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += new Date(data[j].timestamp).getTime();
      avgY += (data[j][valueKey] as number) ?? 0;
    }
    const count = avgRangeEnd - avgRangeStart;
    avgX /= count;
    avgY /= count;

    const rangeOffs = Math.floor(i * bucketSize) + 1;
    const rangeTo = Math.floor((i + 1) * bucketSize) + 1;

    const pointAX = new Date(data[a].timestamp).getTime();
    const pointAY = (data[a][valueKey] as number) ?? 0;

    let maxArea = -1, nextA = rangeOffs;
    for (let j = rangeOffs; j < rangeTo; j++) {
      const area = Math.abs(
        (pointAX - avgX) * ((data[j][valueKey] as number ?? 0) - pointAY) -
        (pointAX - new Date(data[j].timestamp).getTime()) * (avgY - pointAY)
      );
      if (area > maxArea) { maxArea = area; nextA = j; }
    }

    sampled.push(data[nextA]);
    a = nextA;
  }

  sampled.push(data[data.length - 1]);
  return sampled;
}

self.onmessage = (e: MessageEvent<ProcessRequest>) => {
  const { streaming, scheduled, maxPoints } = e.data;

  // --- Streaming ---
  const streamingTimelineMap: Record<string, any> = {};
  const streamingMetrics = new Set<string>();
  const streamingScopes = new Set<string>();


  // Stat card lists: streaming first, scheduled overwrites on dedup
  const streamingStatsList: any[] = [];
  const scheduledStatsList: any[] = [];

  Object.entries(streaming ?? {}).forEach(([scope, kpis]) => {
    streamingScopes.add(scope);
    Object.entries(kpis).forEach(([kpiName, results]) => {
      streamingMetrics.add(kpiName);
      if (Array.isArray(results)) {
        results.forEach(result => {
          const ts = result.period_start;
          if (!ts) return;
          if (!streamingTimelineMap[ts]) streamingTimelineMap[ts] = { timestamp: ts };
          streamingTimelineMap[ts][`${scope}_${kpiName}`] = result.value;
        });

        // Build a streaming stat card from the timeseries
        const values = results
          .map((r: any) => Number(r.value))
          .filter((v: number) => !isNaN(v));
        if (values.length > 0) {
          const total = values.reduce((a: number, b: number) => a + b, 0);
          streamingStatsList.push({
            scope,
            kpiName,
            isStreaming: true,
            timeseries: results,
            summary: {
              mean_value: total / values.length,
              total_value: total,
              count: values.length,
            },
          });
        }
      }
    });
  });

  let streamingSorted = Object.values(streamingTimelineMap).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Apply LTTB per metric key if over threshold
  if (streamingSorted.length > maxPoints) {
    const keys = Array.from(streamingScopes).flatMap(s =>
      Array.from(streamingMetrics).map((k: any) => `${s}_${k}`)
    );
    // Use first available key for LTTB (shape approximation)
    const primaryKey = keys[0];
    if (primaryKey) {
      streamingSorted = lttb(streamingSorted, maxPoints, primaryKey);
    } else {
      const step = Math.ceil(streamingSorted.length / maxPoints);
      streamingSorted = streamingSorted.filter((_, i) => i % step === 0);
    }
  }

  // --- Scheduled ---
  const scheduledSeriesByKpi: Record<string, any> = {};
  const scheduledMetrics = new Set<string>();
  const scheduledScopes = new Set<string>();

  Object.entries(scheduled ?? {}).forEach(([scope, kpis]) => {
    scheduledScopes.add(scope);
    Object.entries(kpis).forEach(([kpiName, result]) => {
      scheduledMetrics.add(kpiName);
      if (result?.summary) {
        scheduledStatsList.push({ scope, kpiName, summary: result.summary, timeseries: result.timeseries });
      }
      if (Array.isArray(result?.timeseries)) {
        if (!scheduledSeriesByKpi[kpiName]) scheduledSeriesByKpi[kpiName] = {};
        result.timeseries.forEach((tsItem: any) => {
          const t = tsItem.period_start;
          if (!scheduledSeriesByKpi[kpiName][t]) {
            scheduledSeriesByKpi[kpiName][t] = { timestamp: t };
          }
          scheduledSeriesByKpi[kpiName][t][`${scope}_${kpiName}`] = tsItem.value;
        });
      }
    });
  });

  // Convert each KPI's map to a sorted array
  const scheduledSortedByKpi: Record<string, any[]> = {};
  for (const [kpiName, tsMap] of Object.entries(scheduledSeriesByKpi)) {
    scheduledSortedByKpi[kpiName] = Object.values(tsMap as any)
      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  // Build final statsList: merge streaming + scheduled, deduplicate by
  // scope+kpiName, preferring the scheduled entry (more precise aggregation).
  const statsMap = new Map<string, any>();

  // Add streaming stats first (lower priority)
  for (const entry of streamingStatsList) {
    statsMap.set(`${entry.scope}__${entry.kpiName}`, entry);
  }
  // Scheduled stats overwrite streaming ones for the same KPI+scope
  for (const entry of scheduledStatsList) {
    statsMap.set(`${entry.scope}__${entry.kpiName}`, entry);
  }
  const statsList = Array.from(statsMap.values());

  const response: ProcessResponse = {
    streamingChartData: {
      series: streamingSorted,
      categories: Array.from(streamingMetrics),
      buildings: Array.from(streamingScopes),
    },
    scheduledChartData: {
      seriesByKpi: scheduledSortedByKpi,
      categories: Array.from(scheduledMetrics),
      scopes: Array.from(scheduledScopes),
      stats: statsList,
    },
  };

  self.postMessage(response);
};
