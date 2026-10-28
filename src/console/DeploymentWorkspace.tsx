import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Cloud,
  Cpu,
  Database,
  GripVertical,
  Network,
  Radio,
  RefreshCw,
  Server,
  X,
} from "lucide-react";
import { runtimeRequest } from "../api/runtimeApi";
import { PerceptaSetup } from "./PerceptaSetup";
import { EVChargingLoader } from "../components/ui/EVChargingLoader";
import { RuntimePanel } from "./RuntimePanel";
import {
  connections,
  graphLayout,
  names,
  services,
  stamp,
  stateName,
  type Connection,
  type ConnectionId,
  type DeploymentMap,
  type Draft,
  type Placement,
  type Service,
} from "./deploymentModel";
export type { DeploymentMap } from "./deploymentModel";

function Overlay({
  title,
  children,
  onClose,
  wide = false,
}: {
  wide?: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const element = ref.current;
    const root = element?.getRootNode() as Document | ShadowRoot;
    const focused = root?.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      focused?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={"deployment-dialog" + (wide ? " deployment-dialog-wide" : "")}
      aria-labelledby={id}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="deployment-dialog-content">
        <header>
          <h3 id={id}>{title}</h3>
          <button className="btn text" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
const icon = (kind: string) =>
  kind === "percepta" ? (
    <Radio size={19} />
  ) : kind === "controller" ? (
    <Cpu size={19} />
  ) : kind === "mongo" ? (
    <Database size={19} />
  ) : kind === "backend" ? (
    <Server size={19} />
  ) : (
    <Network size={19} />
  );
export function DeploymentWorkspace({
  siteId,
  siteName,
  navigate,
}: {
  siteId: string;
  siteName: string;
  navigate: (path: string) => void;
}) {
  const [map, setMap] = useState<DeploymentMap | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [saved, setSaved] = useState<Draft | null>(null);
  const [view, setView] = useState<"plan" | "operation">("plan"),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false),
    [saving, setSaving] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [review, setReview] = useState(false),
    [detail, setDetail] = useState<Service | null>(null);
  const [dragging, setDragging] = useState<Service | null>(null),
    [hoverHost, setHoverHost] = useState<string | null>(null);
  const sequence = useRef(0),
    canvas = useRef<HTMLDivElement>(null),
    marker = useId().replaceAll(":", "");
  const drag = useRef<{
      kind: Service;
      x: number;
      y: number;
      moved: boolean;
    } | null>(null),
    suppressClick = useRef(false);
  const dirty =
    !!draft &&
    !!saved &&
    JSON.stringify([draft.services, draft.connections]) !==
      JSON.stringify([saved.services, saved.connections]);
  const load = useCallback(async () => {
    const seq = ++sequence.current;
    setError("");
    try {
      const [m, d] = await Promise.all([
        runtimeRequest<DeploymentMap>(
          `/api/runtime/sites/${siteId}/deployment-view`,
        ),
        runtimeRequest<Draft>(`/api/runtime/sites/${siteId}/deployment-draft`),
      ]);
      if (seq === sequence.current) {
        setMap(m);
        setDraft(d);
        setSaved(d);
      }
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
    }
  }, [siteId]);
  useEffect(() => {
    setMap(null);
    setDraft(null);
    setSaved(null);
    setEditing(null);
    setDetail(null);
    setReview(false);
    setView("plan");
    setMessage("");
    setChecking(false);
    setSaving(false);
    void load();
    return () => {
      sequence.current++;
    };
  }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const check = async () => {
    const seq = sequence.current;
    setChecking(true);
    setError("");
    try {
      const m = await runtimeRequest<DeploymentMap>(
        `/api/runtime/sites/${siteId}/deployment-check`,
        { method: "POST", signal: AbortSignal.timeout(60000) },
      );
      if (seq === sequence.current) setMap(m);
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
    } finally {
      if (seq === sequence.current) setChecking(false);
    }
  };
  const save = async () => {
    if (!draft) return false;
    const seq = sequence.current;
    setSaving(true);
    setError("");
    try {
      const result = await runtimeRequest<Draft>(
        `/api/runtime/sites/${siteId}/deployment-draft`,
        {
          method: "PUT",
          body: JSON.stringify({
            services: draft.services,
            connections: draft.connections,
            base_revision: map?.revision ?? null,
            expected_revision: draft.revision,
          }),
        },
      );
      if (seq !== sequence.current) return false;
      setDraft(result);
      setSaved(result);
      setMessage("Draft saved. Running services have not changed.");
      return true;
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
      return false;
    } finally {
      if (seq === sequence.current) setSaving(false);
    }
  };
  const place = (kind: Service, placement: Placement) => {
    if (saving) return;
    setDraft((d) =>
      d ? { ...d, services: { ...d.services, [kind]: placement } } : d,
    );
    setMessage("");
  };
  const destinationAt = (x: number, y: number) =>
    Array.from(
      canvas.current?.querySelectorAll<HTMLElement>("[data-deployment-host]") ||
        [],
    ).find((el) => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
  if (detail && detail !== "forecasting")
    return (
      <section className="deployment-detail">
        <button
          className="btn text"
          onClick={() => {
            setDetail(null);
            const seq = sequence.current;
            void runtimeRequest<DeploymentMap>(
              `/api/runtime/sites/${siteId}/deployment-view`,
            )
              .then((m) => {
                if (seq === sequence.current) setMap(m);
              })
              .catch((e) => setError(e.message));
          }}
        >
          <ArrowLeft size={16} /> Back to deployment
        </button>
        <p className="notice">
          Current service controls. Changes here affect the existing runtime
          configuration; they are separate from the deployment draft.
        </p>
        <RuntimePanel
          siteId={siteId}
          siteName={siteName}
          kind={detail}
          navigate={navigate}
        />
      </section>
    );
  const planning = view === "plan",
    layout = map && draft ? graphLayout(map, draft, planning) : null;
  const currentService =
    editing && services.includes(editing as Service)
      ? (editing as Service)
      : null;
  const currentLink = editing?.startsWith("link:")
    ? connections.find((l) => l.id === editing.slice(5))
    : null;
  return (
    <section className="deployment-workspace" aria-label="Deployment">
      <header className="deployment-heading">
        <div>
          <span className="eyebrow">{siteName}</span>
          <h2>Deployment</h2>
          <p>
            Place the services. Review the connections. Keep track of what is
            running.
          </p>
        </div>
        <button
          className="btn"
          disabled={checking}
          onClick={() => void check()}
        >
          <RefreshCw
            size={15}
            className={checking ? "deployment-spinning" : ""}
          />
          {checking ? "Checking machines…" : "Check machines"}
        </button>
      </header>
      {error && (
        <div className="notice" role="alert">
          {error}{" "}
          <button
            className="btn text"
            onClick={() => {
              if (
                !dirty ||
                window.confirm("Reload and discard unsaved changes?")
              )
                void load();
            }}
          >
            Reload
          </button>
        </div>
      )}
      {!map || !draft || !layout ? (
        <EVChargingLoader label="Loading deployment…" />
      ) : (
        <>
          <div className="deployment-toolbar">
            <div className="deployment-tabs" aria-label="Deployment view">
              <button
                aria-pressed={!planning}
                onClick={() => setView("operation")}
              >
                In operation{" "}
                <span>{map.components.filter((c) => !c.planned).length}</span>
              </button>
              <button aria-pressed={planning} onClick={() => setView("plan")}>
                Deployment plan{" "}
                <span>
                  {dirty ? "Edited" : draft.revision ? "Saved" : "Suggested"}
                </span>
              </button>
            </div>
            <span className="deployment-caption">
              {planning
                ? "Draft · nothing is applied by editing this map"
                : "Observed runtime · read only"}
            </span>
          </div>
          {draft.stale && planning && (
            <p className="notice">
              The house destinations changed since this draft was saved. Review
              the destinations below and save again.
            </p>
          )}
          <div className="deployment-instruction">
            {planning ? (
              <>
                <GripVertical size={14} /> Drag a service to a machine. Click a
                service to configure it, or an arrow label to edit its
                connection.
              </>
            ) : (
              <>
                <Check size={14} /> Only registered runtime instances appear
                here. Shared platform health and application connections have
                not been verified.
              </>
            )}
          </div>
          <div className="deployment-scroll">
            <div
              ref={canvas}
              className={"deployment-map" + (dragging ? " is-dragging" : "")}
              style={{ width: layout.width, height: layout.height }}
            >
              {layout.hosts.map((h) => (
                <section
                  key={h.destination.id}
                  data-deployment-host={h.destination.id}
                  data-placement={h.destination.placement}
                  className={
                    "deployment-host" +
                    (hoverHost === h.destination.id ? " is-drop-target" : "")
                  }
                  aria-label={h.destination.name}
                  style={{
                    left: h.x,
                    top: h.y,
                    width: h.width,
                    height: h.height,
                  }}
                >
                  <header>
                    {h.destination.placement === "cloud" ? (
                      <Cloud size={23} />
                    ) : (
                      <Cpu size={23} />
                    )}
                    <div className="deployment-host-identity">
                      <span className="eyebrow">
                        {h.destination.placement === "cloud"
                          ? "CENTRAL SERVER"
                          : "HOUSE MACHINE"}
                      </span>
                      <h3>{h.destination.name}</h3>
                      <small className="deployment-hardware">
                        {h.destination.check.architecture ||
                          "Architecture not checked"}
                        {h.destination.check.memory_bytes
                          ? ` · ${(h.destination.check.memory_bytes / 1024 ** 3).toFixed(1)} GiB`
                          : ""}
                      </small>
                    </div>
                    <div className="deployment-host-status">
                      <span
                        className={
                          "deployment-state state-" + h.destination.check.state
                        }
                      >
                        <i />
                        {h.destination.check.state === "online"
                          ? "Online"
                          : h.destination.check.state === "unreachable"
                            ? "Unreachable"
                            : stateName(h.destination.check.state)}
                      </span>
                      <time
                        dateTime={h.destination.check.checked_at || undefined}
                      >
                        {h.destination.check.checked_at ? (
                          <>
                            Last checked at
                            <br />
                            {stamp(h.destination.check.checked_at)}
                          </>
                        ) : (
                          "Never checked"
                        )}
                      </time>
                    </div>
                  </header>
                  {!layout.nodes.some(
                    (n) =>
                      n.destination === h.destination.id &&
                      n.kind !== "backend",
                  ) && (
                    <p className="deployment-empty">
                      {planning
                        ? "Drop a service here"
                        : "No services deployed for this house"}
                    </p>
                  )}
                </section>
              ))}
              <svg
                className="deployment-wires"
                width={layout.width}
                height={layout.height}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id={marker + "end"}
                    viewBox="0 0 8 8"
                    refX="7"
                    refY="4"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path
                      d="M 1 1 L 7 4 L 1 7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                    />
                  </marker>
                </defs>
                {layout.edges.map((edge) => (
                  <path
                    key={edge.id}
                    d={edge.path}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeDasharray={
                      edge.id === "forecasting" ? "4 5" : undefined
                    }
                    markerEnd={`url(#${marker}end)`}
                    markerStart={
                      connections.find((c) => c.id === edge.id)?.twoWay
                        ? `url(#${marker}end)`
                        : undefined
                    }
                  />
                ))}
              </svg>
              {layout.edges.map((edge) => (
                <button
                  key={edge.id}
                  className={
                    "deployment-edge-label" +
                    (edge.internal ? " internal" : "") +
                    (edge.id === "forecasting" ? " proposed" : "")
                  }
                  style={{ left: edge.x, top: edge.y }}
                  onClick={() => setEditing("link:" + edge.id)}
                  aria-label={"Edit " + edge.id + " connection"}
                >
                  {connections.find((l) => l.id === edge.id)?.label}
                  {draft.connections[edge.id]?.mode === "manual" && " · edited"}
                </button>
              ))}
              {layout.nodes.map((node) => {
                const movable =
                  planning && services.includes(node.kind as Service);
                return (
                  <button
                    key={node.id}
                    className={
                      "deployment-node" +
                      (movable ? " movable" : "") +
                      (dragging === node.kind ? " dragging" : "") +
                      (node.kind === "backend" ||
                      node.kind === "broker" ||
                      node.kind === "mongo"
                        ? " shared"
                        : "")
                    }
                    style={{
                      left: node.x,
                      top: node.y,
                      width: node.width,
                      height: node.height,
                    }}
                    aria-label={node.name + " · " + node.state}
                    disabled={saving}
                    onClick={() => {
                      if (suppressClick.current) {
                        suppressClick.current = false;
                        return;
                      }
                      setEditing(planning ? node.kind : "actual:" + node.id);
                    }}
                    onPointerDown={(e) => {
                      if (!movable || e.button !== 0) return;
                      drag.current = {
                        kind: node.kind as Service,
                        x: e.clientX,
                        y: e.clientY,
                        moved: false,
                      };
                      e.currentTarget.setPointerCapture?.(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                      const d = drag.current;
                      if (!d) return;
                      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8)
                        d.moved = true;
                      if (d.moved) {
                        setDragging(d.kind);
                        setHoverHost(
                          destinationAt(e.clientX, e.clientY)?.dataset
                            .deploymentHost || null,
                        );
                      }
                    }}
                    onPointerUp={(e) => {
                      const d = drag.current;
                      if (!d) return;
                      if (d.moved) {
                        const host = destinationAt(e.clientX, e.clientY),
                          placement = host?.dataset.placement;
                        if (placement === "cloud" || placement === "local")
                          place(d.kind, placement);
                        suppressClick.current = true;
                        setTimeout(() => {
                          suppressClick.current = false;
                        }, 0);
                      }
                      drag.current = null;
                      setDragging(null);
                      setHoverHost(null);
                    }}
                    onPointerCancel={() => {
                      drag.current = null;
                      setDragging(null);
                      setHoverHost(null);
                    }}
                  >
                    <span className="deployment-service-icon">
                      {icon(node.kind)}
                    </span>
                    <span className="deployment-service-name">
                      <strong>{node.name}</strong>
                      <small>{node.state}</small>
                    </span>
                    {movable && (
                      <GripVertical className="deployment-grip" size={13} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          {planning && (
            <footer className="deployment-actions">
              <div>
                <strong>
                  {dirty
                    ? "Unsaved changes"
                    : draft.revision
                      ? "Draft saved"
                      : "Suggested starting plan"}
                </strong>
                <span>
                  {dirty
                    ? "Save your changes before leaving."
                    : draft.updated_at
                      ? stamp(draft.updated_at)
                      : "Review the suggested locations and connections."}
                </span>
              </div>
              <button
                className="btn"
                disabled={
                  saving || (!dirty && !!draft.revision && !draft.stale)
                }
                onClick={() => void save()}
              >
                {saving ? "Saving…" : "Save draft"}
              </button>
              <button
                className="btn primary"
                disabled={saving}
                onClick={() => setReview(true)}
              >
                Review plan <ChevronRight size={15} />
              </button>
            </footer>
          )}
          {!planning && (
            <div className="deployment-existing-controls">
              <span>Existing service configuration</span>
              <button className="btn" onClick={() => setDetail("percepta")}>
                Percepta
              </button>
              <button className="btn" onClick={() => setDetail("controller")}>
                Inference
              </button>
            </div>
          )}
          {message && (
            <p className="deployment-feedback" role="status">
              <Check size={15} />
              {message}
            </p>
          )}
          {currentService === "percepta" && (
            <PerceptaSetup
              siteId={siteId}
              configurationOnly
              open
              hideTrigger
              onOpenChange={(open) => {
                if (!open) setEditing(null);
              }}
              onChange={() => {}}
            />
          )}
          {currentService && currentService !== "percepta" && (
            <Overlay
              title={"Configure " + names[currentService]}
              onClose={() => setEditing(null)}
            >
              <p>
                {names[currentService]} configuration for the deployment plan is
                not available yet.
              </p>
            </Overlay>
          )}
          {currentLink && (
            <ConnectionEditor
              key={currentLink.id}
              id={currentLink.id}
              draft={draft}
              map={map}
              onClose={() => setEditing(null)}
              onSave={(value) => {
                setDraft({
                  ...draft,
                  connections: {
                    ...draft.connections,
                    [currentLink.id]: value,
                  },
                });
                setMessage("");
                setEditing(null);
              }}
            />
          )}
          {editing && !currentService && !currentLink && (
            <Overlay
              title={
                names[editing] ||
                layout.nodes.find((n) => "actual:" + n.id === editing)?.name ||
                "Shared infrastructure"
              }
              onClose={() => setEditing(null)}
            >
              {editing.startsWith("actual:") ? (
                <>
                  <p>
                    {
                      layout.nodes.find((n) => "actual:" + n.id === editing)
                        ?.state
                    }
                  </p>
                  <p>
                    Observed runtime instance. To move it, edit and review the
                    deployment plan; dragging does not move an existing
                    container.
                  </p>
                  {(() => {
                    const node = layout.nodes.find(
                      (n) => "actual:" + n.id === editing,
                    );
                    return node?.component && node.kind !== "forecasting" ? (
                      <button
                        className="btn"
                        onClick={() => {
                          setEditing(null);
                          setDetail(node.kind as Service);
                        }}
                      >
                        Manage current service
                      </button>
                    ) : (
                      <p>
                        Shared platform context; health and placement have not
                        been inspected by this view.
                      </p>
                    );
                  })()}
                </>
              ) : (
                <>
                  <p>
                    {editing === "backend"
                      ? "The central platform manages communities, configuration, runtime and forecasting jobs. It is shared by the houses."
                      : "Central placement is a proposal. The deployment plan does not relocate or create shared infrastructure."}
                  </p>
                  <p>
                    Infrastructure credentials are managed securely outside this
                    draft. Final placement and access must be confirmed before
                    launch.
                  </p>
                </>
              )}
            </Overlay>
          )}
          {review && (
            <Overlay
              title="Review deployment"
              wide
              onClose={() => setReview(false)}
            >
              <div className="deployment-review-heading">
                <span>{siteName}</span>
                <small>
                  {dirty
                    ? "Unsaved changes"
                    : draft.revision
                      ? "Saved draft"
                      : "Suggested plan"}
                </small>
              </div>
              <div className="deployment-review-machines">
                {map.destinations
                  .filter(
                    (d) => d.placement === "cloud" || d.placement === "local",
                  )
                  .map((d) => {
                    const assigned = services.filter(
                      (kind) => draft.services[kind] === d.placement,
                    );
                    return (
                      <section
                        className="deployment-review-machine"
                        key={d.id}
                        aria-label={"Planned services on " + d.name}
                      >
                        <div className="deployment-review-machine-title">
                          {d.placement === "cloud" ? (
                            <Cloud size={23} />
                          ) : (
                            <Cpu size={23} />
                          )}
                          <div>
                            <small>
                              {d.placement === "cloud"
                                ? "CENTRAL SERVER"
                                : "HOUSE MACHINE"}
                            </small>
                            <h4>{d.name}</h4>
                          </div>
                        </div>
                        <div className="deployment-review-services">
                          {assigned.map((kind) => (
                            <button
                              key={kind}
                              onClick={() => {
                                setReview(false);
                                setEditing(kind);
                              }}
                              aria-label={"Configure " + names[kind]}
                            >
                              <span className="deployment-service-icon">
                                {icon(kind)}
                              </span>
                              <strong>{names[kind]}</strong>
                              <small>
                                {kind === "percepta"
                                  ? "Configure"
                                  : "Setup pending"}
                              </small>
                            </button>
                          ))}
                          {!assigned.length && <p>No services assigned</p>}
                        </div>
                        {d.placement === "cloud" && (
                          <div className="deployment-review-shared">
                            <span>{icon("broker")} Message broker</span>
                            <span>{icon("mongo")} MongoDB</span>
                            <small>Shared infrastructure · proposed</small>
                          </div>
                        )}
                      </section>
                    );
                  })}
              </div>
              <details className="deployment-review-details">
                <summary>
                  Connections{" "}
                  <span>
                    {Object.values(draft.connections).filter(
                      (c) => c?.mode === "manual",
                    ).length
                      ? "Custom settings"
                      : "Automatic settings"}
                  </span>
                </summary>
                {connections.map((c) => (
                  <div className="deployment-review-line" key={c.id}>
                    <span>Percepta → {names[c.target]}</span>
                    <small>
                      {draft.connections[c.id]?.mode === "manual"
                        ? `${draft.connections[c.id]?.host}${draft.connections[c.id]?.port ? ":" + draft.connections[c.id]?.port : ""}`
                        : "Automatic · to validate"}
                    </small>
                  </div>
                ))}
              </details>
              <details className="deployment-review-details">
                <summary>
                  Changes <span>Current → planned</span>
                </summary>
                {services.map((kind) => (
                  <div className="deployment-review-line" key={kind}>
                    <strong>{names[kind]}</strong>
                    <small>
                      {map.components
                        .filter((c) => c.kind === kind && !c.planned)
                        .map(
                          (c) =>
                            map.destinations.find(
                              (d) => d.id === c.destination_id,
                            )?.name || c.destination_id,
                        )
                        .join(", ") || "Not deployed"}{" "}
                      →{" "}
                      {map.destinations.find(
                        (d) => d.placement === draft.services[kind],
                      )?.name || "Destination unavailable"}
                    </small>
                  </div>
                ))}
              </details>
              <details className="deployment-review-availability">
                <summary>
                  Deployment not available yet <span>View requirements</span>
                </summary>
                <ul>
                  {draft.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </details>
              <div className="deployment-review-footer">
                <small>
                  Saving keeps this plan for later. Running services stay as
                  they are.
                </small>
                <div className="deployment-dialog-actions">
                  <button
                    className="btn"
                    disabled={saving}
                    onClick={() =>
                      void save().then((ok) => {
                        if (ok) setReview(false);
                      })
                    }
                  >
                    Save reviewed draft
                  </button>
                  <button
                    className="btn primary"
                    disabled
                    title="Final service contracts and bundle launcher are pending"
                  >
                    Deploy
                  </button>
                </div>
              </div>
            </Overlay>
          )}
        </>
      )}
    </section>
  );
}
function ConnectionEditor({
  id,
  draft,
  map,
  onSave,
  onClose,
}: {
  id: ConnectionId;
  draft: Draft;
  map: DeploymentMap;
  onSave: (value: Connection) => void;
  onClose: () => void;
}) {
  const link = connections.find((l) => l.id === id)!;
  const [value, setValue] = useState<Connection>(
    draft.connections[id] || { mode: "automatic" },
  );
  const samePlan =
    map.components.find((c) => c.kind === "percepta")
      ?.planned_destination_id ===
    map.destinations.find((d) => d.placement === draft.services.percepta)?.id;
  const existing = samePlan ? map.links.find((l) => l.id === id) : undefined;
  const sameHost =
    (id === "inference" || id === "forecasting") &&
    draft.services.percepta ===
      draft.services[id === "inference" ? "controller" : "forecasting"];
  return (
    <Overlay title={"Percepta → " + names[link.target]} onClose={onClose}>
      <p>{link.description}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(value);
        }}
      >
        <label className="deployment-field">
          Connection
          <select
            value={value.mode}
            onChange={(e) =>
              setValue(
                e.target.value === "automatic"
                  ? { mode: "automatic" }
                  : {
                      mode: "manual",
                      host: "",
                      port:
                        id === "broker"
                          ? 5672
                          : id === "mongo"
                            ? 27017
                            : undefined,
                    },
              )
            }
          >
            <option value="automatic">Automatic · suggested</option>
            <option value="manual">Custom address</option>
          </select>
        </label>
        {value.mode === "automatic" ? (
          <p className="deployment-hint">
            {existing?.endpoint
              ? `Configured starting address: ${existing.endpoint}:${existing.port}. Reachability and credentials are unverified.`
              : sameHost
                ? "Same machine: the final package should use the Docker service name and internal port. Address pending the service contract."
                : "Different destinations: a reachable application address is required. A management VPN connection alone does not confirm this route."}
          </p>
        ) : (
          <>
            <label className="deployment-field">
              Host or IP
              <input
                required
                maxLength={253}
                pattern="[a-zA-Z0-9_.:\-]+"
                placeholder="service.example or 10.0.0.5"
                value={value.host || ""}
                onChange={(e) => setValue({ ...value, host: e.target.value })}
              />
            </label>
            <label className="deployment-field">
              Port
              <input
                type="number"
                required
                min={1}
                max={65535}
                value={value.port || ""}
                onChange={(e) =>
                  setValue({
                    ...value,
                    port: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              />
            </label>
            <p className="deployment-hint">
              Address only. Do not enter a URL or credentials. This override is
              saved in the draft and is not applied to a service.
            </p>
          </>
        )}
        <div className="deployment-dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Update draft
          </button>
        </div>
      </form>
    </Overlay>
  );
}
