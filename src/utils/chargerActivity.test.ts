import { describe, expect, it } from "vitest";
import {
  buildChargerStateBuckets,
  deriveChargerActivityOverlay,
  type ChargerStateSample
} from "./chargerActivity";

const BASE_EPOCH = Date.UTC(2026, 0, 1, 12, 0, 0);

function sample(offsetMinutes: number, state: 0 | 1 | 2, evName: string | null = null): ChargerStateSample {
  return {
    timestamp: new Date(BASE_EPOCH + offsetMinutes * 60_000).toISOString(),
    epochMs: BASE_EPOCH + offsetMinutes * 60_000,
    chargerState: state,
    incomingEvName: evName,
    evName
  };
}

describe("chargerActivity utils", () => {
  it("bucketizes with state priority 1 > 2 > 0", () => {
    const buckets = buildChargerStateBuckets(
      [sample(0, 0), sample(1, 2), sample(2, 1, "EV_A"), sample(4, 0)],
      5 * 60_000
    );

    expect(buckets).toHaveLength(1);
    expect(buckets[0].chargerState).toBe(1);
    expect(buckets[0].evName).toBe("EV_A");
  });

  it("keeps first connected EV name inside the same bucket", () => {
    const buckets = buildChargerStateBuckets(
      [sample(0, 1, "EV_FIRST"), sample(1, 1, "EV_SECOND"), sample(2, 2, "EV_INCOMING")],
      5 * 60_000
    );

    expect(buckets[0].chargerState).toBe(1);
    expect(buckets[0].evName).toBe("EV_FIRST");
  });

  it("detects connect/disconnect transitions and shaded intervals", () => {
    const overlay = deriveChargerActivityOverlay({
      samples: [
        sample(0, 0),
        sample(1, 2, "EV_A"),
        sample(2, 1, "EV_A"),
        sample(3, 1, "EV_A"),
        sample(4, 2, null),
        sample(5, 0, null)
      ],
      granularityMs: 60_000,
      rangeStart: BASE_EPOCH,
      rangeEnd: BASE_EPOCH + 6 * 60_000
    });

    expect(overlay.events).toEqual([
      { type: "connect", epochMs: BASE_EPOCH + 2 * 60_000, evName: "EV_A" },
      { type: "disconnect", epochMs: BASE_EPOCH + 3 * 60_000, evName: "EV_A" }
    ]);

    expect(overlay.intervals).toEqual([
      {
        startEpochMs: BASE_EPOCH + 2 * 60_000,
        endEpochMs: BASE_EPOCH + 3 * 60_000,
        evName: "EV_A"
      }
    ]);
  });

  it("closes open sessions at range end when disconnect is missing", () => {
    const overlay = deriveChargerActivityOverlay({
      samples: [sample(0, 0), sample(1, 1, "EV_OPEN"), sample(2, 1, "EV_OPEN")],
      granularityMs: 60_000,
      rangeStart: BASE_EPOCH,
      rangeEnd: BASE_EPOCH + 5 * 60_000
    });

    expect(overlay.events).toEqual([{ type: "connect", epochMs: BASE_EPOCH + 60_000, evName: "EV_OPEN" }]);
    expect(overlay.intervals).toEqual([
      {
        startEpochMs: BASE_EPOCH + 60_000,
        endEpochMs: BASE_EPOCH + 5 * 60_000,
        evName: "EV_OPEN"
      }
    ]);
  });

  it("uses last connected EV name on disconnect when bucket name is empty", () => {
    const overlay = deriveChargerActivityOverlay({
      samples: [sample(0, 1, "EV_X"), sample(1, 1, "EV_X"), sample(2, 0, null)],
      granularityMs: 60_000,
      rangeStart: BASE_EPOCH,
      rangeEnd: BASE_EPOCH + 10 * 60_000
    });

    expect(overlay.events[1]).toEqual({
      type: "disconnect",
      epochMs: BASE_EPOCH + 60_000,
      evName: "EV_X"
    });
  });
});
