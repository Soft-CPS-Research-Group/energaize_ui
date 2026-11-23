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
  evPredictor: "EV predictor",
  kpi: "KPI Manager",
};
export const sharedServices: Record<
  string,
  { role: string; description: string }
> = {
  access: {
    role: "Roles & permissions",
    description: "Access Control manages platform access and permissions.",
  },
  flexibility: {
    role: "EV policies & forecasts",
    description:
      "Flexibility manages flexibility policies and requests, including EV availability. Consumption and solar forecasts use the separate Forecasting service.",
  },
  training: {
    role: "Models & training runs",
    description: "AI Training manages algorithm preparation and training runs.",
  },
  community: {
    role: "House directory",
    description:
      "The Community API supplies the sites in the energy community to Forecasting so it can resolve the house’s site ID.",
  },
  telemetry: {
    role: "Cycle archive & history",
    description:
      "Telemetry consumes each house’s RabbitMQ archive queue, writes the cycles to MongoDB and serves derived consumption and solar generation series through its HTTP API.",
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
  evPredictor: {
    role: "Plug-in windows",
    description:
      "The EV predictor claims jobs from Flexibility and returns predicted usage windows for each charger.",
  },
  kpi: {
    role: "Community indicators",
    description:
      "AI Training requests indicators from the KPI provider for a mapped community and time range. This integration has no per-house activity signal.",
  },
  mongo: {
    role: "Cycle storage",
    description:
      "The house collection stores one document per cycle. Telemetry uses these records to build the historical series.",
  },
};
export const backendKinds = [
  "community",
  "telemetry",
  "runtime",
  "access",
  "flexibility",
  "training",
];
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
  availableWidth = 920,
) {
  const destinations = map.destinations;
  const cloud = destinations.find((d) => d.placement === "cloud");
  const ordered = [
    ...destinations.filter((d) => d !== cloud),
    ...(cloud ? [cloud] : []),
  ];
  const others = ordered.filter((d) => d !== cloud).length;
  const gap = 18,
    inset = 3;
  const localWidth = Math.max(
    225,
    Math.min(310, Math.floor(availableWidth * 0.23)),
  );
  const cloudWidth = Math.max(
    550,
    Math.floor(availableWidth - 2 * inset - others * (localWidth + gap)),
  );
  let right = inset;
  const hosts: HostBox[] = ordered.map((destination) => {
    const width = destination === cloud ? cloudWidth : localWidth;
    const host = { destination, x: right, y: 8, width, height: 168 };
    right += width + gap;
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
    for (const kind of [
      ...backendKinds,
      "broker",
      "mongo",
      "evPredictor",
      "kpi",
    ])
      add(kind, cloud.id, sharedServices[kind].role);
  }
  const backendHost = hosts.find((h) => h.destination === cloud);
  const columns: Record<string, number> = {
    controller: 1,
    forecasting: 1,
    community: 1,
    access: 1,
    percepta: 3,
    broker: 3,
    telemetry: 3,
    flexibility: 3,
    evPredictor: 3,
    supervisor: 5,
    mongo: 5,
    runtime: 5,
    training: 5,
    kpi: 5,
  };
  let nextY = 131;
  function row(kinds: string[], gap: number) {
    const members = nodes.filter((n) => kinds.includes(n.kind));
    if (!members.length) return;
    const counts = new Map<string, number>();
    for (const node of members) {
      const host = hosts.find((h) => h.destination.id === node.destination)!;
      const column =
        host === backendHost
          ? (host.width * columns[node.kind]) / 6
          : host.width / 2;
      const key = host.destination.id + "/" + column;
      const index = counts.get(key) ?? 0;
      counts.set(key, index + 1);
      node.width = Math.min(
        230,
        Math.floor(host.width / (host === backendHost ? 3 : 1)) - 32,
      );
      node.height = 60;
      node.x = host.x + column - node.width / 2;
      node.y = nextY + index * 66;
      host.height = Math.max(host.height, node.y + node.height + 36 - host.y);
    }
    nextY = Math.max(...members.map((n) => n.y + n.height)) + gap;
  }
  const collectorOnHouseMachine = nodes.some(
    (n) => n.kind === "percepta" && n.destination !== cloud?.id,
  );
  if (collectorOnHouseMachine) {
    row(["supervisor"], 36);
    row(["controller"], 46);
    row(["percepta"], 105);
  } else {
    row(["supervisor", "percepta", "controller"], 105);
  }
  row(["forecasting", "broker", "mongo"], 142);
  row(["community", "telemetry", "runtime"], 66);
  row(["access", "flexibility", "training"], 82);
  row(["evPredictor", "kpi"], 20);
  const api = nodes.find((n) => n.kind === "community");
  const training = nodes.find((n) => n.kind === "training");
  const group =
    api && training && backendHost
      ? {
          x: backendHost.x + 7,
          y: api.y - 35,
          width: backendHost.width - 14,
          height: training.y + training.height + 15 - (api.y - 35),
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
    const upperTrack =
      source.destination === target.destination &&
      Math.abs(target.x - source.x) < source.width + 195;
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
      path: upperTrack
        ? `M ${cx(source) + (rightward ? 20 : -20)} ${source.y} V ${source.y - 21} H ${cx(target) + (rightward ? -20 : 20)} V ${target.y}`
        : `M ${sx} ${cy(source)} H ${tx}`,
      x: (sx + tx) / 2,
      y: upperTrack ? source.y - 21 : cy(source) - 12,
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
      0.52,
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
    0.47,
    0,
    -26,
  );
  betweenRows(
    "history",
    "telemetry",
    "forecasting",
    "HTTP · energy history",
    "http",
    0.64,
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
    0.45,
    16,
    16,
  );
  betweenRows(
    "write",
    writer,
    "mongo",
    "Write cycles",
    "storage",
    0.22,
    34,
    34,
  );
  betweenRows(
    "read",
    "mongo",
    "telemetry",
    "Read history",
    "storage",
    0.73,
    -34,
    -34,
  );
  const supervisor = single("supervisor"),
    collector = single("percepta");
  if (supervisor && collector) {
    if (collectorOnHouseMachine) {
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
    } else if (collector.y === supervisor.y) {
      acrossRow(
        "safety",
        collector,
        supervisor,
        "Safety check",
        "http",
        undefined,
        true,
      );
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
  betweenRows(
    "flex-history",
    "telemetry",
    "flexibility",
    "Charger history",
    "http",
    0.5,
  );
  betweenRows(
    "ev-jobs",
    "flexibility",
    "evPredictor",
    "Jobs / forecasts",
    "http",
    0.52,
    0,
    0,
    undefined,
    true,
  );
  betweenRows(
    "training-runtime",
    "runtime",
    "training",
    "Deployments",
    "http",
    0.5,
  );
  betweenRows(
    "training-kpi",
    "kpi",
    "training",
    "Community KPIs",
    "http",
    0.48,
  );
  const access = single("access"),
    trainingNode = single("training");
  if (access && trainingNode) {
    const sx = cx(access),
      tx = cx(trainingNode) - 42,
      track = access.y + access.height + 31;
    edges.push({
      id: "permissions",
      source: access.id,
      target: trainingNode.id,
      label: "Permissions",
      channel: "http",
      path: `M ${sx} ${access.y + access.height} V ${track} H ${tx} V ${trainingNode.y + trainingNode.height}`,
      x: sx + (tx - sx) * 0.24,
      y: track,
    });
  }
  return {
    hosts,
    nodes,
    edges,
    group,
    width: Math.max(0, right - gap + inset),
    height: Math.max(190, ...hosts.map((h) => h.y + h.height + 8)),
  };
}
