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
  connections: Partial<Record<ConnectionId, Connection>>;
  launch_available: boolean;
  blockers: string[];
}
export const services: Service[] = ["percepta", "controller", "forecasting"];
export const names: Record<string, string> = {
  percepta: "Percepta",
  controller: "Inference",
  forecasting: "Forecasting",
  backend: "Platform backends",
  broker: "Message broker",
  mongo: "MongoDB",
};
export const connections: {
  id: ConnectionId;
  target: string;
  label: string;
  description: string;
  twoWay: boolean;
}[] = [
  {
    id: "inference",
    target: "controller",
    label: "HTTP ↔",
    description:
      "Percepta sends a prediction request; inference returns the result on the same HTTP connection. The final service address and configuration contract are pending.",
    twoWay: true,
  },
  {
    id: "forecasting",
    target: "forecasting",
    label: "Data · to confirm",
    description:
      "Proposed data exchange with Percepta. The current forecasting worker fetches jobs and history from the Flexibility backend and returns results there. A direct Percepta connection is not implemented.",
    twoWay: false,
  },
  {
    id: "broker",
    target: "broker",
    label: "AMQP · publish",
    description:
      "Percepta publishes messages. Broker location, subscriptions and access from the house must be confirmed before launch.",
    twoWay: false,
  },
  {
    id: "mongo",
    target: "mongo",
    label: "MongoDB · storage",
    description:
      "Percepta stores data in MongoDB. Central storage is proposed for now; credentials and reachability will be validated during launch preparation.",
    twoWay: false,
  },
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
  id: ConnectionId;
  path: string;
  x: number;
  y: number;
  internal: boolean;
}
export function graphLayout(
  map: DeploymentMap,
  draft: Draft,
  planning: boolean,
) {
  const destinations = map.destinations.filter((d) =>
    planning ? d.placement !== "other" : true,
  );
  const compact = destinations.length > 1;
  const width = compact ? 410 : 720;
  const gap = 64,
    padding = compact ? 18 : 24,
    nodeWidth = compact ? 148 : 164;
  const hosts: HostBox[] = destinations.map((destination, i) => ({
    destination,
    x: i * (width + gap) + 16,
    y: 16,
    width,
    height: 0,
  }));
  const nodes: GraphNode[] = [];
  const add = (
    id: string,
    kind: string,
    destination: string,
    state: string,
    component?: Component,
  ) => {
    const host = hosts.find((h) => h.destination.id === destination);
    if (!host) return;
    const left = kind === "percepta" || kind === "backend";
    const row =
      kind === "backend" || kind === "controller"
        ? 0
        : kind === "mongo"
          ? 3
          : kind === "broker"
            ? 2
            : 1;
    const duplicates = nodes.filter(
      (n) => n.destination === destination && n.kind === kind,
    ).length;
    nodes.push({
      id,
      kind,
      name: names[kind] || kind,
      destination,
      state,
      component,
      x: host.x + (left ? padding : width - padding - nodeWidth),
      y: host.y + 130 + row * 150 + duplicates * 82,
      width: nodeWidth,
      height: 66,
    });
  };
  const cloud = destinations.find((d) => d.placement === "cloud");
  if (cloud)
    add("backend", "backend", cloud.id, "Shared platform · not probed");
  if (planning) {
    for (const kind of services) {
      const host = destinations.find(
        (d) => d.placement === draft.services[kind],
      );
      if (host) add(kind, kind, host.id, "Draft · not applied");
    }
    if (cloud) {
      add("broker", "broker", cloud.id, "Central · proposed");
      add("mongo", "mongo", cloud.id, "Central · proposed");
    }
  } else {
    for (const c of map.components.filter((c) => !c.planned))
      add(c.id, c.kind, c.destination_id, stateName(c.state), c);
  }
  for (const host of hosts)
    host.height = Math.max(
      320,
      ...nodes
        .filter((n) => n.destination === host.destination.id)
        .map((n) => n.y - host.y + n.height + 100),
    );
  const source = nodes.find((n) => n.kind === "percepta");
  const edges: Edge[] =
    !planning || !source
      ? []
      : connections.flatMap<Edge>((link, i) => {
          const target = nodes.find((n) => n.kind === link.target);
          if (!target) return [];
          const sy = source.y + source.height / 2,
            ty = target.y + target.height / 2;
          const internal = source.destination === target.destination;
          const sx = source.x + source.width,
            tx = target.x;
          if (internal) {
            const lane = sx + ((tx - sx) * (i + 1)) / 5;
            return [
              {
                id: link.id,
                internal,
                path: `M ${sx} ${sy} H ${lane} V ${ty} H ${tx}`,
                x: tx - 9,
                y: ty - 13,
              },
            ];
          }
          const right = target.x > source.x;
          const start = right ? sx : source.x,
            slane = right ? sx + 18 : source.x - 12,
            tlane = tx - 16;
          const crossY = 232 + i * 18;
          return [
            {
              id: link.id,
              internal,
              path: `M ${start} ${sy} H ${slane} V ${crossY} H ${tlane} V ${ty} H ${tx}`,
              x: (slane + tlane) / 2,
              y: crossY - 8,
            },
          ];
        });
  return {
    hosts,
    nodes,
    edges,
    width: hosts.length * (width + gap) - gap + 32,
    height: Math.max(380, ...hosts.map((h) => h.height + h.y)) + 20,
  };
}
