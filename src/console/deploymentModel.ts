export type Service = "percepta" | "controller" | "forecasting";
export type Placement = "cloud" | "local";
export type ConnectionId = "inference" | "forecasting" | "broker" | "mongo";
export interface Check {
  state: string;
  checked_at?: string | null;
  architecture?: string | null;
  memory_bytes?: number | null;
  message?: string | null;
}
export interface Destination {
  id: string;
  name: string;
  placement: string;
  registered: boolean;
  selectable_inference_device?: boolean;
  check: Check;
}
export interface Component {
  id: string;
  name: string;
  kind: string;
  destination_id: string;
  planned_destination_id: string;
  state: string;
  health?: string | null;
  instance_id?: string | null;
  container_id?: string | null;
  managed?: boolean;
  image?: string | null;
  planned: boolean;
  supported: boolean;
  inference_model?: string | null;
}
export interface Link {
  id: string;
  source: string;
  target: string;
  label: string;
  endpoint?: string | null;
  port?: number | null;
  state: string;
  message: string;
}
export interface DeploymentMap {
  site_id: string;
  revision: string | null;
  destinations: Destination[];
  components: Component[];
  links: Link[];
  warnings: string[];
}
export interface Connection {
  mode: "automatic" | "manual";
  host?: string | null;
  port?: number | null;
}
export interface Draft {
  site_id: string;
  revision: string | null;
  base_revision: string | null;
  current_base_revision: string | null;
  updated_at: string | null;
  stale: boolean;
  services: Record<Service, Placement>;
  included_services?: Service[];
  connections: Partial<Record<ConnectionId, Connection>>;
  launch_available: boolean;
  percepta_host_id?: string | null;
  blockers: string[];
  inference_device?: "cpu" | "gpu" | null;
  inference_binding?: {
    model_id: string;
    instance_id: string;
    target_host_id: string;
    source_host_id: string;
  } | null;
}
export const services: Service[] = ["percepta", "controller", "forecasting"];
export const includedServices = (draft: Draft) =>
  draft.included_services ?? services;
export const names: Record<string, string> = {
  supervisor: "Fail-safe supervisor",
  percepta: "Percepta",
  controller: "Inference",
  forecasting: "Forecasting",
  backend: "Platform backends",
  broker: "RabbitMQ",
  community: "Community",
  telemetry: "Telemetry",
  access: "Access Control",
  flexibility: "Flexibility",
  training: "AI Training",
  runtime: "Runtime",
  mongo: "MongoDB",
};
export const sharedServices: Record<
  string,
  { role: string; description: string }
> = {
  access: {
    role: "Access control",
    description: "Access Control manages platform access and permissions.",
  },
  flexibility: {
    role: "Flexibility",
    description:
      "Flexibility manages flexibility policies and requests, including EV availability. Consumption and solar forecasts use the separate Forecasting service.",
  },
  training: {
    role: "AI Training",
    description: "AI Training manages algorithm preparation and training runs.",
  },
  community: {
    role: "House directory",
    description:
      "The Community API supplies the sites in the energy community to Forecasting so it can resolve the house’s site ID.",
  },
  telemetry: {
    role: "Energy history",
    description:
      "Telemetry reads the archived measurements and serves derived consumption and solar generation series through its HTTP API.",
  },
  runtime: {
    role: "Deployment",
    description:
      "Runtime registers machines, deploys and monitors containers, and applies or rolls back their configuration.",
  },
  broker: {
    role: "AMQP broker",
    description:
      "RabbitMQ routes published cycles to the archive consumer and house forecasts to Percepta through separate exchanges and queues.",
  },
  mongo: {
    role: "Cycle storage",
    description:
      "The house collection stores one document per cycle. Telemetry uses these records to build the historical series.",
  },
};
export const backendKinds = ["community", "telemetry", "runtime"];
export const stateName = (state: string) =>
  ({
    online: "Online at last check",
    unreachable: "Unreachable at last check",
    needs_setup: "Setup required",
    not_checked: "Not checked",
    not_registered: "Not registered",
    running: "Running",
    exited: "Stopped",
    not_deployed: "Not deployed",
    created: "Created",
    missing: "Container missing",
    simulation: "Simulation",
    unknown: "Unknown",
  })[state] || state.replaceAll("_", " ");
export const stamp = (s?: string | null) =>
  s
    ? new Date(s).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Never checked";
