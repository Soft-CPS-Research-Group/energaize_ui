import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  Building2,
  ChartNoAxesCombined,
  Cloud,
  Cpu,
  Database,
  GripVertical,
  BatteryCharging,
  Gauge,
  BrainCircuit,
  KeyRound,
  CalendarClock,
  Layers3,
  Network,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  X,
} from "lucide-react";
import { runtimeRequest } from "../api/runtimeApi";
import { PerceptaMessages } from "./PerceptaMessages";
import { HouseForecastPlan } from "./HouseForecastPlan";
import { PerceptaSetup, type PerceptaLaunchPlan } from "./PerceptaSetup";
import {
  backendKinds,
  graphLayout,
  names,
  placements,
  services,
  sharedServices,
  stamp,
  stateName,
  type DeploymentMap,
  type Draft,
  type GraphNode,
  type Placement,
  type Service,
} from "./deploymentModel";
import {
  CycleFlow,
  feed,
  readJson,
  receivedForecasts,
  recent,
  useObservation,
} from "./DeploymentFlow";
import {
  chargerForecasts,
  FlexibilityForecasts,
  type Charger,
} from "./DeploymentFlexibility";
import { applyCollector, bindModel } from "./deploymentActions";
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
const noChargers: Charger[] = [];
const icon = (kind: string) =>
  kind === "kpi" ? (
    <Gauge size={19} />
  ) : kind === "flexibility" ? (
    <CalendarClock size={19} />
  ) : kind === "evPredictor" ? (
    <BatteryCharging size={19} />
  ) : kind === "training" ? (
    <BrainCircuit size={19} />
  ) : kind === "access" ? (
    <KeyRound size={19} />
  ) : kind === "supervisor" ? (
    <ShieldCheck size={19} />
  ) : kind === "percepta" ? (
    <Radio size={19} />
  ) : kind === "controller" ? (
    <Cpu size={19} />
  ) : kind === "mongo" ? (
    <Database size={19} />
  ) : kind === "forecasting" ? (
    <ChartNoAxesCombined size={19} />
  ) : kind === "community" ? (
    <Building2 size={19} />
  ) : kind === "telemetry" ? (
    <Activity size={19} />
  ) : kind === "runtime" || kind === "backend" ? (
    <Server size={19} />
  ) : (
    <Network size={19} />
  );
