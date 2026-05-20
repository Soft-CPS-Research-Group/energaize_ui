import type { DatasetItem } from "../types";

export type DatasetFormat = "csv" | "parquet" | "mixed" | "unknown";

type DatasetFormatSource = Pick<
  DatasetItem,
  "name" | "format" | "type" | "dataset_type" | "file_format" | "data_format" | "formats"
>;

function normalizeFormat(value: unknown): DatasetFormat | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "csv") return "csv";
  if (normalized === "parquet" || normalized === "parq" || normalized === "pq") return "parquet";
  if (normalized === "mixed" || normalized === "csv+parquet" || normalized === "parquet+csv") return "mixed";
  return null;
}

export function getDatasetFormat(dataset: DatasetFormatSource): DatasetFormat {
  for (const value of [
    dataset.format,
    dataset.type,
    dataset.dataset_type,
    dataset.file_format,
    dataset.data_format
  ]) {
    const normalized = normalizeFormat(value);
    if (normalized) return normalized;
  }

  if (Array.isArray(dataset.formats)) {
    const formats = new Set(dataset.formats.map(normalizeFormat).filter(Boolean));
    if (formats.size > 1) return "mixed";
    if (formats.has("csv")) return "csv";
    if (formats.has("parquet")) return "parquet";
  }

  return "unknown";
}

export function getDatasetFormatLabel(format: DatasetFormat): string {
  if (format === "csv") return "CSV";
  if (format === "parquet") return "Parquet";
  if (format === "mixed") return "Mixed";
  return "Unknown";
}

export function getDatasetFormatTone(format: DatasetFormat): "neutral" | "info" | "warning" {
  if (format === "parquet") return "info";
  if (format === "mixed") return "warning";
  return "neutral";
}
