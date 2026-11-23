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
}
export const services: Service[] = ["percepta", "controller", "forecasting"];
export const includedServices = (draft: Draft) => draft.included_services ?? services;
export const names: Record<string, string> = {
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
export const connections: {
  id: ConnectionId;
  title: string;
  description: string;
}[] = [
  { id: "inference", title: "Percepta ↔ Inference",
    description: "Percepta sends the cycle to Inference over HTTP and receives the decision in the response." },
  { id: "broker", title: "Percepta → RabbitMQ",
    description: "Percepta publishes cycles to its output exchange over AMQP. Runtime consumes the archive queue." },
  { id: "forecasting", title: "RabbitMQ → Percepta",
    description: "Forecasting publishes forecasts to the house exchange over AMQP. Percepta subscribes to the house queue. Configure the subscription in House data." },
  { id: "mongo", title: "Percepta storage address",
    description: "The collector’s published cycles are archived by Runtime. This draft address belongs to Percepta’s storage settings. Native inference configurations can also store decision records directly." },
];
export const sharedServices: Record<string, { role: string; description: string }> = {
  access: { role: "Access control", description: "Access Control manages platform access and permissions." },
  flexibility: { role: "Flexibility", description: "Flexibility manages flexibility policies and requests, including EV availability. Consumption and solar forecasts use the separate Forecasting service." },
  training: { role: "AI Training", description: "AI Training manages algorithm preparation and training runs." },
  community: { role: "House directory", description: "The Community API supplies the sites in the energy community to Forecasting so it can resolve the house’s site ID." },
  telemetry: { role: "Energy history", description: "Telemetry reads the archived measurements and serves derived consumption and solar generation series through its HTTP API." },
  runtime: { role: "Cycle archive", description: "Runtime consumes Percepta cycles from the RabbitMQ archive queue and writes them to the house collection in MongoDB." },
  broker: { role: "AMQP broker", description: "RabbitMQ routes published cycles to Runtime and house forecasts to Percepta through separate exchanges and queues." },
  mongo: { role: "Cycle storage", description: "Runtime writes the house’s archived cycles here. Telemetry reads these records to build the historical series." },
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
export interface ForecastContext {
  site_id: string;
  return_available?: boolean;
  lanes: { forecast_channel_configured: boolean }[];
}

export function graphLayout(map: DeploymentMap, draft: Draft, planning: boolean, forecast?: ForecastContext) {
  // Keep house machines to the left of the platform. Rows follow the data paths,
  // so moving a service changes the end of its wires without reordering the diagram.
  const destinations = map.destinations.filter(d => !planning || d.placement !== "other");
  const cloud = destinations.find(d => d.placement === "cloud");
  const ordered = [...destinations.filter(d => d !== cloud), ...(cloud ? [cloud] : [])];
  let right = 8;
  const hosts: HostBox[] = ordered.map(destination => {
    const width = destination === cloud ? 554 : 226;
    const host = { destination, x: right, y: 8, width, height: 168 };
    right += width + 24;
    return host;
  });
  const nodes: GraphNode[] = [];
  function add(kind: string, destination: string, state: string, component?: Component) {
    if (!hosts.some(h => h.destination.id === destination)) return;
    nodes.push({ id: component?.id ?? kind, kind, name: component?.name || names[kind] || kind,
      destination, state, component, x: 0, y: 0, width: 142, height: 52 });
  }
  if (planning) {
    for (const kind of includedServices(draft)) {
      const host = destinations.find(d => d.placement === draft.services[kind]);
      if (host) add(kind, host.id, "Draft · not applied");
    }
  } else {
    for (const c of map.components.filter(c => !c.planned)) add(c.kind, c.destination_id, stateName(c.state), c);
  }
  const houseForecast = forecast?.site_id === map.site_id ? forecast : undefined;
  if (cloud) {
    if (!planning && houseForecast?.return_available && !nodes.some(n => n.kind === "forecasting")) {
      add("forecasting", cloud.id, "Shared cloud service");
    }
    for (const kind of [...backendKinds, "broker", "mongo"]) add(kind, cloud.id, sharedServices[kind].role);
  }
  const backendHost = hosts.find(h => h.destination === cloud);
  const columns: Record<string, number> = {
    controller: 116, percepta: 442, broker: 442, runtime: 442,
    forecasting: 116, community: 90, telemetry: 266, mongo: 354,
  };
  let nextY = 102;
  function row(kinds: string[], gap: number) {
    const members = nodes.filter(n => kinds.includes(n.kind));
    if (!members.length) return;
    const counts = new Map<string, number>();
    for (const node of members) {
      const host = hosts.find(h => h.destination.id === node.destination)!;
      const column = host === backendHost ? columns[node.kind] ?? host.width / 2 : host.width / 2;
      const key = host.destination.id + "/" + column;
      const index = counts.get(key) ?? 0;
      counts.set(key, index + 1);
      node.x = host.x + column - node.width / 2;
      node.y = nextY + index * 66;
      host.height = Math.max(host.height, node.y + node.height + 36 - host.y);
    }
    nextY = Math.max(...members.map(n => n.y + n.height)) + gap;
  }
  const sharedNarrowHost = nodes.some(n => n.kind === "controller" && n.destination !== cloud?.id &&
    nodes.some(p => p.kind === "percepta" && p.destination === n.destination));
  if (sharedNarrowHost) {
    row(["controller"], 52);
    row(["percepta"], 78);
  } else {
    row(["percepta", "controller"], 78);
  }
  row(["forecasting", "broker"], 94);
  row(backendKinds, 84);
  row(["mongo"], 18);
  row(nodes.filter(n => !(n.kind in columns)).map(n => n.kind), 18);
  const api = nodes.find(n => n.kind === "community");
  const group = api && backendHost ? {
    x: backendHost.x + 12, y: api.y - 12, width: backendHost.width - 24, height: api.height + 52,
    destination: backendHost.destination.id,
  } : undefined;

  const edges: Edge[] = [];
  // Multiple observed instances of one kind do not identify a unique route.
  const single = (kind: string) => {
    const matches = nodes.filter(n => n.kind === kind);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const cx = (n: GraphNode) => n.x + n.width / 2;
  const cy = (n: GraphNode) => n.y + n.height / 2;
  function betweenRows(id: string, sourceKind: string, targetKind: string, label: string,
    channel: Edge["channel"], lane: number, startOffset = 0, endOffset = 0, setting?: ConnectionId, twoWay = false) {
    const source = single(sourceKind), target = single(targetKind);
    if (!source || !target) return;
    const down = source.y < target.y;
    const sx = cx(source) + startOffset, tx = cx(target) + endOffset;
    const sy = down ? source.y + source.height : source.y, ty = down ? target.y : target.y + target.height;
    const y = Math.min(sy, ty) + Math.abs(sy - ty) * lane;
    edges.push({ id, source: source.id, target: target.id, channel, label, setting, twoWay,
      path: 'M ' + sx + ' ' + sy + ' V ' + y + ' H ' + tx + ' V ' + ty, x: (sx + tx) / 2, y });
  }
  function acrossRow(id: string, source: GraphNode, target: GraphNode, label: string, channel: Edge["channel"],
    setting?: ConnectionId, twoWay = false) {
    const rightward = target.x > source.x;
    const sx = rightward ? source.x + source.width : source.x;
    const tx = rightward ? target.x : target.x + target.width;
    edges.push({ id, source: source.id, target: target.id, label, channel, setting, twoWay,
      path: `M ${sx} ${cy(source)} H ${tx}`, x: (sx + tx) / 2, y: cy(source) - 12 });
  }
  if (planning || map.links.some(l => l.id === "inference" && l.state === "configured")) {
    const percepta = single("percepta"), controller = single("controller");
    if (percepta && controller && percepta.y === controller.y) {
      acrossRow("decision", percepta, controller, "HTTP · cycle / decision", "http", "inference", true);
    } else betweenRows("decision", "percepta", "controller", "HTTP · cycle / decision", "http", 0.5, 0, 0, "inference", true);
  }
  betweenRows("cycles", "percepta", "broker", "AMQP · cycles", "amqp", 0.28, 32, 32, "broker");
  if ((planning && single("forecasting")) || houseForecast?.lanes.some(lane => lane.forecast_channel_configured)) {
    betweenRows("delivery", "broker", "percepta", "AMQP · forecasts", "amqp", 0.74, -32, -32, "forecasting");
  }
  const predictor = single("forecasting"), broker = single("broker");
  if (predictor && broker) {
    acrossRow("publish", predictor, broker, "AMQP · forecasts", "amqp");
  }
  betweenRows("sites", "community", "forecasting", "HTTP · sites", "http", 0.73, 0, -26);
  betweenRows("history", "telemetry", "forecasting", "HTTP · energy history", "http", 0.33, 0, 26);
  betweenRows("archive", "broker", "runtime", "AMQP · archive queue", "amqp", 0.55);
  betweenRows("write", "runtime", "mongo", "Write cycles", "storage", 0.67, 0, 36);
  betweenRows("read", "mongo", "telemetry", "Read history", "storage", 0.67, -36);
  return { hosts, nodes, edges, group, width: Math.max(0, right - 16), height: Math.max(190, ...hosts.map(h => h.y + h.height + 8)) };
}
