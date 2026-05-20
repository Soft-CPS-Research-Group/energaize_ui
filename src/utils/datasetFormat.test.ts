import { describe, expect, it } from "vitest";
import { getDatasetFormat, getDatasetFormatLabel } from "./datasetFormat";

describe("datasetFormat", () => {
  it("uses explicit API format metadata only", () => {
    expect(getDatasetFormat({ name: "demo", format: "parquet" })).toBe("parquet");
    expect(getDatasetFormat({ name: "demo_parquet", format: "csv" })).toBe("csv");
  });

  it("uses API format arrays without guessing from names", () => {
    expect(getDatasetFormat({ name: "raw.csv" })).toBe("unknown");
    expect(getDatasetFormat({ name: "demo_parquet" })).toBe("unknown");
    expect(getDatasetFormat({ name: "demo", formats: ["csv", "parquet"] })).toBe("mixed");
  });

  it("renders stable labels", () => {
    expect(getDatasetFormatLabel("csv")).toBe("CSV");
    expect(getDatasetFormatLabel("parquet")).toBe("Parquet");
  });
});
