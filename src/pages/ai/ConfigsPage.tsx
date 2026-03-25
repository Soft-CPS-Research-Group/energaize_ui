import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Plus, RefreshCcw, Trash2 } from "lucide-react";
import {
  deleteExperimentConfig,
  getExperimentConfig,
  listExperimentConfigs,
  saveExperimentConfig
} from "../../api/trainingApi";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { useApiFeedback } from "../../hooks/useApiFeedback";

const DEFAULT_CONFIG = `{
  "metadata": {
    "experiment_name": "Solar Forecast",
    "run_name": "baseline_v1"
  },
  "algorithm": {
    "name": "MADDPG",
    "seed": 42
  }
}`;

export function ConfigsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { notifyError, notifySuccess, notifyInfo } = useApiFeedback();

  const [modalOpen, setModalOpen] = useState(false);
  const [fileName, setFileName] = useState("demo.yaml");
  const [configText, setConfigText] = useState(DEFAULT_CONFIG);
  const [previewFile, setPreviewFile] = useState<string | null>(null);

  const configsQuery = useQuery({
    queryKey: ["configs"],
    queryFn: listExperimentConfigs
  });

  const previewQuery = useQuery({
    queryKey: ["config-preview", previewFile],
    queryFn: () => getExperimentConfig(previewFile || ""),
    enabled: Boolean(previewFile)
  });

  const saveMutation = useMutation({
    mutationFn: (payload: { file_name: string; config: Record<string, unknown> }) =>
      saveExperimentConfig(payload),
    onSuccess: () => {
      notifySuccess("Config saved", "Experiment config stored in backend.");
      setModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["configs"] });
    },
    onError: (error) => notifyError("Failed to save config", error)
  });

  const deleteMutation = useMutation({
    mutationFn: (target: string) => deleteExperimentConfig(target),
    onSuccess: () => {
      notifyInfo("Config deleted", "Config removed from backend.");
      queryClient.invalidateQueries({ queryKey: ["configs"] });
      setPreviewFile(null);
    },
    onError: (error) => notifyError("Failed to delete config", error)
  });

  const stats = useMemo(() => {
    return [
      { label: "Total configs", value: (configsQuery.data?.length || 0).toString() },
      { label: "Selected config", value: previewFile || "-" }
    ];
  }, [configsQuery.data?.length, previewFile]);

  return (
    <div className="page">
      <header className="jobs-hero">
        <div>
          <span className="section-kicker">Training Assets</span>
          <h1>Experiment Configs</h1>
          <p>Create, preview and maintain simulation config files.</p>
        </div>
        <div className="jobs-command-group">
          <Button variant="secondary" iconLeft={<RefreshCcw size={14} />} onClick={() => configsQuery.refetch()}>
            Refresh
          </Button>
          <Button variant="primary" iconLeft={<Plus size={14} />} onClick={() => setModalOpen(true)}>
            New Config
          </Button>
        </div>
      </header>

      <section className="jobs-main">
        <section className="kpi-grid">
          {stats.map((item) => (
            <article key={item.label} className="kpi">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </article>
          ))}
        </section>

        {configsQuery.data && configsQuery.data.length > 0 ? (
          <section className="split-layout">
            <article className="panel">
              <table className="table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {configsQuery.data.map((config) => (
                    <tr key={config}>
                      <td>{config}</td>
                      <td>
                        <div className="table-actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            iconLeft={<Eye size={13} />}
                            onClick={() => setPreviewFile(config)}
                          >
                            View
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            iconLeft={<Trash2 size={13} />}
                            onClick={() => {
                              if (window.confirm(`Delete config ${config}?`)) {
                                deleteMutation.mutate(config);
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
            </article>

            <article className="panel">
              <h2>Config Preview</h2>
              <pre className="json-view">
                {previewFile
                  ? JSON.stringify(previewQuery.data?.config || {}, null, 2)
                  : "Select a config to preview content."}
              </pre>
            </article>
          </section>
        ) : (
          <EmptyState
            title="No configs"
            message="Create your first experiment configuration."
            action={
              <Button variant="primary" onClick={() => setModalOpen(true)}>
                New Config
              </Button>
            }
          />
        )}
      </section>

      <Modal title="Create / update config" open={modalOpen} onClose={() => setModalOpen(false)} width="lg">
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const parsed = JSON.parse(configText) as Record<string, unknown>;
              saveMutation.mutate({ file_name: fileName.trim(), config: parsed });
            } catch {
              notifyError("Invalid JSON", new Error("Config content must be valid JSON"));
            }
          }}
        >
          <label className="full-col">
            <span>File name</span>
            <input
              required
              value={fileName}
              onChange={(event) => setFileName(event.target.value)}
              placeholder="demo.yaml"
            />
          </label>
          <label className="full-col">
            <span>Config body (JSON)</span>
            <textarea rows={14} value={configText} onChange={(event) => setConfigText(event.target.value)} />
          </label>
          <div className="full-col inline-end">
            <Button type="submit" variant="primary" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : "Save config"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