type Props = {
  siteId: string;
  siteName: string;
  communityName?: string;
  chargers?: Charger[];
  navigate: (path: string) => void;
  onCollectionChange?: () => void;
};
type EnergyHistory = {
  site_id: string;
  source_status: string;
  points: { timestamp: string; value: number | null; quality?: string }[];
  unit?: string;
};
export function DeploymentWorkspace(props: Props) {
  return <SiteDeployment key={props.siteId} {...props} />;
}
function SiteDeployment({
  siteId,
  siteName,
  communityName,
  chargers = noChargers,
  navigate,
  onCollectionChange,
}: Props) {
  const base = "/api/runtime/sites/" + siteId;
  const [draft, setDraft] = useState<Draft>(),
    [map, setMap] = useState<DeploymentMap>();
  const [selected, select] = useState<string | null>(null),
    [launch, setLaunch] = useState<PerceptaLaunchPlan>();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [checking, setChecking] = useState("");
  const [model, setModel] = useState(""),
    [device, setDevice] = useState<"cpu" | "gpu">("cpu");
  const [dragging, setDragging] = useState<Service | null>(null),
    [hover, setHover] = useState("");
  const canvas = useRef<HTMLDivElement>(null),
    marker = useId().replaceAll(":", "");
  const live = useRef(true),
    lock = useRef(false),
    epoch = useRef(0);
  const drag = useRef<{
      kind: Service;
      x: number;
      y: number;
      moved: boolean;
    }>(),
    suppress = useRef(false);
  const reload = useCallback(async () => {
    const seq = ++epoch.current;
    const [m, d] = await Promise.all([
      runtimeRequest<DeploymentMap>(base + "/deployment-view"),
      runtimeRequest<Draft>(base + "/deployment-draft"),
    ]);
    if (m.site_id !== siteId || d.site_id !== siteId)
      throw Error("Unexpected deployment for this house.");
    if (live.current && seq === epoch.current) {
      setMap(m);
      setDraft(d);
    }
  }, [base, siteId]);
  useEffect(() => {
    live.current = true;
    const refresh = () => {
      if (!lock.current)
        void reload().catch((e) => {
          if (live.current) setError(e.message);
        });
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => {
      live.current = false;
      ++epoch.current;
      clearInterval(timer);
    };
  }, [reload]);
  const screenRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(920);
  useEffect(() => {
    const element = screenRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0)
        setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const flexView = [
    "flow:ev-jobs",
    "flow:flex-history",
    "flexibility",
    "evPredictor",
  ].includes(selected || "");
  const flex = useObservation(
    siteId + "/flex",
    useCallback((s) => chargerForecasts(chargers, s), [chargers]),
    flexView ? 5000 : 60000,
  );
  const archival = [
    "flow:archive",
    "flow:write",
    "flow:read",
    "mongo",
  ].includes(selected || "");
  const detailed = [
    "flow:decision",
    "flow:delivery",
    "flow:publish",
    "flow:cycles",
  ].includes(selected || "");
  const archive = useObservation(
    siteId + "/archive/" + archival,
    useCallback((s) => feed(siteId, true, !archival, s), [siteId, archival]),
    archival ? 5000 : 20000,
  );
  const output = useObservation(
    siteId + "/messages/" + detailed,
    useCallback((s) => feed(siteId, false, !detailed, s), [siteId, detailed]),
    detailed ? 5000 : 20000,
  );
  const history = useObservation(
    siteId + "/energy",
    useCallback(
      async (signal) => {
        const end = Date.now(),
          params = new URLSearchParams({
            from_ts: new Date(end - 3600000).toISOString(),
            until_ts: new Date(end).toISOString(),
            limit: "10",
          });
        const series = await readJson<EnergyHistory>(
          `/telemetry-api/api/measurements/sites/${siteId}/derived/non_shiftable_load/series?${params}`,
          signal,
        );
        if (series.site_id !== siteId)
          throw Error("Unexpected house in Telemetry response");
        return series;
      },
      [siteId],
    ),
    30000,
  );
  const layout =
    map && draft ? graphLayout(map, draft, archive?.value?.owner, width) : null;
  const assigned = map && draft ? placements(map, draft) : undefined;
  const local = map?.destinations.find((d) => d.placement === "local");
  const collector = map?.components.find(
    (c) => !c.planned && c.kind === "percepta",
  );
  const confirmedArchive = recent(
    archive?.value?.messages[0],
    archive?.value?.period_seconds,
  );
  const confirmedCycle = recent(
    output?.value?.messages[0],
    archive?.value?.period_seconds,
  );
  const activeForecast =
    confirmedCycle &&
    receivedForecasts(output?.value?.messages[0]).some((s) =>
      s.intervals.some((i) => Date.parse(String(i.period_end)) > Date.now()),
    );
  function activity(node: GraphNode) {
    if (
      node.component &&
      (node.destination !== node.component.destination_id ||
        node.component.state !== "running" ||
        node.component.health === "unhealthy")
    )
      return false;
    switch (node.kind) {
      case "percepta":
        return (
          !!node.component &&
          (confirmedCycle ||
            (confirmedArchive &&
              archive?.value?.instance_id === node.component.id))
        );
      case "controller":
        return (
          !!node.component &&
          confirmedCycle &&
          !!output?.value?.messages[0]?.inference_decision &&
          node.component.id === draft?.inference_binding?.instance_id
        );
      case "forecasting":
        return (
          activeForecast &&
          (node.component?.destination_id === node.destination ||
            (assigned?.forecasting === "cloud" && !node.component))
        );
      case "broker":
        return confirmedCycle || confirmedArchive;
      case "mongo":
        return confirmedArchive;
      case "telemetry":
        return (
          (confirmedArchive &&
            archive?.value?.messages[0]?.writer === "telemetry") ||
          (history?.value?.source_status === "linked" &&
            !!history?.value.points.length)
        );
      case "flexibility":
        return !!flex?.value?.some((c) => c.forecast);
      case "evPredictor":
        return !!flex?.value?.some(
          (c) =>
            c.forecast?.prediction?.usable &&
            Date.parse(c.forecast.prediction.valid_until) > Date.now(),
        );
      case "runtime":
        return !!map && !error;
      case "community":
        return !!communityName && !!map && !error;
      default:
        return false;
    }
  }
  const archiveActive =
    confirmedArchive &&
    archive?.value?.messages[0]?.writer ===
      (archive?.value?.owner || "telemetry");
  function activeEdge(id: string) {
    switch (id) {
      case "write":
      case "archive":
        return archiveActive;
      case "cycles":
        return confirmedCycle || confirmedArchive;
      case "read":
        return (
          history?.value?.source_status === "linked" &&
          !!history.value.points.length
        );
      case "decision":
        return (
          confirmedCycle && !!output?.value?.messages[0]?.inference_decision
        );
      case "ev-jobs":
        return !!flex?.value?.some((c) => c.forecast?.prediction?.usable);
      default:
        return false;
    }
  }
  async function persist(
    next: Record<Service, Placement>,
    gpu?: "cpu" | "gpu",
  ) {
    if (!draft || !map) throw Error("Reload deployment before making changes.");
    const inferenceDevice = map.destinations.find(
      (d) => d.placement === next.controller,
    )?.selectable_inference_device
      ? gpu || draft.inference_device || "cpu"
      : null;
    const saved = await runtimeRequest<Draft>(base + "/deployment-draft", {
      method: "PUT",
      body: JSON.stringify({
        services: next,
        included_services: services,
        connections: {},
        inference_device: inferenceDevice,
        expected_revision: draft.revision,
        base_revision: map.revision,
      }),
    });
    if (live.current) setDraft(saved);
    return saved;
  }
  async function run(label: string, work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    ++epoch.current;
    setError("");
    setBusy(label);
    try {
      await work();
    } catch (e) {
      if (live.current) setError((e as Error).message);
    } finally {
      try {
        if (live.current) await reload();
      } catch (e) {
        if (live.current) setError((e as Error).message);
      }
      lock.current = false;
      if (live.current) setBusy("");
    }
  }
  async function move(kind: Service, target: Placement) {
    if (!assigned || !draft || (target === "local" && !local?.registered))
      return;
    select(null);
    if (assigned[kind] === target) return;
    const models = map?.components.filter(
      (c) => !c.planned && c.inference_model,
    );
    const bound =
      draft.inference_binding?.model_id ||
      (models?.length === 1 ? models[0].inference_model : null);
    await run("Updating " + names[kind] + "…", async () => {
      let next = await persist({ ...assigned, [kind]: target });
      if (kind === "forecasting") return;
      if (bound) next = await bindModel(siteId, next, bound);
      if (collector && (kind === "percepta" || bound))
        await applyCollector(siteId, next, collector);
    });
  }
  async function check(id: string) {
    if (checking || busy) return;
    setChecking(id);
    setError("");
    const seq = ++epoch.current;
    try {
      const m = await runtimeRequest<DeploymentMap>(
        base + "/deployment-check?" + new URLSearchParams({ host_id: id }),
        { method: "POST", signal: AbortSignal.timeout(60000) },
      );
      if (live.current && seq === epoch.current && m.site_id === siteId)
        setMap(m);
    } catch (e) {
      if (live.current) setError((e as Error).message);
    } finally {
      if (live.current) setChecking("");
    }
  }
  function hostAt(x: number, y: number) {
    return [
      ...(canvas.current?.querySelectorAll<HTMLElement>(
        "[data-deployment-host]",
      ) || []),
    ].find((el) => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    })?.dataset.placement;
  }
  function moveHandlers(kind: Service) {
    return {
      title: "Drag to move. Click to configure. Shift+F10 to choose a machine.",
      "aria-keyshortcuts": "Shift+F10",
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        select("move:" + kind);
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
          e.preventDefault();
          select("move:" + kind);
        }
      },
      onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0 || busy) return;
        suppress.current = false;
        drag.current = { kind, x: e.clientX, y: e.clientY, moved: false };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      },
      onPointerMove: (e: React.PointerEvent) => {
        const d = drag.current;
        if (!d || d.kind !== kind) return;
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) d.moved = true;
        if (d.moved) {
          setDragging(kind);
          setHover(hostAt(e.clientX, e.clientY) || "");
        }
      },
      onPointerCancel: () => {
        drag.current = undefined;
        setDragging(null);
        setHover("");
      },
      onPointerUp: (e: React.PointerEvent) => {
        if (drag.current?.moved) {
          suppress.current = true;
          setTimeout(() => {
            suppress.current = false;
          }, 0);
          const target = hostAt(e.clientX, e.clientY);
          if (target === "cloud" || target === "local") void move(kind, target);
        }
        drag.current = undefined;
        setDragging(null);
        setHover("");
      },
    };
  }
  function open(kind: string) {
    if (suppress.current || busy || !map || !draft || !assigned) return;
    if (kind === "percepta") {
      const host = map.destinations.find(
        (d) => d.placement === assigned.percepta,
      );
      if (!host) return;
      const replacement =
        collector?.managed && collector.container_id && collector.instance_id
          ? {
              instanceId: collector.instance_id,
              containerId: collector.container_id,
              from:
                host.id !== collector.destination_id
                  ? map.destinations.find(
                      (d) => d.id === collector.destination_id,
                    )?.name
                  : undefined,
            }
          : undefined;
      setLaunch({
        hostId: host.id,
        revision: draft.revision || "",
        replace: replacement,
        resolveRevision: async () => {
          const result = await persist(assigned);
          if (!result.revision) throw Error("Deployment could not be saved.");
          return result.revision;
        },
      });
    }
    if (kind === "controller") {
      setModel(
        draft.inference_binding?.model_id ||
          map.components.find((c) => !c.planned && c.inference_model)
            ?.inference_model ||
          "",
      );
      setDevice(draft.inference_device || "cpu");
    }
    select(kind);
  }
  function nodeButton(n: GraphNode, x: number, y: number) {
    const movable = services.includes(n.kind as Service);
    const lit = activity(n);
    return (
      <button
        key={n.id}
        type="button"
        data-module={n.kind}
        data-active={lit}
        aria-label={n.name + " · " + n.state}
        className={
          "deployment-node" +
          (movable ? " movable" : "") +
          (dragging === n.kind ? " dragging" : "")
        }
        style={{
          left: n.x - x,
          top: n.y - y,
          width: n.width,
          height: n.height,
        }}
        disabled={!!busy}
        {...(movable ? moveHandlers(n.kind as Service) : {})}
        onClick={() => open(n.kind)}
      >
        <span className="deployment-service-icon">
          {icon(n.kind)}
          <i
            className={"deployment-signal" + (lit ? " active" : "")}
            aria-label={lit ? "Recent activity" : "No confirmed activity"}
          />
        </span>
        <span className="deployment-service-name">
          <strong>{n.name}</strong>
          <small>{n.state}</small>
        </span>
        {movable && <GripVertical className="deployment-grip" size={12} />}
      </button>
    );
  }
  const flow = layout?.edges.find((e) => "flow:" + e.id === selected);
  const compact = !!layout && layout.width > width + 2;
  function edgeName(e: NonNullable<typeof layout>["edges"][number]) {
    return (
      (layout?.nodes.find((n) => n.id === e.source)?.name || "") +
      (e.twoWay ? " ↔ " : " → ") +
      (layout?.nodes.find((n) => n.id === e.target)?.name || "")
    );
  }
  const selectedMove = services.find((s) => "move:" + s === selected);
  const selectedHost = map?.destinations.find(
    (d) => d.placement === assigned?.controller,
  );
  const close = () => {
    if (!busy) select(null);
  };
  return (
    <section
      ref={screenRef}
      className="deployment-workspace"
      aria-label="Deployment"
    >
      <header className="deployment-heading">
        <div>
          <span className="eyebrow">{siteName}</span>
          <h2>Deployment</h2>
        </div>
      </header>
      {error && (
        <div role="alert" className="notice">
          {error}{" "}
          <button
            className="btn text"
            onClick={() =>
              void reload()
                .then(() => setError(""))
                .catch((e) => setError(e.message))
            }
          >
            Reload
          </button>
        </div>
      )}
      {busy && <p role="status">{busy}</p>}
      {!layout || !map || !draft ? (
        <p role="status">Loading deployment…</p>
      ) : (
        <div className="deployment-scroll">
          <div
            ref={canvas}
            className="deployment-map"
            data-compact={compact}
            style={{ width: layout.width, height: layout.height }}
          >
            {layout.hosts.map((h) => (
              <section
                key={h.destination.id}
                aria-label={h.destination.name}
                data-deployment-host={h.destination.id}
                data-placement={h.destination.placement}
                className={
                  "deployment-host" +
                  (hover === h.destination.placement ? " is-drop-target" : "")
                }
                style={{
                  left: h.x,
                  top: h.y,
                  width: h.width,
                  height: h.height,
                }}
              >
                <header>
                  {h.destination.placement === "cloud" ? <Cloud /> : <Cpu />}
                  <div className="deployment-host-identity">
                    <span className="eyebrow">
                      {h.destination.placement === "cloud"
                        ? "CENTRAL SERVER"
                        : "HOUSE MACHINE"}
                    </span>
                    <h3>{h.destination.name}</h3>
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
                        : stateName(h.destination.check.state)}
                    </span>
                    <time
                      dateTime={h.destination.check.checked_at || undefined}
                    >
                      {stamp(h.destination.check.checked_at)}
                    </time>
                  </div>
                  <button
                    className="deployment-refresh"
                    title={"Refresh " + h.destination.name}
                    aria-label={"Refresh " + h.destination.name}
                    disabled={!!checking || !!busy || !h.destination.registered}
                    onClick={() => void check(h.destination.id)}
                  >
                    <RefreshCw
                      size={15}
                      className={
                        checking === h.destination.id
                          ? "deployment-spinning"
                          : ""
                      }
                    />
                  </button>
                </header>
                {layout.group?.destination === h.destination.id && (
                  <div
                    role="group"
                    aria-label="Platform backends"
                    className="deployment-backends"
                    style={{
                      left: layout.group.x - h.x,
                      top: layout.group.y - h.y,
                      width: layout.group.width,
                      height: layout.group.height,
                    }}
                  >
                    <div className="deployment-backends-footer">
                      <span className="deployment-backends-name">
                        <Layers3 size={14} />
                        Platform backends
                      </span>
                    </div>
                    {layout.nodes
                      .filter((n) => backendKinds.includes(n.kind))
                      .map((n) =>
                        nodeButton(n, layout.group!.x, layout.group!.y),
                      )}
                  </div>
                )}
                {layout.nodes
                  .filter(
                    (n) =>
                      n.destination === h.destination.id &&
                      !backendKinds.includes(n.kind),
                  )
                  .map((n) => nodeButton(n, h.x, h.y))}
              </section>
            ))}
            <svg
              className="deployment-wires"
              width={layout.width}
              height={layout.height}
              aria-hidden="true"
            >
              <defs>
                {["http", "amqp", "storage", "observed"].map((c) => (
                  <marker
                    key={c}
                    id={marker + c}
                    viewBox="0 0 8 8"
                    refX="7"
                    refY="4"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path
                      className={"deployment-wire " + c}
                      d="M 1 1 L 7 4 L 1 7"
                      fill="none"
                      strokeWidth="1.6"
                    />
                  </marker>
                ))}
              </defs>
              {layout.edges.map((e) => (
                <path
                  key={e.id}
                  className={
                    "deployment-wire " +
                    (activeEdge(e.id) ? "observed" : e.channel)
                  }
                  d={e.path}
                  fill="none"
                  strokeWidth="1.6"
                  strokeDasharray={e.id === "safety" ? "3 4" : undefined}
                  strokeLinejoin="round"
                  markerEnd={`url(#${marker}${activeEdge(e.id) ? "observed" : e.channel})`}
                  markerStart={
                    e.twoWay
                      ? `url(#${marker}${activeEdge(e.id) ? "observed" : e.channel})`
                      : undefined
                  }
                />
              ))}
            </svg>
            <div className="deployment-routes">
              {compact && <h3>Connections</h3>}
              {layout.edges.map((e) => (
                <button
                  type="button"
                  key={e.id}
                  title={
                    activeEdge(e.id)
                      ? "Recent evidence for this house"
                      : e.label
                  }
                  className={
                    "deployment-edge-label " +
                    (activeEdge(e.id) ? "observed" : e.channel)
                  }
                  style={{ left: e.x, top: e.y }}
                  onClick={() => open("flow:" + e.id)}
                  aria-label={edgeName(e) + " · " + e.label}
                >
                  {compact && <strong>{edgeName(e)}</strong>}
                  {e.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {selected === "percepta" && launch && (
        <PerceptaSetup
          siteId={siteId}
          hideTrigger
          open
          initialSetup
          nativeCollection
          launchPlan={launch}
          configurationOnly={!!collector && !collector.managed}
          navigate={navigate}
          onMessages={() => select("messages")}
          onOpenChange={(o) => {
            if (!o) close();
          }}
          onChange={() => onCollectionChange?.()}
          onLaunched={() => {
            close();
            void reload().catch((e) => setError(e.message));
          }}
        />
      )}
      {selected && selected !== "percepta" && (
        <Overlay
          title={
            flow
              ? (layout?.nodes.find((n) => n.id === flow.source)?.name || "") +
                (flow.twoWay ? " ↔ " : " → ") +
                (layout?.nodes.find((n) => n.id === flow.target)?.name || "")
              : selectedMove
                ? "Move " + names[selectedMove]
                : selected === "messages"
                  ? "Percepta messages"
                  : names[selected] || "Deployment"
          }
          onClose={close}
          wide={!!flow || selected === "messages" || selected === "mongo"}
        >
          {busy && <p role="status">{busy}</p>}
          {error && <p role="alert">{error}</p>}
          {selected === "messages" ? (
            <PerceptaMessages
              siteId={siteId}
              siteName={siteName}
              periodSeconds={archive?.value?.period_seconds}
              onBack={close}
            />
          ) : selectedMove ? (
            <label className="deployment-field">
              Machine
              <select
                value={assigned?.[selectedMove]}
                onChange={(e) =>
                  void move(selectedMove, e.target.value as Placement)
                }
              >
                {map?.destinations
                  .filter(
                    (h) => h.placement === "cloud" || h.placement === "local",
                  )
                  .map((h) => (
                    <option
                      value={h.placement}
                      key={h.id}
                      disabled={!h.registered}
                    >
                      {h.name}
                    </option>
                  ))}
              </select>
            </label>
          ) : selected === "forecasting" ? (
            <>
              {assigned?.forecasting === "local" &&
                !map?.components.some(
                  (c) =>
                    c.kind === "forecasting" &&
                    !c.planned &&
                    c.destination_id === local?.id,
                ) && (
                  <p role="status">
                    Local destination saved. The house Predictor has not
                    registered here yet.
                  </p>
                )}
              <HouseForecastPlan
                siteId={siteId}
                onPrepared={onCollectionChange}
              />
              <button className="btn" onClick={() => select("evPredictor")}>
                EV flexibility forecasts
              </button>{" "}
              <button className="btn" onClick={() => select("flow:delivery")}>
                Received forecasts
              </button>
            </>
          ) : selected === "controller" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (assigned)
                  void run("Deploying and connecting inference…", async () => {
                    const saved = await persist(assigned, device);
                    const bound = await bindModel(siteId, saved, model);
                    if (live.current) setDraft(bound);
                    if (collector)
                      await applyCollector(siteId, bound, collector);
                    if (live.current) select(null);
                  });
              }}
            >
              <p>
                {selectedHost?.name} ·{" "}
                {assigned?.percepta === assigned?.controller
                  ? "Private Docker network"
                  : "Private HTTPS route"}
              </p>
              <label className="deployment-field">
                Algorithm
                <input
                  required
                  maxLength={40}
                  pattern="[a-z][a-z0-9\-]{0,39}"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  list={marker + "models"}
                />
              </label>
              <datalist id={marker + "models"}>
                {map?.components
                  .filter((c) => c.inference_model)
                  .map((c) => (
                    <option key={c.id} value={c.inference_model!} />
                  ))}
              </datalist>
              {selectedHost?.selectable_inference_device && (
                <label className="deployment-field">
                  Execution
                  <select
                    value={device}
                    onChange={(e) => setDevice(e.target.value as "cpu" | "gpu")}
                  >
                    <option value="cpu">CPU</option>
                    <option value="gpu">GPU · TensorRT</option>
                  </select>
                </label>
              )}
              <button className="btn primary" disabled={!!busy || !model}>
                Deploy and connect
              </button>
            </form>
          ) : selected === "telemetry" ? (
            <>
              <p>{sharedServices.telemetry.description}</p>
              <dl className="cycle-fields">
                <div>
                  <dt>Last archived cycle</dt>
                  <dd>
                    {archive?.value?.messages[0]
                      ? stamp(archive.value.messages[0].timestamp)
                      : "No confirmed cycle"}
                  </dd>
                </div>
                <div>
                  <dt>Collection period</dt>
                  <dd>
                    {archive?.value?.period_seconds
                      ? archive.value.period_seconds + " seconds"
                      : "Unknown"}
                  </dd>
                </div>
              </dl>
              <button className="btn" onClick={() => select("flow:write")}>
                View archived cycles
              </button>
            </>
          ) : flexView ? (
            <>
              {flow?.id === "flex-history" && (
                <p>
                  Flexibility reads observed charger measurements over HTTP when
                  a prediction job requests its history.
                </p>
              )}
              <FlexibilityForecasts rows={flex?.value} />
            </>
          ) : flow?.id === "permissions" ? (
            <p>
              AI Training asks Access Control whether the current user may
              perform the requested operation in the community workspace.
            </p>
          ) : flow?.id === "training-runtime" ? (
            <p>
              AI Training reads registered instances, deployed models and
              bundles from Runtime to show which deployment serves each site.
            </p>
          ) : flow?.id === "training-kpi" ? (
            <p>{sharedServices.kpi.description}</p>
          ) : selected === "supervisor" || flow?.id === "safety" ? (
            <p>
              The fail-safe supervisor is planned to check proposed actions
              before dispatch. It has no deployed instance or recorded verdict
              for this house.
            </p>
          ) : selected === "community" || flow?.id === "sites" ? (
            <>
              <p>{sharedServices.community.description}</p>
              <dl>
                <dt>Community</dt>
                <dd>{communityName || "Unavailable"}</dd>
                <dt>Site</dt>
                <dd>{siteName}</dd>
              </dl>
            </>
          ) : flow?.id === "history" ? (
            <>
              <p>
                Base consumption series available to Forecasting from Telemetry
                in the past hour.
              </p>
              {history?.error ? (
                <p role="alert">{history?.error}</p>
              ) : !history?.value ? (
                <p>Loading…</p>
              ) : history?.value.points.length ? (
                <table>
                  <tbody>
                    {history?.value.points.map((p) => (
                      <tr key={p.timestamp}>
                        <td>{stamp(p.timestamp)}</td>
                        <td>
                          {p.value ?? "Missing"} {history?.value?.unit}
                        </td>
                        <td>{p.quality}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>No readings in this time window.</p>
              )}
            </>
          ) : selected === "mongo" || flow ? (
            <>
              {selected === "mongo" && (
                <p>{sharedServices.mongo.description}</p>
              )}
              <CycleFlow
                key={flow?.id || "write"}
                kind={flow?.id || "write"}
                periodSeconds={archive?.value?.period_seconds}
                measurementNames={output?.value?.measurement_names}
                batch={(archival ? archive : output)?.value}
                error={(archival ? archive : output)?.error}
              />
            </>
          ) : (
            <p>{sharedServices[selected]?.description}</p>
          )}
        </Overlay>
      )}
    </section>
  );
}
