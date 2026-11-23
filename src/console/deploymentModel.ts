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
  sensors: "Sensors & meters",
  actuators: "Actuators",
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
    role: "EV predictor & policies",
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
  "mongo",
];
export const supportingKinds = ["access", "training", "runtime"];
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
  step?: number;
  planned?: boolean;
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
    const host = { destination, x: right, y: 120, width, height: 168 };
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
    for (const kind of [...backendKinds, "broker"])
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
    mongo: 3,
    training: 3,
    supervisor: 5,
    flexibility: 5,
    runtime: 5,
  };
  const node = (kind: string) => nodes.find((n) => n.kind === kind);
  const hostOf = (n: GraphNode) =>
    hosts.find((h) => h.destination.id === n.destination)!;
  const centerX = (n: GraphNode) => n.x + n.width / 2;
  const centerY = (n: GraphNode) => n.y + n.height / 2;
  let nextY = 272;
  function row(kinds: string[], gap: number) {
    const members = nodes.filter((n) => kinds.includes(n.kind));
    if (!members.length) return;
    for (const n of members) {
      const h = hostOf(n),
        local = h !== backendHost,
        chip = supportingKinds.includes(n.kind);
      const column = local ? h.width / 2 : (h.width * columns[n.kind]) / 6;
      n.width = chip
        ? Math.min(124, h.width / 3 - 30)
        : Math.min(224, local ? h.width - 70 : Math.floor(h.width / 3) - 30);
      n.height = chip ? 30 : 58;
      n.x = h.x + column - n.width / 2;
      n.y = nextY;
      h.height = Math.max(h.height, n.y + n.height - h.y + 25);
    }
    nextY += Math.max(...members.map((n) => n.height)) + gap;
  }
  const collector = node("percepta");
  const localCollector = collector && hostOf(collector) !== backendHost;
  if (localCollector) {
    row(["controller"], 80);
    row(["percepta"], 90);
    row(["supervisor"], 60);
  } else row(["controller", "percepta", "supervisor"], 128);
  row(["forecasting", "broker"], 112);
  row(["community", "telemetry", "flexibility"], 86);
  row(["mongo"], 32);
  row(supportingKinds, 12);
  const community = node("community"),
    runtime = node("runtime");
  const group =
    community && runtime && backendHost
      ? {
          x: backendHost.x + 7,
          y: community.y - 32,
          width: backendHost.width - 14,
          height: runtime.y + runtime.height + 12 - (community.y - 32),
          destination: backendHost.destination.id,
        }
      : undefined;
  const width = Math.max(0, right - gap + inset);
  const terminals: GraphNode[] = [];
  if (collector) {
    const host = hostOf(collector);
    const terminalWidth = Math.min(176, (host.width - 32) / 2);
    for (const [kind, fraction, state] of [
      ["sensors", 0.25, "Provider readings"],
      ["actuators", 0.75, "Command destination"],
    ] as const) {
      terminals.push({
        id: kind,
        kind,
        name: names[kind],
        state,
        destination: "external",
        x: host.x + host.width * fraction - terminalWidth / 2,
        y: 27,
        width: terminalWidth,
        height: 50,
      });
    }
  }
  const edges: Edge[] = [];
  type Point = [number, number];
  function connect(
    id: string,
    source: GraphNode,
    target: GraphNode,
    label: string,
    channel: Edge["channel"],
    points: Point[],
    at: Point,
    step?: number,
    planned = false,
  ) {
    edges.push({
      id,
      source: source.id,
      target: target.id,
      label,
      channel,
      path: points
        .map(([x, y], i) => (i === 0 ? "M " : "L ") + x + " " + y)
        .join(" "),
      x: at[0],
      y: at[1],
      step,
      planned,
    });
  }
  function vertical(
    id: string,
    from: string,
    to: string,
    label: string,
    channel: Edge["channel"],
    lane: number,
    start = 0,
    end = 0,
    step?: number,
    planned = false,
  ) {
    const a = node(from),
      b = node(to);
    if (!a || !b) return;
    const down = a.y < b.y,
      sx = centerX(a) + start,
      tx = centerX(b) + end,
      sy = down ? a.y + a.height : a.y,
      ty = down ? b.y : b.y + b.height;
    const y = Math.min(sy, ty) + Math.abs(ty - sy) * lane;
    connect(
      id,
      a,
      b,
      label,
      channel,
      [
        [sx, sy],
        [sx, y],
        [tx, y],
        [tx, ty],
      ],
      [(sx + tx) / 2, y],
      step,
      planned,
    );
  }
  function parallelPorts(
    id: string,
    from: string,
    to: string,
    label: string,
    above: boolean,
    step?: number,
    planned = false,
  ) {
    const a = node(from),
      b = node(to);
    if (!a || !b) return;
    if (a.y !== b.y) {
      const offset = above ? -40 : 40;
      vertical(
        id,
        from,
        to,
        label,
        "http",
        above ? 0.3 : 0.71,
        offset,
        offset,
        step,
        planned,
      );
      return;
    }
    const sign = a.x < b.x ? 1 : -1,
      sx = centerX(a) + sign * a.width * 0.31,
      tx = centerX(b) - sign * b.width * 0.31;
    const anchor = a.y + (above ? 0 : a.height),
      y = anchor + (above ? -28 : 31);
    connect(
      id,
      a,
      b,
      label,
      "http",
      [
        [sx, anchor],
        [sx, y],
        [tx, y],
        [tx, anchor],
      ],
      [(sx + tx) / 2, y],
      step,
      planned,
    );
  }
  const [sensors, actuators] = terminals;
  if (collector && sensors && actuators) {
    const host = hostOf(collector);
    for (const input of [true, false]) {
      const terminal = input ? sensors : actuators;
      const sx = centerX(terminal),
        sy = terminal.y + terminal.height,
        railY = 96;
      const tx = localCollector
        ? input
          ? host.x + 12
          : host.x + host.width - 12
        : centerX(collector) + (input ? -17 : 17);
      const targetY = localCollector ? centerY(collector) : collector.y;
      const points: Point[] = [
        [sx, sy],
        [sx, railY],
        [tx, railY],
        [tx, targetY],
      ];
      if (localCollector)
        points.push([
          input ? collector.x : collector.x + collector.width,
          targetY,
        ]);
      connect(
        input ? "observations" : "dispatch",
        input ? terminal : collector,
        input ? collector : terminal,
        input ? "Readings" : "Command",
        "http",
        input ? points : points.reverse(),
        [(sx + tx) / 2, railY],
        input ? 1 : 6,
        !input,
      );
    }
  }
  parallelPorts("request", "percepta", "controller", "Cycle", true, 2);
  parallelPorts("decision", "controller", "percepta", "Proposal", false, 3);
  parallelPorts("safety", "percepta", "supervisor", "Review", true, 4, true);
  parallelPorts("verdict", "supervisor", "percepta", "Verdict", false, 5, true);
  const broker = node("broker"),
    forecast = node("forecasting");
  if (localCollector && collector && broker) {
    for (const outgoing of [true, false]) {
      const tx = centerX(broker) + (outgoing ? 28 : -28),
        sy = centerY(collector) + (outgoing ? 12 : -12);
      const lane =
          hostOf(collector).x + hostOf(collector).width + (outgoing ? 12 : 4),
        y = broker.y - (outgoing ? 37 : 74);
      const points: Point[] = [
        [collector.x + collector.width, sy],
        [lane, sy],
        [lane, y],
        [tx, y],
        [tx, broker.y],
      ];
      connect(
        outgoing ? "cycles" : "delivery",
        outgoing ? collector : broker,
        outgoing ? broker : collector,
        outgoing ? "AMQP · cycles" : "AMQP · forecasts",
        "amqp",
        outgoing ? points : points.reverse(),
        [(lane + tx) / 2, y],
        outgoing ? undefined : 1,
      );
    }
  } else {
    vertical(
      "cycles",
      "percepta",
      "broker",
      "AMQP · cycles",
      "amqp",
      0.4,
      27,
      27,
    );
    vertical(
      "delivery",
      "broker",
      "percepta",
      "AMQP · forecasts",
      "amqp",
      0.68,
      -27,
      -27,
      1,
    );
  }
  if (forecast && broker) {
    const sx = centerX(forecast) + forecast.width * 0.24,
      tx = centerX(broker) - broker.width * 0.32,
      track = forecast.y + forecast.height + 23;
    connect(
      "publish",
      forecast,
      broker,
      "Publish forecasts",
      "amqp",
      [
        [sx, forecast.y + forecast.height],
        [sx, track],
        [tx, track],
        [tx, broker.y + broker.height],
      ],
      [(sx + tx) / 2, track],
    );
  }
  vertical("sites", "community", "forecasting", "Sites", "http", 0.53, 0, -27);
  vertical(
    "history",
    "telemetry",
    "forecasting",
    "Energy history",
    "http",
    0.65,
    -36,
    15,
  );
  if (archiveOwner !== "runtime") {
    vertical(
      "archive",
      "broker",
      "telemetry",
      "Archive queue",
      "amqp",
      0.41,
      20,
      0,
    );
    vertical(
      "write",
      "telemetry",
      "mongo",
      "Write cycles",
      "storage",
      0.37,
      -32,
      -32,
    );
  }
  vertical(
    "read",
    "mongo",
    "telemetry",
    "Read history",
    "storage",
    0.73,
    32,
    32,
  );
  parallelPorts(
    "flex-history",
    "telemetry",
    "flexibility",
    "Charger history",
    false,
  );
  // Keep the numbered control path in reading order for keyboard and compact layouts.
  edges.sort((a, b) => (a.step ?? 99) - (b.step ?? 99));
  return {
    hosts,
    nodes,
    terminals,
    edges,
    group,
    width,
    height: Math.max(190, ...hosts.map((h) => h.y + h.height + 8)),
  };
}
