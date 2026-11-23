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
import { PerceptaMessages } from "./PerceptaMessages";
import { EVChargingLoader } from "../components/ui/EVChargingLoader";
import { RuntimePanel } from "./RuntimePanel";
import { PerceptaSetup, type PerceptaLaunchPlan } from "./PerceptaSetup";
import {
  connections,
  graphLayout,
  includedServices,
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
  onCollectionChange,
}: {
  siteId: string;
  siteName: string;
  navigate: (path: string) => void;
  onCollectionChange?: () => void;
}) {
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [map, setMap] = useState<DeploymentMap | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [saved, setSaved] = useState<Draft | null>(null);
  const [view, setView] = useState<"plan" | "operation">("operation"),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false),
    [saving, setSaving] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [review, setReview] = useState(false),
    [detail, setDetail] = useState<Service | null>(null);
  const [forecastSetup, setForecastSetup] = useState(false);
  const [collectionSetup, setCollectionSetup] = useState(false);
  const [launchPlan, setLaunchPlan] = useState<PerceptaLaunchPlan | null>(null);
  const [dragging, setDragging] = useState<Service | null>(null),
    [hoverHost, setHoverHost] = useState<string | null>(null);
  const shelf = useRef<HTMLElement>(null);
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
    JSON.stringify([draft.services, draft.connections, [...includedServices(draft)].sort()]) !==
      JSON.stringify([saved.services, saved.connections, [...includedServices(saved)].sort()]);
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
    setMessagesOpen(false);
    setDraft(null);
    setSaved(null);
    setEditing(null);
    setDetail(null);
    setForecastSetup(false);
    setCollectionSetup(false);
    setLaunchPlan(null);
    setReview(false);
    setView("operation");
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
    if (!draft) return null;
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
            included_services: includedServices(draft),
            connections: draft.connections,
            base_revision: map?.revision ?? null,
            expected_revision: draft.revision,
          }),
        },
      );
      if (seq !== sequence.current) return null;
      setDraft(result);
      setSaved(result);
      setMessage("Draft saved. Running services have not changed.");
      return result;
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
      return null;
    } finally {
      if (seq === sequence.current) setSaving(false);
    }
  };
  const place = (kind: Service, placement: Placement) => {
    if (saving || (placement === "local" && !localDestination?.registered)) return;
    setDraft((d) =>
      d ? { ...d, included_services: [...new Set([...includedServices(d), kind])], services: { ...d.services, [kind]: placement } } : d,
    );
    setMessage("");
  };
  const unplace = (kind: Service) => {
    setDraft(d => d ? { ...d, included_services: includedServices(d).filter(service => service !== kind) } : d);
    setMessage("");
  };
  const moveHandlers = (kind: Service) => ({
    title: "Click to configure. Drag to move, or use Shift+F10 for destinations.",
    "aria-keyshortcuts": "Shift+F10",
    onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      if (!saving && !drag.current?.moved) setEditing("move:" + kind);
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        setEditing("move:" + kind);
      }
    },
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || saving) return;
      drag.current = { kind, x: event.clientX, y: event.clientY, moved: false };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
      const current = drag.current;
      if (!current) return;
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8) current.moved = true;
      if (current.moved) {
        setDragging(kind);
        const target = dropTarget(event.clientX, event.clientY)?.dataset;
        setHoverHost(target?.placement === "local" && !localDestination?.registered ? null : target?.deploymentHost || null);
      }
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (drag.current?.moved) {
        const placement = dropTarget(event.clientX, event.clientY)?.dataset.placement;
        if (placement === "cloud" || placement === "local") place(kind, placement);
        if (placement === "unassigned") unplace(kind);
        suppressClick.current = true;
        setTimeout(() => { suppressClick.current = false; }, 0);
      }
      endDrag();
    },
    onPointerCancel: endDrag,
  });
  function endDrag() {
    drag.current = null;
    setDragging(null);
    setHoverHost(null);
  }
  function dropTarget(x: number, y: number) {
    const targets = [...(canvas.current?.querySelectorAll<HTMLElement>("[data-deployment-host]") || [])];
    if (shelf.current) targets.push(shelf.current);
    return targets.find(el => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
  }
  const activePercepta = map?.components.find(c => c.kind === "percepta" && !c.planned);
  const hasRuntimePercepta = !!activePercepta;
  const hasRuntime = !!map?.components.some(c => !c.planned);
  const selected = draft ? includedServices(draft) : [];
  const localDestination = map?.destinations.find(d => d.placement === "local");
  const plannedPercepta = map?.destinations.find(d => d.placement === draft?.services.percepta);
  const replace = activePercepta?.managed && activePercepta.instance_id && activePercepta.container_id
    && ["running", "exited", "created"].includes(activePercepta.state)
    ? {
      instanceId: activePercepta.instance_id,
      containerId: activePercepta.container_id,
      from: activePercepta.destination_id !== plannedPercepta?.id
        ? map?.destinations.find(d => d.id === activePercepta.destination_id)?.name || activePercepta.destination_id
        : undefined,
    } : undefined;
  const canOpenPlannedPercepta = !!plannedPercepta?.registered && (!activePercepta || !!replace) &&
    (dirty || draft?.percepta_host_id === undefined || draft.percepta_host_id === plannedPercepta.id);
  const perceptaOnly = selected.length === 1 && selected[0] === "percepta";
  const setupLabel = replace?.from ? "Move Percepta" : "Set up Percepta";
  const openPlannedPercepta = async () => {
    if (!draft || !plannedPercepta || !canOpenPlannedPercepta) return;
    const reviewed = dirty || !draft.revision || draft.stale ? await save() : draft;
    if (!reviewed?.revision) return;
    if (reviewed.percepta_host_id !== undefined && reviewed.percepta_host_id !== plannedPercepta.id) {
      setError("The reviewed plan needs a destination with an approved Percepta collection image.");
      setReview(false);
      setEditing(null);
      return;
    }
    setReview(false);
    setEditing(null);
    setLaunchPlan({ hostId: plannedPercepta.id, revision: reviewed.revision, replace });
  };
  const openForecastSettings = () => {
    setEditing(null);
    setReview(false);
    setForecastSetup(true);
  };
  const configureService = (kind: Service) => {
    setReview(false);
    if (kind === "forecasting") openForecastSettings();
    else if (kind === "percepta") {
      setEditing(null);
      setCollectionSetup(true);
    } else setDetail("controller");
  };
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
        <RuntimePanel
          siteId={siteId}
          siteName={siteName}
          kind={detail}
          startPerceptaSetup={detail === "percepta" && !hasRuntimePercepta}
          navigate={navigate}
          onCollectionChange={onCollectionChange}
        />
      </section>
    );
  if (messagesOpen) return <PerceptaMessages key={siteId} siteId={siteId} siteName={siteName} onBack={() => setMessagesOpen(false)} />;
  const planning = view === "plan",
    layout = map && draft ? graphLayout(map, draft, planning) : null;
  const movingService = services.find(kind => editing === "move:" + kind);
  const placement = draft && movingService && selected.includes(movingService) ? draft.services[movingService] : "";
  const currentLink = editing?.startsWith("link:")
    ? connections.find((l) => l.id === editing.slice(5))
    : null;
  return (
    <section className="deployment-workspace" aria-label="Deployment">
      <PerceptaSetup
        siteId={siteId}
        hideTrigger
        open={forecastSetup}
        onOpenChange={setForecastSetup}
        startOnHouseData
        configurationOnly
        onChange={() => onCollectionChange?.()}
      />
      {collectionSetup && <PerceptaSetup siteId={siteId} navigate={navigate} hideTrigger open configurationOnly nativeCollection onOpenChange={setCollectionSetup} onChange={() => onCollectionChange?.()} />}
      {launchPlan && (
        <PerceptaSetup
          siteId={siteId}
          navigate={navigate}
          hideTrigger
          open
          initialSetup
          launchPlan={launchPlan}
          onOpenChange={(open) => { if (!open) setLaunchPlan(null); }}
          onLaunched={() => { setMessage(""); setView("operation"); void load(); }}
          onChange={() => onCollectionChange?.()}
        />
      )}
      <header className="deployment-heading">
        <div>
          <span className="eyebrow">{siteName}</span>
          <h2>Deployment</h2>
        </div>
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
            <div>
              <h3>{planning ? "Configure deployment" : "Live services"}</h3>
              {planning && <small>Drag a service onto a machine. Click the service to configure it.</small>}
            </div>
            <button className="btn" onClick={() => setView(planning ? "operation" : "plan")}>
              {planning ? "Back to live services" : map.components.some(component => !component.planned) ? "Edit deployment setup" : "Set up deployment"}
            </button>
          </div>
          {draft.stale && planning && (
            <p className="notice">
              The house destinations changed since this draft was saved. Review
              the destinations below and save again.
            </p>
          )}
          {!planning && (
            <div className="deployment-operation-bar">
              <p>{hasRuntime ? 'Select a managed service to inspect it.' : 'No managed instances are listed for this house.'}</p>
              <div className="actions" role="group" aria-label="Operation tools">
                <button className="btn" onClick={() => setCollectionSetup(true)}>Configure Percepta</button>
                <button className="btn" onClick={() => setMessagesOpen(true)}><Radio size={15}/>Percepta messages</button>
                <button className="btn" disabled={checking} onClick={() => void check()}>
                  <RefreshCw size={15} className={checking ? "deployment-spinning" : ""} />
                  {checking ? "Checking machines…" : "Check machines"}
                </button>
              </div>
            </div>
          )}
          <div className={planning ? "deployment-planner" : undefined}>
          {planning && (
            <aside ref={shelf} data-deployment-host="unassigned" data-placement="unassigned"
              className={"deployment-shelf" + (hoverHost === "unassigned" ? " is-drop-target" : "")}
              aria-label="Available services">
              <h3>Unassigned services</h3>
              <p>Drag a service here to unassign it.</p>
              {services.filter(kind => !layout.nodes.some(node => node.kind === kind)).map(kind => (
                <button key={kind} className="deployment-shelf-service" disabled={saving}
                  {...moveHandlers(kind)}
                  onClick={() => {
                    if (suppressClick.current) return;
                    configureService(kind);
                  }}>
                  {icon(kind)}<span><strong>{names[kind]}</strong><small>{selected.includes(kind) ? "Destination unavailable" : "Unassigned"}</small></span><GripVertical size={15} />
                </button>
              ))}
            </aside>
          )}
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
                      {!planning && <small className="deployment-hardware">
                        {h.destination.check.architecture ||
                          "Architecture not checked"}
                        {h.destination.check.memory_bytes
                          ? ` · ${(h.destination.check.memory_bytes / 1024 ** 3).toFixed(1)} GiB`
                          : ""}
                      </small>}
                    </div>
                    {!planning && <div className="deployment-host-status">
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
                    </div>}
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
                  {edge.id!=="forecasting"&&draft.connections[edge.id]?.mode === "manual" && " · edited"}
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
                      if (!planning && node.kind === "percepta") {
                        if (node.component) setDetail("percepta");
                        return;
                      }
                      if (movable) configureService(node.kind as Service);
                      else setEditing(planning ? node.kind : "actual:" + node.id);
                    }}
                    {...(movable ? moveHandlers(node.kind as Service) : {})}
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
                className={perceptaOnly && canOpenPlannedPercepta ? "btn" : "btn primary"}
                disabled={saving}
                onClick={() => setReview(true)}
              >
                Review plan <ChevronRight size={15} />
              </button>
              {!review && perceptaOnly && canOpenPlannedPercepta && <button
                className="btn primary"
                disabled={saving}
                onClick={() => void openPlannedPercepta()}
              >
                {setupLabel} <ChevronRight size={15} />
              </button>}
            </footer>
          )}
          {message && (
            <p className="deployment-feedback" role="status">
              <Check size={15} />
              {message}
            </p>
          )}
          {!planning && !map.components.some(c => c.kind === "controller" && !c.planned) && <button className="btn text deployment-inference-link" onClick={() => setDetail("controller")}>Inference settings</button>}
          {movingService && (
            <Overlay
              title={"Move " + names[movingService]}
              onClose={() => setEditing(null)}
            >
              <label className="deployment-field">
                Destination
                <select value={placement} disabled={saving}
                  onChange={event => {
                    const placement = event.target.value;
                    if (placement === "cloud" || placement === "local") place(movingService, placement);
                    else unplace(movingService);
                  }}>
                  <option value="">Unassigned</option>
                  {placement && !map.destinations.some(d => d.placement === placement) &&
                    <option value={placement} disabled>Previous destination unavailable</option>}
                  {map.destinations.filter(d => d.placement === "cloud" || d.placement === "local").map(d =>
                    <option key={d.id} value={d.placement} disabled={!d.registered}>
                      {d.name}{!d.registered ? " · registration pending" : ""}
                    </option>
                  )}
                </select>
              </label>
              {movingService === "forecasting" && <>
                {placement === "local" && localDestination ? (
                  <p>{localDestination.registered
                    ? [stateName(localDestination.check.state), localDestination.check.architecture].filter(Boolean).join(" · ")
                    : "Machine registration pending"}. One CPU container runs on the house machine. It registers with the cloud and checks hourly for updated models. If it goes offline, publishing stays assigned to the house until it is returned to the cloud.</p>
                ) : placement === "cloud" ? (
                  <p>The shared cloud Predictor checks the community hourly for houses with recent consumption readings. It handles houses that have no registered local Predictor.</p>
                ) : null}
                {!localDestination && <p>A house destination becomes available when a machine is assigned in Inventory.</p>}
                <p>Forecasts start when usable readings and a trained model are available. Models are trained in the cloud. Saving the plan records the destination.</p>
                <div className="actions">
                  <button className="btn primary" onClick={() => { setEditing(null); setReview(true); }}>Review plan</button>
                  <button className="btn" onClick={openForecastSettings}>Open forecast settings</button>
                </div>
              </>}
            </Overlay>
          )}
          {currentLink?.id === "forecasting" && (
            <Overlay title="Predictor → Percepta" onClose={()=>setEditing(null)}>
              <p>{currentLink.description}</p>
              <button className="btn primary" onClick={openForecastSettings}>Open forecast settings</button>
            </Overlay>
          )}
          {currentLink && currentLink.id !== "forecasting" && (
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
          {editing && !movingService && !currentLink && (
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
                {!selected.length && <p className="deployment-review-empty">Assign a service to a machine to set it up.</p>}
                {map.destinations.map(destination => {
                  const assigned = selected.filter(kind => draft.services[kind] === destination.placement);
                  if (!assigned.length) return null;
                  return (
                    <section className="deployment-review-machine" key={destination.id}
                      aria-label={"Planned services on " + destination.name}>
                      <div className="deployment-review-machine-title">
                        {destination.placement === "cloud" ? <Cloud size={20} /> : <Cpu size={20} />}
                        <h4>{destination.name}</h4>
                      </div>
                      <div className="deployment-review-services">
                        {assigned.map(kind => (
                          <button key={kind} aria-label={"Configure " + names[kind]} onClick={() => configureService(kind)}>
                            {icon(kind)}<strong>{names[kind]}</strong>
                            <small>{map.components.some(c => c.kind === kind && !c.planned) ? "Instance exists" : kind === "forecasting" ? "Planned destination" : "Not deployed"}</small>
                            <ChevronRight size={14} />
                          </button>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
              <details className="deployment-review-details">
                <summary>
                  Connections{" "}
                  <span>
                    {connections.some(c => c.id !== "forecasting" && draft.connections[c.id]?.mode === "manual")
                      ? "Custom settings"
                      : "Automatic settings"}
                  </span>
                </summary>
                {connections.filter(c=>selected.includes("percepta")&&
                  (c.id!=="inference"||selected.includes("controller"))).map((c) => (
                  <div className="deployment-review-line" key={c.id}>
                    <span>{c.id==="forecasting"?"Predictor → Percepta":`Percepta → ${names[c.target]}`}</span>
                    {c.id==="forecasting"?<button className="btn text" onClick={openForecastSettings}>Open forecast settings</button>:<small>
                      {draft.connections[c.id]?.mode === "manual"
                        ? `${draft.connections[c.id]?.host}${draft.connections[c.id]?.port ? ":" + draft.connections[c.id]?.port : ""}`
                        : "Automatic · to validate"}
                    </small>}
                  </div>
                ))}
              </details>
              {draft.blockers.length>0&&(selected.length!==1||selected[0]!=="percepta"||draft.stale||!canOpenPlannedPercepta)&&<details className="deployment-review-availability">
                <summary>
                  Deployment requirements
                </summary>
                <ul>
                  {draft.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </details>}
              <div className="deployment-review-footer">
                <small>{selected.includes("percepta") && activePercepta && !replace
                  ? "Check the existing Percepta instance in Live services."
                  : selected.includes("percepta")
                    ? "Review the collection settings to start Percepta."
                    : "Save the selected services and destinations."}</small>
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
                  {selected.includes("percepta") && (!activePercepta || replace) &&
                    <button className="btn primary" disabled={saving || !canOpenPlannedPercepta} onClick={() => void openPlannedPercepta()}>
                      {setupLabel}
                    </button>}
                  {selected.includes("controller") && <button className="btn" onClick={()=>{setReview(false);setDetail("controller");}}>Open inference settings</button>}
                  {selected.includes("forecasting") && <button className="btn" onClick={openForecastSettings}>Open forecast settings</button>}
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
    id === "inference" && draft.services.percepta === draft.services.controller;
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
