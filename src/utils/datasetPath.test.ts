import { describe, expect, it } from "vitest";
import { datasetSchemaPath } from "./datasetPath";

describe("datasetPath", () => {
  it("builds dataset schema paths inside the job container mount", () => {
    expect(datasetSchemaPath("demo_dataset")).toBe("/data/datasets/demo_dataset/schema.json");
  });
});
