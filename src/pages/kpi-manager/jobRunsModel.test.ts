import { describe, expect, it } from "vitest";
import { comparisonRows, comparisonScopes, duration, houseCoverage, scopeLabel } from "./jobRunsModel";

describe("job runs model", () => {
  it("groups the houses the BAU left out by reason", () => {
    const c = houseCoverage([
      { house: "RH27", site_id: "a", included: 96, expected: 96, reasons: [] },
      { house: "RH02", site_id: "b", included: 0, expected: 96, reasons: ["Missing or ambiguous main grid import channel"] },
      { house: "RH03", site_id: "c", included: 0, expected: 96, reasons: ["Missing or ambiguous main grid import channel"] },
      { house: "RH01", site_id: "d", included: 0, expected: 96, reasons: ["Missing battery efficiency"] },
    ]);
    expect(c.included.map((h) => h.house)).toEqual(["RH27"]);
    expect(c.excluded).toBe(3);
    expect(c.reasons).toEqual([["Missing or ambiguous main grid import channel", 2], ["Missing battery efficiency", 1]]);
  });

  it("compares real with BAU, the community first", () => {
    const bau = { report: { comparison: {
      building_demflex_rh27: { EnergyCostKPI: { real: 1.0, bau: 1.1, unit: "€" } },
      community: { EnergyCostKPI: { real: 1.74, bau: 1.92, unit: "€" }, RampingKPI: { real: 2, bau: null } },
    } } };
    expect(comparisonScopes(bau)).toEqual(["community", "building_demflex_rh27"]);
    const [cost, ramping] = comparisonRows(bau);
    expect(cost.delta).toBeCloseTo(-0.18);
    expect(ramping.delta).toBeNull();
  });

  it("formats durations and building names", () => {
    expect(duration("2026-11-25T04:00:00Z", "2026-11-25T04:12:30Z")).toBe("13 min");
    expect(duration("2026-11-25T04:00:00Z", "2026-11-25T07:05:00Z")).toBe("3 h 05 min");
    expect(duration("2026-11-25T04:00:00Z")).toBe("—");
    expect(scopeLabel("building_demflex-rh27")).toBe("demflex-rh27");
    expect(scopeLabel("community")).toBe("Community");
  });
});
