import { describe, expect, it } from "vitest";
import type { ModelMeta } from "../../../api/analysisApi";
import { fmtParam, fmtTs, formatDetail, groupByHouse, inUseLabel, markInUse, modelLabels, modelsInUse, testDaysValid, wapePct } from "./analysisFormat";

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

describe("models in use", () => {
  const model = (over: Partial<ModelMeta>): ModelMeta => ({
    model_key: "xgboost_direct_model_1_year_R-H-01_consumption", house_id: "R-H-01", lane: "consumption",
    model_type: "warm", model_backend: "xgboost", active: false, in_use_by: [], file_path: "", file_size_kb: 1,
    stored_mae: 0.1, n_features: 10, n_outputs: 96, ...over,
  });
  const use = (house_id: string, lane: "consumption" | "production", model_kind: "warm" | "cold_start" = "warm") =>
    ({ house_id, lane, model_kind, confirmed: true });

  const xgb = model({ active: true, in_use_by: [use("R-H-01", "consumption")] });
  const lgbm = model({ model_key: "lgbm_direct_model_1_year_R-H-01_consumption", model_backend: "lgbm" });
  const cold = model({
    model_key: "xgboost_generic_cold_start_production_model", house_id: null, lane: "production", model_type: "cold_start",
    active: true, in_use_by: [use("R-H-02", "production", "cold_start"), use("R-H-01", "production", "cold_start")],
  });

  it("lists each house with the model per lane, and who uses the generic models", () => {
    const { houses, generic } = modelsInUse([xgb, lgbm, cold]);
    expect(houses.map((h) => h.house_id)).toEqual(["R-H-01", "R-H-02"]);
    expect(houses[0].lanes.consumption?.model.model_key).toBe(xgb.model_key);
    expect(houses[0].lanes.production?.model.model_key).toBe(cold.model_key);
    expect(houses[1].lanes.consumption).toBeUndefined();
    expect(generic).toEqual([{ model: cold, houses: ["R-H-01", "R-H-02"] }]);
  });

  it("falls back to active for predictors that do not send in_use_by", () => {
    const old = { ...xgb, in_use_by: undefined };
    expect(modelsInUse([old]).houses[0].lanes.consumption?.model).toBe(old);
  });

  it("moves the house lane to the model set as active", () => {
    const after = markInUse([xgb, lgbm, cold], lgbm);
    expect(after[0].active).toBe(false);
    expect(after[1].active).toBe(true);
    expect(after[1].in_use_by).toEqual([{ house_id: "R-H-01", lane: "consumption", model_kind: "warm", confirmed: false }]);
    expect(after[2]).toEqual(cold);
  });

  it("groups models per house with the generic ones last", () => {
    const h2 = model({ model_key: "xgboost_direct_model_1_year_R-H-02_consumption", house_id: "R-H-02" });
    expect(groupByHouse([cold, h2, xgb, lgbm]).map((g) => [g.house, g.models.length])).toEqual([["R-H-01", 2], ["R-H-02", 1], [null, 1]]);
  });

  it("labels generic models with their house count", () => {
    expect(inUseLabel(xgb)).toBe("In use");
    expect(inUseLabel(cold)).toBe("In use · 2 houses");
    expect(inUseLabel(lgbm)).toBeNull();
  });
});

describe("wapePct", () => {
  const base = { mae: 0.1, rmse: 0.2, r2: 0.5, n_samples: 10, daytime_mae: null };
  it("reads WAPE, or NMAE from results saved before WAPE", () => {
    expect(wapePct({ ...base, wape_pct: 12.5 })).toBe(12.5);
    expect(wapePct({ ...base, nmae_pct: 14 })).toBe(14);
  });
  it("has no WAPE when the data had no energy", () => {
    expect(wapePct({ ...base, wape_pct: null })).toBeNull();
    expect(wapePct(base)).toBeNull();
  });
});
