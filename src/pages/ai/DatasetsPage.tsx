import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, RefreshCcw, Trash2, UploadCloud } from "lucide-react";
import {
  createDataset,
  datasetDownloadUrl,
  deleteDataset,
  listDatasets,
  listDatasetSites,
  listDatesAvailable,
  uploadDataset,
  type DatasetCreatePayload,
  type DatasetCreateResponse
} from "../../api/trainingApi";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EVChargingLoader } from "../../components/ui/EVChargingLoader";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { useApiFeedback } from "../../hooks/useApiFeedback";
import { getDatasetFormat, getDatasetFormatLabel, getDatasetFormatTone } from "../../utils/datasetFormat";

const DEFAULT_ADVANCED_OVERRIDES = `{
  "schema_overrides": {},
  "building_overrides": {},
  "defaults": {},
  "validation": {
    "smoke_check": false
  }
}`;

interface DatasetForm {
  name: string;
  siteId: string;
  selectedBuildings: string[];
  description: string;
  period: number;
  fromTs: string;
  untilTs: string;
  advancedOverrides: string;
}

const initialForm: DatasetForm = {
  name: "",
  siteId: "",
  selectedBuildings: [],
  description: "",
  period: 60,
  fromTs: "",
  untilTs: "",
  advancedOverrides: DEFAULT_ADVANCED_OVERRIDES
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildCityLearnConfigs(
  selectedBuildings: string[],
  parsedAdvancedOverrides: Record<string, unknown>
): Record<string, unknown> {
  const hasStructuredKeys =
    "schema_overrides" in parsedAdvancedOverrides ||
    "building_overrides" in parsedAdvancedOverrides ||
    "defaults" in parsedAdvancedOverrides ||
    "validation" in parsedAdvancedOverrides ||
    "selected_buildings" in parsedAdvancedOverrides;

  if (!hasStructuredKeys) {
    return {
      selected_buildings: selectedBuildings,
      schema_overrides: parsedAdvancedOverrides
    };
  }

  const schema_overrides = isRecord(parsedAdvancedOverrides.schema_overrides)
    ? parsedAdvancedOverrides.schema_overrides
    : {};
  const building_overrides = isRecord(parsedAdvancedOverrides.building_overrides)
    ? parsedAdvancedOverrides.building_overrides
    : {};
  const defaults = isRecord(parsedAdvancedOverrides.defaults) ? parsedAdvancedOverrides.defaults : {};
  const validation = isRecord(parsedAdvancedOverrides.validation)
    ? parsedAdvancedOverrides.validation
    : {};

  return {
    selected_buildings: selectedBuildings,
    schema_overrides,
    building_overrides,
    defaults,
    validation
  };
}

export function DatasetsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { notifyError, notifySuccess, notifyInfo } = useApiFeedback();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<DatasetForm>(initialForm);
  const [windowInfo, setWindowInfo] = useState<string>("");
  const [refreshingVisual, setRefreshingVisual] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [lastCreateResponse, setLastCreateResponse] = useState<DatasetCreateResponse | null>(null);

  const datasetsQuery = useQuery({
    queryKey: ["datasets"],
    queryFn: listDatasets,
    refetchInterval: 10000
  });

  const sitesQuery = useQuery({
    queryKey: ["dataset-sites"],
    queryFn: listDatasetSites
  });

  const availableSites = sitesQuery.data?.sites ?? [];
  const selectedSite = useMemo(
    () => availableSites.find((site) => site.site_id === form.siteId) ?? null,
    [availableSites, form.siteId]
  );
  const selectableBuildings = selectedSite?.buildings ?? [];

  useEffect(() => {
    if (form.siteId || availableSites.length === 0) return;
    const firstSite = availableSites[0];
    setForm((prev) => ({
      ...prev,
      siteId: firstSite.site_id,
      selectedBuildings: [...firstSite.buildings]
    }));
  }, [availableSites, form.siteId]);

  const createMutation = useMutation({
    mutationFn: (payload: DatasetCreatePayload) => createDataset(payload),
    onSuccess: (response) => {
      setLastCreateResponse(response);
      const warningCount = response.warnings?.length ?? 0;
      if (warningCount > 0) {
        notifyInfo("Dataset created with warnings", `${warningCount} warning(s) returned by orchestrator validation.`);
      } else {
        notifySuccess("Dataset created", "The dataset request was completed.");
      }
      setModalOpen(false);
      setForm((prev) => ({
        ...initialForm,
        siteId: prev.siteId,
        selectedBuildings: prev.selectedBuildings
      }));
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
    },
    onError: (error) => notifyError("Failed to create dataset", error)
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => deleteDataset(name),
    onSuccess: () => {
      notifyInfo("Dataset removed", "Dataset was deleted.");
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
    },
    onError: (error) => notifyError("Failed to delete dataset", error)
  });

  const uploadMutation = useMutation({
    mutationFn: (payload: { file: File; name: string }) => uploadDataset(payload),
    onSuccess: (response) => {
      notifySuccess("Dataset uploaded", `Dataset ${response.name || uploadName} uploaded successfully.`);
      setUploadOpen(false);
      setUploadName("");
      setUploadFile(null);
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
    },
    onError: (error) => notifyError("Failed to upload dataset", error)
  });

  async function checkDateWindow(): Promise<void> {
    if (!form.siteId.trim()) return;
    try {
      const windows = await listDatesAvailable(form.siteId.trim());
      if (windows.length === 0) {
        setWindowInfo("No windows available for this site.");
        return;
      }
      const text = windows
        .slice(0, 3)
        .map((item) => `${item.installation}: ${item.oldest_record} -> ${item.newest_record}`)
        .join("\n");
      setWindowInfo(text);
    } catch (error) {
      notifyError("Could not fetch available dates", error);
    }
  }

  async function refreshWithPreview(): Promise<void> {
    if (refreshingVisual) return;
    setRefreshingVisual(true);
    try {
      await Promise.all([
        datasetsQuery.refetch(),
        sitesQuery.refetch(),
        new Promise((resolve) => window.setTimeout(resolve, 1400))
      ]);
    } finally {
      setRefreshingVisual(false);
    }
  }

  function handleSiteChange(siteId: string): void {
    const selected = availableSites.find((item) => item.site_id === siteId);
    setForm((prev) => ({
      ...prev,
      siteId,
      selectedBuildings: selected ? [...selected.buildings] : []
    }));
    setWindowInfo("");
  }

  function toggleBuilding(buildingId: string): void {
    setForm((prev) => {
      const exists = prev.selectedBuildings.includes(buildingId);
      const selectedBuildings = exists
        ? prev.selectedBuildings.filter((id) => id !== buildingId)
        : [...prev.selectedBuildings, buildingId];
      return { ...prev, selectedBuildings };
    });
  }

  return (
    <div className="page">
      <header className="jobs-hero">
        <div>
          <h1>Datasets</h1>
        </div>
        <div className="jobs-command-group">
          <Button
            variant="secondary"
            iconLeft={!refreshingVisual ? <RefreshCcw size={14} /> : undefined}
            onClick={refreshWithPreview}
            disabled={refreshingVisual}
          >
            {refreshingVisual ? <EVChargingLoader compact /> : "Refresh"}
          </Button>
          <Button
            variant="primary"
            iconLeft={<Plus size={14} />}
            onClick={() => setModalOpen(true)}
            disabled={sitesQuery.isLoading || availableSites.length === 0}
          >
            Generate Dataset
          </Button>
          <Button variant="secondary" iconLeft={<UploadCloud size={14} />} onClick={() => setUploadOpen(true)}>
            Upload Dataset
          </Button>
        </div>
      </header>

      {lastCreateResponse ? (
        <section className="panel" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Last Generation Result</h3>
          <div>
            <strong>Dataset:</strong> {lastCreateResponse.name}
          </div>
          <div>
            <strong>Status:</strong> {lastCreateResponse.message}
          </div>
          <div>
            <strong>Warnings:</strong> {lastCreateResponse.warnings?.length ?? 0}
          </div>
          {lastCreateResponse.warnings && lastCreateResponse.warnings.length > 0 ? (
            <pre className="inline-output" style={{ marginTop: 8 }}>
              {lastCreateResponse.warnings.join("\n")}
            </pre>
          ) : null}
          {lastCreateResponse.validation ? (
            <pre className="inline-output" style={{ marginTop: 8 }}>
              {JSON.stringify(lastCreateResponse.validation, null, 2)}
            </pre>
          ) : null}
        </section>
      ) : null}

      <section className="jobs-main">
        {refreshingVisual ? (
          <section className="datasets-loader-preview">
            <EVChargingLoader label="Refreshing datasets..." />
          </section>
        ) : null}

        {datasetsQuery.data && datasetsQuery.data.length > 0 ? (
          <section className="panel">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {datasetsQuery.data.map((dataset) => {
                  const format = getDatasetFormat(dataset);
                  return (
                    <tr key={dataset.name}>
                      <td>{dataset.name}</td>
                      <td>
                        <Badge tone={getDatasetFormatTone(format)}>
                          {getDatasetFormatLabel(format)}
                        </Badge>
                      </td>
                      <td>{dataset.description || "-"}</td>
                      <td>
                        <div className="table-actions">
                          <a className="btn btn-ghost btn-sm" href={datasetDownloadUrl(dataset.name)}>
                            <Download size={13} />
                            Download
                          </a>
                          <Button
                            size="sm"
                            variant="danger"
                            iconLeft={<Trash2 size={13} />}
                            onClick={() => setDeleteTarget(dataset.name)}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ) : (
          <EmptyState
            title="No datasets"
            message="Generate your first dataset from site telemetry."
            action={
              <Button variant="primary" onClick={() => setModalOpen(true)} disabled={availableSites.length === 0}>
                Generate Dataset
              </Button>
            }
          />
        )}
      </section>

      <Modal title="Generate new dataset" open={modalOpen} onClose={() => setModalOpen(false)} width="lg">
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();

            if (form.selectedBuildings.length === 0) {
              notifyError("No buildings selected", new Error("Select at least one building."));
              return;
            }

            try {
              const parsed = JSON.parse(form.advancedOverrides) as Record<string, unknown>;
              if (!isRecord(parsed)) {
                throw new Error("Advanced overrides must be a JSON object.");
              }

              createMutation.mutate({
                name: form.name.trim(),
                site_id: form.siteId.trim(),
                description: form.description,
                period: Number(form.period),
                from_ts: form.fromTs || undefined,
                until_ts: form.untilTs || undefined,
                citylearn_configs: buildCityLearnConfigs(form.selectedBuildings, parsed)
              });
            } catch {
              notifyError("Invalid JSON", new Error("Advanced overrides must be valid JSON."));
            }
          }}
        >
          <label>
            <span>Name</span>
            <input
              required
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </label>

          <label>
            <span>Site</span>
            <select
              required
              value={form.siteId}
              onChange={(event) => handleSiteChange(event.target.value)}
              disabled={availableSites.length === 0}
            >
              {availableSites.length === 0 ? <option value="">No compatible sites</option> : null}
              {availableSites.map((site) => (
                <option key={site.site_id} value={site.site_id}>
                  {site.site_id}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Period (minutes)</span>
            <input
              type="number"
              min={1}
              value={form.period}
              onChange={(event) => setForm((prev) => ({ ...prev, period: Number(event.target.value) }))}
            />
          </label>

          <label>
            <span>From timestamp</span>
            <input
              type="datetime-local"
              value={form.fromTs}
              onChange={(event) => setForm((prev) => ({ ...prev, fromTs: event.target.value }))}
            />
          </label>

          <label>
            <span>Until timestamp</span>
            <input
              type="datetime-local"
              value={form.untilTs}
              onChange={(event) => setForm((prev) => ({ ...prev, untilTs: event.target.value }))}
            />
          </label>

          <label className="full-col">
            <span>Description</span>
            <textarea
              rows={2}
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            />
          </label>

          <fieldset className="full-col" style={{ border: "1px solid var(--border-color)", borderRadius: 8, padding: 12 }}>
            <legend style={{ padding: "0 8px" }}>Buildings ({form.selectedBuildings.length} selected)</legend>
            <div className="inline-end" style={{ marginBottom: 8 }}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setForm((prev) => ({ ...prev, selectedBuildings: [...selectableBuildings] }))}
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setForm((prev) => ({ ...prev, selectedBuildings: [] }))}
              >
                Clear
              </Button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
              {selectableBuildings.map((building) => (
                <label key={building} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={form.selectedBuildings.includes(building)}
                    onChange={() => toggleBuilding(building)}
                  />
                  <span>{building}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="full-col">
            <span>Advanced Overrides (JSON)</span>
            <textarea
              rows={10}
              value={form.advancedOverrides}
              onChange={(event) => setForm((prev) => ({ ...prev, advancedOverrides: event.target.value }))}
            />
          </label>

          <div className="full-col inline-end">
            <Button type="button" variant="secondary" onClick={checkDateWindow} disabled={!form.siteId}>
              Check data windows
            </Button>
            <Button type="submit" variant="primary" disabled={createMutation.isPending || !form.siteId}>
              {createMutation.isPending ? "Submitting..." : "Create dataset"}
            </Button>
          </div>

          {windowInfo ? <pre className="inline-output">{windowInfo}</pre> : null}
        </form>
      </Modal>

      <Modal title="Upload dataset" open={uploadOpen} onClose={() => setUploadOpen(false)} width="md">
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            if (!uploadFile) {
              notifyError("Missing file", new Error("Select a dataset file (.zip)."));
              return;
            }
            const normalizedName = uploadName.trim();
            if (!normalizedName) {
              notifyError("Missing dataset name", new Error("Provide a dataset name."));
              return;
            }
            uploadMutation.mutate({ file: uploadFile, name: normalizedName });
          }}
        >
          <label className="full-col">
            <span>Dataset name</span>
            <input
              required
              value={uploadName}
              onChange={(event) => setUploadName(event.target.value)}
              placeholder="dataset_name"
            />
          </label>

          <label className="full-col">
            <span>ZIP file</span>
            <input
              required
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                setUploadFile(file);
                if (file && !uploadName.trim()) {
                  const baseName = file.name.replace(/\.zip$/i, "").trim();
                  if (baseName) setUploadName(baseName);
                }
              }}
            />
          </label>

          <div className="full-col inline-end">
            <Button type="submit" variant="primary" disabled={uploadMutation.isPending}>
              {uploadMutation.isPending ? "Uploading..." : "Upload"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete dataset"
        message={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget}"?`
            : "Are you sure you want to delete this dataset?"
        }
        confirmLabel="Delete"
        confirmVariant="danger"
        pending={deleteMutation.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMutation.mutate(deleteTarget, {
            onSettled: () => setDeleteTarget(null)
          });
        }}
      />
    </div>
  );
}
