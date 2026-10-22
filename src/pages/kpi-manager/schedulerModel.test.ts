import { describe, expect, it } from "vitest";
import { buildCron, isValidLookback, jobPayload, lookbackPayload, EMPTY_JOB_FORM } from "./schedulerModel";

describe("scheduler model", () => {
  it("builds cron expressions for each frequency", () => {
    expect(buildCron("hourly", 5, 0, 1)).toBe("5 * * * *");
    expect(buildCron("daily", 5, 3, 1)).toBe("5 3 * * *");
    expect(buildCron("weekly", 10, 0, 1)).toBe("10 0 * * 1");
  });

  it("keeps hours and days on the legacy fields every module version accepts", () => {
    expect(lookbackPayload("2h")).toEqual({ lookback_hours: 2, lookback_days: 0 });
    expect(lookbackPayload(" 7D ")).toEqual({ lookback_hours: 0, lookback_days: 7 });
  });

  it("sends weeks, months and minutes as a lookback string instead of a wrong number of days", () => {
    expect(lookbackPayload("1w")).toEqual({ lookback: "1w" });
    expect(lookbackPayload("1mo")).toEqual({ lookback: "1mo" });
    expect(lookbackPayload("15m")).toEqual({ lookback: "15m" });
  });

  it("validates lookback durations", () => {
    for (const ok of ["15m", "1h", "2d", "1w", "1mo", "1y"]) expect(isValidLookback(ok)).toBe(true);
    for (const bad of ["", "h", "1x", "one day", "1.5h"]) expect(isValidLookback(bad)).toBe(false);
  });

  it("builds the jobs API payload", () => {
    expect(jobPayload({ ...EMPTY_JOB_FORM, id: "j", kpis: ["EnergyCostKPI"], lookback: "1w" })).toEqual({
      id: "j", community: "*", buildings: ["*"], kpis: ["EnergyCostKPI"], cron: "5 * * * *", lookback: "1w",
    });
  });
});