export interface GraphNode {
  id: string;
  kind: string;
  name: string;
  destination: string;
  state: string;
  component?: Component;
  instances?: Component[];
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface HostBox {
  destination: Destination;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Edge {
  id: string;
  source: string;
  target: string;
  label: string;
  channel: "http" | "amqp" | "storage";
  setting?: ConnectionId;
  twoWay?: boolean;
  path: string;
  x: number;
  y: number;
}
export function placements(
  map: DeploymentMap,
  draft: Draft,
): Record<Service, Placement> {
  const local = map.destinations.find((d) => d.placement === "local");
  const result: Record<Service, Placement> = {
    percepta: local ? "local" : "cloud",
    controller: local ? "local" : "cloud",
    forecasting: "cloud",
  };
  for (const kind of services) {
    const actual = map.components.find((c) => c.kind === kind && !c.planned);
    const location = map.destinations.find(
      (d) => d.id === actual?.destination_id,
    )?.placement;
    if (draft.revision && includedServices(draft).includes(kind))
      result[kind] = draft.services[kind];
    else if (location === "local" || location === "cloud")
      result[kind] = location;
    if (!local) result[kind] = "cloud";
  }
  return result;
}

export function graphLayout(
  map: DeploymentMap,
  draft: Draft,
  archiveOwner?: string | null,
) {
  const destinations = map.destinations;
  const cloud = destinations.find((d) => d.placement === "cloud");
  const ordered = [
    ...destinations.filter((d) => d !== cloud),
    ...(cloud ? [cloud] : []),
  ];
  let right = 8;
  const hosts: HostBox[] = ordered.map((destination) => {
    const width = destination === cloud ? 554 : 226;
    const host = { destination, x: right, y: 8, width, height: 168 };
    right += width + 24;
    return host;
  });
  const nodes: GraphNode[] = [];
  function add(
    kind: string,
    destination: string,
    state: string,
    component?: Component,
  ) {
    if (!hosts.some((h) => h.destination.id === destination)) return;
    nodes.push({
      id: component?.id ?? kind,
      kind,
      name: component?.name || names[kind] || kind,
      destination,
      state,
      component,
      x: 0,
      y: 0,
      width: 142,
      height: 52,
    });
  }
  const desired = placements(map, draft);
  for (const kind of services) {
    const host = destinations.find((d) => d.placement === desired[kind]);
    const instances = map.components.filter(
      (c) => c.kind === kind && !c.planned,
    );
    const current =
      instances.find((c) => c.id === draft.inference_binding?.instance_id) ||
      instances.find((c) => c.destination_id === host?.id) ||
      instances[0];
    if (host) {
      const state = current
        ? current.destination_id === host.id
          ? stateName(current.state)
          : "Move pending"
        : kind === "forecasting" && host === cloud
          ? "Shared predictor"
          : "Awaiting deployment";
      add(kind, host.id, state, current);
      nodes[nodes.length - 1].instances = instances;
      if (kind === "percepta") add("supervisor", host.id, "Not deployed");
    }
  }
  if (cloud) {
    for (const kind of [...backendKinds, "broker", "mongo"])
      add(kind, cloud.id, sharedServices[kind].role);
  }
  const backendHost = hosts.find((h) => h.destination === cloud);
  const columns: Record<string, number> = {
    supervisor: 442,
    controller: 116,
    percepta: 442,
    broker: 442,
    runtime: 266,
    forecasting: 116,
    community: 90,
    telemetry: 442,
    mongo: 442,
  };
  let nextY = 102;
  function row(kinds: string[], gap: number) {
    const members = nodes.filter((n) => kinds.includes(n.kind));
    if (!members.length) return;
    const counts = new Map<string, number>();
    for (const node of members) {
      const host = hosts.find((h) => h.destination.id === node.destination)!;
      const column =
        host === backendHost
          ? (columns[node.kind] ?? host.width / 2)
          : host.width / 2;
      const key = host.destination.id + "/" + column;
      const index = counts.get(key) ?? 0;
      counts.set(key, index + 1);
      node.x = host.x + column - node.width / 2;
      node.y = nextY + index * 66;
      host.height = Math.max(host.height, node.y + node.height + 36 - host.y);
    }
    nextY = Math.max(...members.map((n) => n.y + n.height)) + gap;
  }
  const sharedNarrowHost = nodes.some(
    (n) =>
      n.kind === "controller" &&
      n.destination !== cloud?.id &&
      nodes.some(
        (p) => p.kind === "percepta" && p.destination === n.destination,
      ),
  );
  if (sharedNarrowHost) {
    row(["supervisor"], 40);
    row(["controller"], 48);
    row(["percepta"], 78);
  } else {
    row(["supervisor"], 42);
    row(["percepta", "controller"], 78);
  }
  row(["forecasting", "broker"], 94);
  row(backendKinds, 84);
  row(["mongo"], 18);
  row(
    nodes.filter((n) => !(n.kind in columns)).map((n) => n.kind),
    18,
  );
  const api = nodes.find((n) => n.kind === "community");
  const group =
    api && backendHost
      ? {
          x: backendHost.x + 12,
          y: api.y - 12,
          width: backendHost.width - 24,
          height: api.height + 52,
          destination: backendHost.destination.id,
        }
      : undefined;

  const edges: Edge[] = [];
  // Multiple observed instances of one kind do not identify a unique route.
  const single = (kind: string) => {
    const matches = nodes.filter((n) => n.kind === kind);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const cx = (n: GraphNode) => n.x + n.width / 2;
  const cy = (n: GraphNode) => n.y + n.height / 2;
  function betweenRows(
    id: string,
    sourceKind: string,
    targetKind: string,
    label: string,
    channel: Edge["channel"],
    lane: number,
    startOffset = 0,
    endOffset = 0,
    setting?: ConnectionId,
    twoWay = false,
  ) {
    const source = single(sourceKind),
      target = single(targetKind);
    if (!source || !target) return;
    const down = source.y < target.y;
    const sx = cx(source) + startOffset,
      tx = cx(target) + endOffset;
    const sy = down ? source.y + source.height : source.y,
      ty = down ? target.y : target.y + target.height;
    const y = Math.min(sy, ty) + Math.abs(sy - ty) * lane;
    edges.push({
      id,
      source: source.id,
      target: target.id,
      channel,
      label,
      setting,
      twoWay,
      path: "M " + sx + " " + sy + " V " + y + " H " + tx + " V " + ty,
      x: (sx + tx) / 2,
      y,
    });
  }
  function acrossRow(
    id: string,
    source: GraphNode,
    target: GraphNode,
    label: string,
    channel: Edge["channel"],
    setting?: ConnectionId,
    twoWay = false,
  ) {
    const rightward = target.x > source.x;
    const sx = rightward ? source.x + source.width : source.x;
    const tx = rightward ? target.x : target.x + target.width;
    edges.push({
      id,
      source: source.id,
      target: target.id,
      label,
      channel,
      setting,
      twoWay,
      path: `M ${sx} ${cy(source)} H ${tx}`,
      x: (sx + tx) / 2,
      y: cy(source) - 12,
    });
  }
  {
    const percepta = single("percepta"),
      controller = single("controller");
    if (percepta && controller && percepta.y === controller.y) {
      acrossRow(
        "decision",
        percepta,
        controller,
        "HTTP · cycle / decision",
        "http",
        "inference",
        true,
      );
    } else
      betweenRows(
        "decision",
        "percepta",
        "controller",
        "HTTP · cycle / decision",
        "http",
        0.5,
        0,
        0,
        "inference",
        true,
      );
  }
  betweenRows(
    "cycles",
    "percepta",
    "broker",
    "AMQP · cycles",
    "amqp",
    0.28,
    32,
    32,
    "broker",
  );
  {
    betweenRows(
      "delivery",
      "broker",
      "percepta",
      "AMQP · forecasts",
      "amqp",
      0.74,
      -32,
      -32,
      "forecasting",
    );
  }
  const predictor = single("forecasting"),
    broker = single("broker");
  if (predictor && broker) {
    acrossRow("publish", predictor, broker, "AMQP · forecasts", "amqp");
  }
  betweenRows(
    "sites",
    "community",
    "forecasting",
    "HTTP · sites",
    "http",
    0.73,
    0,
    -26,
  );
  betweenRows(
    "history",
    "telemetry",
    "forecasting",
    "HTTP · energy history",
    "http",
    0.33,
    -34,
    26,
  );
  const writer = archiveOwner === "runtime" ? "runtime" : "telemetry";
  betweenRows(
    "archive",
    "broker",
    writer,
    "AMQP · archive queue",
    "amqp",
    0.55,
    16,
    16,
  );
  betweenRows(
    "write",
    writer,
    "mongo",
    "Write cycles",
    "storage",
    0.38,
    34,
    34,
  );
  betweenRows(
    "read",
    "mongo",
    "telemetry",
    "Read history",
    "storage",
    0.76,
    -34,
    -34,
  );
  const supervisor = single("supervisor"),
    collector = single("percepta");
  if (supervisor && collector) {
    if (sharedNarrowHost) {
      const x = collector.x - 18;
      edges.push({
        id: "safety",
        source: collector.id,
        target: supervisor.id,
        label: "Safety check",
        channel: "http",
        twoWay: true,
        path: `M ${collector.x} ${cy(collector)} H ${x} V ${cy(supervisor)} H ${supervisor.x}`,
        x: x + 18,
        y: supervisor.y + supervisor.height + 19,
      });
    } else
      betweenRows(
        "safety",
        "percepta",
        "supervisor",
        "Safety check",
        "http",
        0.5,
        0,
        0,
        undefined,
        true,
      );
  }
  return {
    hosts,
    nodes,
    edges,
    group,
    width: Math.max(0, right - 16),
    height: Math.max(190, ...hosts.map((h) => h.y + h.height + 8)),
  };
}
