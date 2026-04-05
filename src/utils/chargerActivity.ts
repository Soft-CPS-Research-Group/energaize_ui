export interface ChargerStateSample {
  timestamp: string;
  epochMs: number;
  chargerState: 0 | 1 | 2;
  incomingEvName: string | null;
  evName: string | null;
}

export interface ChargerStateBucket {
  epochMs: number;
  chargerState: 0 | 1 | 2;
  evName: string | null;
}

export interface ChargerTransitionEvent {
  type: "connect" | "disconnect";
  epochMs: number;
  evName: string | null;
}

export interface ChargerConnectedInterval {
  startEpochMs: number;
  endEpochMs: number;
  evName: string | null;
}

export interface ChargerActivityOverlay {
  buckets: ChargerStateBucket[];
  events: ChargerTransitionEvent[];
  intervals: ChargerConnectedInterval[];
}

function normalizeState(value: number): 0 | 1 | 2 {
  const rounded = Math.round(value);
  if (rounded === 1 || rounded === 2) return rounded;
  return 0;
}

function normalizeName(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function preferEvName(sample: ChargerStateSample): string | null {
  return normalizeName(sample.evName) || normalizeName(sample.incomingEvName);
}

function statePriority(value: 0 | 1 | 2): number {
  if (value === 1) return 3;
  if (value === 2) return 2;
  return 1;
}

function alignEpochToBucket(epochMs: number, granularityMs: number): number {
  const date = new Date(epochMs);

  if (granularityMs >= 24 * 60 * 60 * 1000) {
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  if (granularityMs % (60 * 60 * 1000) === 0) {
    const hourStep = Math.max(1, Math.round(granularityMs / (60 * 60 * 1000)));
    const hour = date.getHours();
    date.setHours(hour - (hour % hourStep), 0, 0, 0);
    return date.getTime();
  }

  const minuteStep = Math.max(1, Math.round(granularityMs / (60 * 1000)));
  const minute = date.getMinutes();
  date.setMinutes(minute - (minute % minuteStep), 0, 0);
  return date.getTime();
}

export function buildChargerStateBuckets(
  samples: ChargerStateSample[],
  granularityMs: number
): ChargerStateBucket[] {
  if (samples.length === 0 || !Number.isFinite(granularityMs) || granularityMs <= 0) return [];

  const buckets = new Map<
    number,
    {
      state: 0 | 1 | 2;
      statePriority: number;
      firstConnectedEpoch: number;
      connectedEvName: string | null;
      firstEpoch: number;
      fallbackEvName: string | null;
    }
  >();

  const ordered = [...samples].sort((left, right) => left.epochMs - right.epochMs);
  ordered.forEach((sample) => {
    if (!Number.isFinite(sample.epochMs)) return;
    const bucketEpoch = alignEpochToBucket(sample.epochMs, granularityMs);
    const normalizedState = normalizeState(sample.chargerState);
    const priority = statePriority(normalizedState);
    const evName = preferEvName(sample);
    const existing = buckets.get(bucketEpoch);

    if (!existing) {
      buckets.set(bucketEpoch, {
        state: normalizedState,
        statePriority: priority,
        firstConnectedEpoch: normalizedState === 1 ? sample.epochMs : Number.POSITIVE_INFINITY,
        connectedEvName: normalizedState === 1 ? evName : null,
        firstEpoch: sample.epochMs,
        fallbackEvName: evName
      });
      return;
    }

    if (sample.epochMs < existing.firstEpoch) {
      existing.firstEpoch = sample.epochMs;
      existing.fallbackEvName = evName;
    }

    if (normalizedState === 1 && sample.epochMs < existing.firstConnectedEpoch) {
      existing.firstConnectedEpoch = sample.epochMs;
      existing.connectedEvName = evName;
    }

    if (priority > existing.statePriority) {
      existing.state = normalizedState;
      existing.statePriority = priority;
    }
  });

  return Array.from(buckets.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([epochMs, bucket]) => ({
      epochMs,
      chargerState: bucket.state,
      evName: bucket.state === 1 ? bucket.connectedEvName : bucket.fallbackEvName
    }));
}

export function deriveChargerActivityOverlay(input: {
  samples: ChargerStateSample[];
  granularityMs: number;
  rangeStart: number | null;
  rangeEnd: number | null;
}): ChargerActivityOverlay {
  const buckets = buildChargerStateBuckets(input.samples, input.granularityMs);
  if (buckets.length === 0) {
    return {
      buckets: [],
      events: [],
      intervals: []
    };
  }

  const allEvents: ChargerTransitionEvent[] = [];
  const allIntervals: ChargerConnectedInterval[] = [];

  let previousState: 0 | 1 | 2 = 0;
  let connectedStart: number | null = null;
  let connectedEvName: string | null = null;
  let lastConnectedEvName: string | null = null;
  let lastConnectedEpoch: number | null = null;

  for (const bucket of buckets) {
    const currentState = bucket.chargerState;
    if (previousState !== 1 && currentState === 1) {
      connectedStart = bucket.epochMs;
      connectedEvName = normalizeName(bucket.evName);
      lastConnectedEvName = connectedEvName || lastConnectedEvName;
      allEvents.push({
        type: "connect",
        epochMs: bucket.epochMs,
        evName: connectedEvName
      });
    }

    if (previousState === 1 && currentState !== 1) {
      const disconnectName: string | null =
        normalizeName(bucket.evName) || connectedEvName || lastConnectedEvName;
      const disconnectEpoch = lastConnectedEpoch ?? bucket.epochMs;
      if (connectedStart !== null && disconnectEpoch >= connectedStart) {
        let intervalEnd = disconnectEpoch;
        // Keep one-step sessions visible in the shaded overlay.
        if (intervalEnd <= connectedStart) {
          intervalEnd = connectedStart + Math.max(input.granularityMs, 1);
        }
        allIntervals.push({
          startEpochMs: connectedStart,
          endEpochMs: intervalEnd,
          evName: connectedEvName || lastConnectedEvName
        });
      }
      allEvents.push({
        type: "disconnect",
        epochMs: disconnectEpoch,
        evName: disconnectName
      });
      connectedStart = null;
      connectedEvName = disconnectName;
      lastConnectedEvName = disconnectName || lastConnectedEvName;
      lastConnectedEpoch = null;
    }

    if (currentState === 1) {
      const nextName = normalizeName(bucket.evName);
      if (nextName) {
        connectedEvName = nextName;
        lastConnectedEvName = nextName;
      }
      lastConnectedEpoch = bucket.epochMs;
    }

    previousState = currentState;
  }

  if (previousState === 1 && connectedStart !== null) {
    const openEnd =
      input.rangeEnd !== null
        ? input.rangeEnd
        : buckets[buckets.length - 1].epochMs + Math.max(input.granularityMs, 1);
    if (openEnd >= connectedStart) {
      allIntervals.push({
        startEpochMs: connectedStart,
        endEpochMs: openEnd,
        evName: connectedEvName || lastConnectedEvName
      });
    }
  }

  const rangeStart = input.rangeStart;
  const rangeEnd = input.rangeEnd;
  const inRange = (epochMs: number): boolean => {
    if (rangeStart !== null && epochMs < rangeStart) return false;
    if (rangeEnd !== null && epochMs > rangeEnd) return false;
    return true;
  };

  const clippedIntervals = allIntervals
    .map((interval) => {
      const startEpochMs = rangeStart !== null ? Math.max(interval.startEpochMs, rangeStart) : interval.startEpochMs;
      const endEpochMs = rangeEnd !== null ? Math.min(interval.endEpochMs, rangeEnd) : interval.endEpochMs;
      return {
        ...interval,
        startEpochMs,
        endEpochMs
      };
    })
    .filter((interval) => interval.endEpochMs > interval.startEpochMs);

  return {
    buckets: buckets.filter((bucket) => inRange(bucket.epochMs)),
    events: allEvents.filter((event) => inRange(event.epochMs)),
    intervals: clippedIntervals
  };
}
