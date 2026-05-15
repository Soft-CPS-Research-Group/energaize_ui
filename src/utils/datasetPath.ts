export const CONTAINER_DATA_ROOT = "/data";

export function datasetSchemaPath(datasetName: string): string {
  return `${CONTAINER_DATA_ROOT}/datasets/${datasetName}/schema.json`;
}
