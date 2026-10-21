import { describe, expect, it } from "vitest";
import { fmtParam, fmtTs, formatDetail, modelLabels, testDaysValid } from "./analysisFormat";

describe("fmtTs", () => {
  it("shows an analysis job time in the chosen timezone", () => {
    expect(fmtTs("2026-10-20T23:30:00+00:00", "Europe/Lisbon")).toBe("21/10/2026, 00:30");
    expect(fmtTs("2026-10-20T23:30:00+00:00", "UTC")).toBe("20/10/2026, 23:30");
  });

  it("reads a bare timestamp as UTC", () => {
    expect(fmtTs("2026-10-20T23:30:00", "UTC")).toBe("20/10/2026, 23:30");
  });

  it("shows a dash for a missing time", () => {
    expect(fmtTs(null, "UTC")).toBe("—");
  });
});

describe("fmtParam", () => {
  it("trims float noise but keeps whole numbers", () => {
    expect(fmtParam(0.060000000000000005)).toBe("0.06");
    expect(fmtParam(400)).toBe("400");
    expect(fmtParam(undefined)).toBe("—");
  });
});

describe("testDaysValid", () => {
  it("accepts whole days from 7 up to the limit", () => {
    expect(testDaysValid(7)).toBe(true);
    expect(testDaysValid(365)).toBe(true);
    expect(testDaysValid(6)).toBe(false);
    expect(testDaysValid(0)).toBe(false);
    expect(testDaysValid(12.5)).toBe(false);
    expect(testDaysValid(120, 90)).toBe(false);
  });
});

describe("formatDetail", () => {
  it("labels model fields in plain words", () => {
    expect(formatDetail("model_backend", "lgbm")).toBe("LightGBM");
    expect(formatDetail("model_type", "cold_start")).toBe("Cold start");
    expect(formatDetail("file_size_kb", 381.09999999999997)).toBe("381.1 KB");
    expect(formatDetail("house_id", null)).toBe("Generic");
    expect(formatDetail("active", false)).toBe("No");
  });
});

describe("modelLabels", () => {
  it("names compared models by backend and archive date", () => {
    expect(modelLabels(["xgboost_consumption_R-H-01", "lgbm_consumption_R-H-01", "old/xgboost_consumption_R-H-01_20261001_143005", "old/lgbm_consumption_R-H-01_20260915"])).toEqual({
      "xgboost_consumption_R-H-01": "XGBoost",
      "lgbm_consumption_R-H-01": "LightGBM",
      "old/xgboost_consumption_R-H-01_20261001_143005": "XGBoost, archived 2026-10-01 14:30",
      "old/lgbm_consumption_R-H-01_20260915": "LightGBM, archived 2026-09-15",
    });
  });

  it("falls back to the key when two models would share a name", () => {
    const keys = ["xgboost_consumption_R-H-01", "xgboost_consumption_R-H-02"];
    expect(modelLabels(keys)).toEqual({ [keys[0]]: keys[0], [keys[1]]: keys[1] });
  });
});
