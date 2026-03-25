import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, RefreshCcw, Trash2 } from "lucide-react";
import {
  createDataset,
  datasetDownloadUrl,
  deleteDataset,
  listDatasets,
  listDatesAvailable,
  type DatasetCreatePayload
} from "../../api/trainingApi";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { useApiFeedback } from "../../hooks/useApiFeedback";

const DEFAULT_CONFIG = `{
  "buildings": ["R-H-01"],
  "signals": ["load", "pv"],
  "weather": true
}`;

interface DatasetForm {
  name: string;
  siteId: string;
  description: string;
  period: number;
  fromTs: string;
  untilTs: string;
  citylearnConfigs: string;
}

const initialForm: DatasetForm = {
  name: "",
  siteId: "",
  description: "",
  period: 60,
  fromTs: "",
  untilTs: "",
  citylearnConfigs: DEFAULT_CONFIG
};

export function DatasetsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { notifyError, notifySuccess, notifyInfo } = useApiFeedback();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<DatasetForm>(initialForm);
  const [windowInfo, setWindowInfo] = useState<string>("");

  const datasetsQuery = useQuery({
    queryKey: ["datasets"],
    queryFn: listDatasets,
    refetchInterval: 10000
  });

  const createMutation = useMutation({
    mutationFn: (payload: DatasetCreatePayload) => createDataset(payload),
    onSuccess: () => {
      notifySuccess("Dataset created", "The dataset request was submitted.");
      setModalOpen(false);
      setForm(initialForm);
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

  const stats = useMemo(() => {
    const total = datasetsQuery.data?.length || 0;
    return [
      { label: "Total datasets", value: total.toString() },
      { label: "Last update", value: datasetsQuery.dataUpdatedAt ? "Now" : "-" },
      { label: "Pending jobs", value: "-" }
    ];
  }, [datasetsQuery.data?.length, datasetsQuery.dataUpdatedAt]);

  return (
    <div className="page">
      <header className="jobs-hero">
        <div>
          <span className="section-kicker">Training Assets</span>
          <h1>Datasets</h1>
          <p>Generate and manage training datasets.</p>
        </div>
        <div className="jobs-command-group">
          <Button variant="secondary" iconLeft={<RefreshCcw size={14} />} onClick={() => datasetsQuery.refetch()}>
            Refresh
          </Button>
          <Button variant="primary" iconLeft={<Plus size={14} />} onClick={() => setModalOpen(true)}>
            Generate Dataset
          </Button>
        </div>
      </header>

      <section className="jobs-main">
        <section className="kpi-grid">
          {stats.map((item) => (
            <article className="kpi" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </article>
          ))}
        </section>

        {datasetsQuery.data && datasetsQuery.data.length > 0 ? (
          <section className="panel">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {datasetsQuery.data.map((dataset) => (
                  <tr key={dataset.name}>
                    <td>{dataset.name}</td>
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
                          onClick={() => {
                            if (window.confirm(`Delete dataset ${dataset.name}?`)) {
                              deleteMutation.mutate(dataset.name);
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : (
          <EmptyState
            title="No datasets"
            message="Generate your first dataset from site telemetry."
            action={
              <Button variant="primary" onClick={() => setModalOpen(true)}>
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
            try {
              const parsed = JSON.parse(form.citylearnConfigs) as Record<string, unknown>;
              createMutation.mutate({
                name: form.name.trim(),
                site_id: form.siteId.trim(),
                description: form.description,
                period: Number(form.period),
                from_ts: form.fromTs || undefined,
                until_ts: form.untilTs || undefined,
                citylearn_configs: parsed
              });
            } catch {
              notifyError("Invalid JSON", new Error("citylearn_configs must be valid JSON"));
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
            <span>Site ID</span>
            <input
              required
              value={form.siteId}
              onChange={(event) => setForm((prev) => ({ ...prev, siteId: event.target.value }))}
            />
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

          <label className="full-col">
            <span>citylearn_configs (JSON)</span>
            <textarea
              rows={8}
              value={form.citylearnConfigs}
              onChange={(event) => setForm((prev) => ({ ...prev, citylearnConfigs: event.target.value }))}
            />
          </label>

          <div className="full-col inline-end">
            <Button type="button" variant="secondary" onClick={checkDateWindow}>
              Check data windows
            </Button>
            <Button type="submit" variant="primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Submitting..." : "Create dataset"}
            </Button>
          </div>

          {windowInfo ? <pre className="inline-output">{windowInfo}</pre> : null}
        </form>
      </Modal>
    </div>
  );
}
