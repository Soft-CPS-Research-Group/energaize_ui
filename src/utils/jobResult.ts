import type {
  ArtifactEntry,
  JobInfo,
  JobKpiComparisonRow,
  KpiEntry,
  TimeseriesEntry,
  TimeseriesPoint
} from "../types";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function humanizeKey(key: string): string {
  return key
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function inferUnit(key: string): string | undefined {
  const normalized = key.toLowerCase();
  if (normalized.includes("percent") || normalized.includes("pct")) return "%";
  if (normalized.includes("cost") || normalized.includes("price") || normalized.includes("eur")) return "€";
  if (normalized.includes("kwh")) return "kWh";
  if (normalized.includes("kw")) return "kW";
  return undefined;
}

function flattenNumericLeaves(
  value: unknown,
  prefix: string,
  output: Array<{ key: string; value: number }>,
  depth: number
): void {
  if (depth > 5) return;

  const numeric = toNumber(value);
  if (numeric !== null) {
    output.push({ key: prefix || "value", value: numeric });
    return;
  }

  if (!isRecord(value)) return;

  Object.entries(value).forEach(([key, child]) => {
    if (Array.isArray(child)) return;
    const childPath = prefix ? `${prefix}.${key}` : key;
    flattenNumericLeaves(child, childPath, output, depth + 1);
  });
}

function parseTimeseriesPoints(input: unknown): TimeseriesPoint[] {
  if (!Array.isArray(input) || input.length < 2) return [];

  if (input.every((item) => typeof item === "number" && Number.isFinite(item))) {
    return (input as number[]).map((value, index) => ({ x: index + 1, y: value }));
  }

  if (
    input.every(
      (item) =>
        Array.isArray(item) &&
        item.length >= 2 &&
        (typeof item[0] === "number" || typeof item[0] === "string") &&
        toNumber(item[1]) !== null
    )
  ) {
    return (input as Array<[number | string, unknown]>).map((item, index) => ({
      x: item[0] ?? index + 1,
      y: toNumber(item[1]) ?? 0
    }));
  }

  if (input.every((item) => isRecord(item))) {
    return (input as UnknownRecord[])
      .map((entry, index) => {
        const yValue =
          toNumber(entry.y) ??
          toNumber(entry.value) ??
          toNumber(entry.v) ??
          toNumber(entry.output) ??
          null;
        if (yValue === null) return null;
        return {
          x: (entry.x ?? entry.time ?? entry.timestamp ?? entry.t ?? index + 1) as number | string,
          y: yValue
        };
      })
      .filter((point): point is TimeseriesPoint => Boolean(point));
  }

  return [];
}

function collectSeriesCandidates(
  value: unknown,
  path: string,
  output: TimeseriesEntry[],
  depth: number
): void {
  if (depth > 4) return;

  const points = parseTimeseriesPoints(value);
  if (points.length >= 2) {
    output.push({
      id: path || "series",
      name: humanizeKey(path || "Series"),
      points
    });
    return;
  }

  if (!isRecord(value)) return;
  Object.entries(value).forEach(([key, child]) => {
    const childPath = path ? `${path}.${key}` : key;
    collectSeriesCandidates(child, childPath, output, depth + 1);
  });
}

function collectArtifactEntries(
  value: unknown,
  path: string,
  output: ArtifactEntry[],
  depth: number
): void {
  if (depth > 5) return;

  if (typeof value === "string") {
    if (/(artifact|model|checkpoint|path|uri)/i.test(path)) {
      const normalizedPath = value.trim();
      if (!normalizedPath) return;
      const kindMatch = path.match(/artifact|model|checkpoint|path|uri/i);
      output.push({
        name: humanizeKey(path),
        pathOrUri: normalizedPath,
        kind: kindMatch ? kindMatch[0].toLowerCase() : "artifact"
      });
    }
    return;
  }

  if (!isRecord(value)) return;

  Object.entries(value).forEach(([key, child]) => {
    const childPath = path ? `${path}.${key}` : key;
    collectArtifactEntries(child, childPath, output, depth + 1);
  });
}

export function extractKpis(resultPayload: unknown): KpiEntry[] {
  if (!isRecord(resultPayload)) return [];

  const source = resultPayload.kpis;
  const entries: KpiEntry[] = [];

  if (Array.isArray(source)) {
    source.forEach((item, index) => {
      if (!isRecord(item)) return;
      const key = String(item.key || item.name || `kpi_${index + 1}`);
      const value = toNumber(item.value);
      if (value === null) return;
      entries.push({
        key,
        label: humanizeKey(key),
        value,
        unit: inferUnit(key)
      });
    });
  } else if (isRecord(source)) {
    const leaves: Array<{ key: string; value: number }> = [];
    flattenNumericLeaves(source, "", leaves, 0);
    leaves.forEach((item) => {
      entries.push({
        key: item.key,
        label: humanizeKey(item.key),
        value: item.value,
        unit: inferUnit(item.key)
      });
    });
  }

  if (entries.length === 0) {
    const leaves: Array<{ key: string; value: number }> = [];
    flattenNumericLeaves(resultPayload, "", leaves, 0);
    leaves.forEach((item) => {
      entries.push({
        key: item.key,
        label: humanizeKey(item.key),
        value: item.value,
        unit: inferUnit(item.key)
      });
    });
  }

  const deduped = new Map<string, KpiEntry>();
  entries.forEach((entry) => {
    if (!deduped.has(entry.key)) deduped.set(entry.key, entry);
  });

  return Array.from(deduped.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function extractTimeseries(resultPayload: unknown): TimeseriesEntry[] {
  if (!isRecord(resultPayload)) return [];

  const candidates: TimeseriesEntry[] = [];

  if (resultPayload.timeseries !== undefined) {
    collectSeriesCandidates(resultPayload.timeseries, "timeseries", candidates, 0);
  }

  if (candidates.length === 0) {
    collectSeriesCandidates(resultPayload, "", candidates, 0);
  }

  const deduped = new Map<string, TimeseriesEntry>();
  candidates.forEach((entry) => {
    if (!deduped.has(entry.id) && entry.points.length >= 2) deduped.set(entry.id, entry);
  });

  return Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function extractArtifacts(resultPayload: unknown, jobInfo?: JobInfo | null): ArtifactEntry[] {
  const entries: ArtifactEntry[] = [];

  collectArtifactEntries(resultPayload, "result", entries, 0);
  collectArtifactEntries(jobInfo || {}, "job_info", entries, 0);

  const deduped = new Map<string, ArtifactEntry>();
  entries.forEach((entry) => {
    const key = `${entry.kind}:${entry.pathOrUri}`;
    if (!deduped.has(key)) deduped.set(key, entry);
  });

  return Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function buildKpiComparisonRows(
  leftKpis: KpiEntry[],
  rightKpis: KpiEntry[],
  showAll: boolean
): JobKpiComparisonRow[] {
  const leftMap = new Map(leftKpis.map((item) => [item.key, item]));
  const rightMap = new Map(rightKpis.map((item) => [item.key, item]));

  const keySet = new Set<string>();
  if (showAll) {
    leftMap.forEach((_, key) => keySet.add(key));
    rightMap.forEach((_, key) => keySet.add(key));
  } else {
    leftMap.forEach((_, key) => {
      if (rightMap.has(key)) keySet.add(key);
    });
  }

  return Array.from(keySet.values())
    .map((key) => {
      const left = leftMap.get(key)?.value ?? null;
      const right = rightMap.get(key)?.value ?? null;
      const deltaAbs = left !== null && right !== null ? right - left : null;
      const deltaPct =
        left !== null && right !== null && left !== 0 ? ((right - left) / Math.abs(left)) * 100 : null;

      return {
        key,
        label: leftMap.get(key)?.label || rightMap.get(key)?.label || humanizeKey(key),
        left,
        right,
        deltaAbs,
        deltaPct
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

