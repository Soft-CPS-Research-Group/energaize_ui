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
  const hosts: HostBox[] = destinations.map((destination) => ({
    destination,
    x: 0,
    y: 16,
    width: 0,
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
    if (!hosts.some((h) => h.destination.id === destination)) return;
    nodes.push({
      id,
      kind,
      name: names[kind] || kind,
      destination,
      state,
      component,
      x: 0,
      y: 0,
      width: 188,
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
  const source = planning
    ? nodes.find((n) => n.kind === "percepta")
    : undefined;
  const hasInternal =
    !!source &&
    nodes.some(
      (n) =>
        n.destination === source.destination &&
        connections.some((c) => c.target === n.kind),
    );
  const mixed = hosts.length > 1;
  const gap = planning ? (hasInternal ? 160 : 200) : 48;
  let nextX = 16;
  for (const host of hosts) {
    const members = nodes.filter((n) => n.destination === host.destination.id);
    const backend = members.find((n) => n.kind === "backend");
    const paired =
      !!source && source.destination === host.destination.id && hasInternal;
    host.width = paired ? (mixed ? 484 : 680) : 300;
    if (mixed && hasInternal && !paired) host.width = 250;
    host.x = nextX;
    nextX += host.width + gap;
    const nodeWidth = paired ? (mixed ? 164 : 188) : 188;
    const bodyTop = backend && members.length > 1 ? 222 : 132;
    const targets = members.filter(
      (n) => n !== backend && (!paired || n !== source),
    );
    const sourceOnLeft = !mixed || host.destination.placement !== "cloud";
    targets.forEach((node, i) => {
      node.width = nodeWidth;
      node.x = paired
        ? sourceOnLeft
          ? host.width - 20 - nodeWidth
          : 20
        : (host.width - nodeWidth) / 2;
      node.y = bodyTop + i * 94;
    });
    if (backend) {
      backend.x = (host.width - backend.width) / 2;
      backend.y = 132;
    }
    if (paired && source) {
      source.width = nodeWidth;
      source.x = sourceOnLeft ? 20 : host.width - 20 - nodeWidth;
      source.y = bodyTop + ((targets.length - 1) * 94) / 2;
    }
    host.height = Math.max(306, ...members.map((n) => n.y + n.height + 108));
    if (members.length === 1 && backend) host.height = 350;
  }
  const tallest = Math.max(0, ...hosts.map((h) => h.height));
  for (const host of hosts) host.y += (tallest - host.height) / 2;
  // A lone Percepta faces the middle of its remote dependencies, rather than
  // the middle of a server header and footer.
  if (source && mixed && !hasInternal) {
    const sourceHost = hosts.find(
      (h) => h.destination.id === source.destination,
    )!;
    const targets = nodes.filter((n) =>
      connections.some((c) => c.target === n.kind),
    );
    if (targets.length) {
      const centers = targets.map(
        (n) =>
          n.y +
          n.height / 2 +
          hosts.find((h) => h.destination.id === n.destination)!.y,
      );
      sourceHost.y = Math.max(
        16,
        (Math.min(...centers) + Math.max(...centers)) / 2 -
          source.y -
          source.height / 2,
      );
    }
  }
  for (const node of nodes) {
    const host = hosts.find((h) => h.destination.id === node.destination)!;
    node.x += host.x;
    node.y += host.y;
  }
  const edges: Edge[] = !source
    ? []
    : connections.flatMap<Edge>((link, i) => {
        const target = nodes.find((n) => n.kind === link.target);
        if (!target) return [];
        const sourceHost = hosts.find(
          (h) => h.destination.id === source.destination,
        )!;
        const targetHost = hosts.find(
          (h) => h.destination.id === target.destination,
        )!;
        const internal = source.destination === target.destination;
        const right = target.x > source.x;
        const sx = right ? source.x + source.width : source.x;
        const tx = right ? target.x : target.x + target.width;
        const sy = source.y + 15 + i * 12;
        const ty = target.y + target.height / 2;
        const lane = internal
          ? sx + (right ? 1 : -1) * (7 + i * 3)
          : (right ? sourceHost.x + sourceHost.width : sourceHost.x) +
            (right ? 1 : -1) * (12 + i * 5);
        const corridorCenter = right
          ? (sourceHost.x + sourceHost.width + targetHost.x) / 2
          : (targetHost.x + targetHost.width + sourceHost.x) / 2;
        return [
          {
            id: link.id,
            internal,
            path: `M ${sx} ${sy} H ${lane} V ${ty} H ${tx}`,
            x: internal ? (sx + tx) / 2 : corridorCenter,
            y: ty - 12,
          },
        ];
      });
  return {
    hosts,
    nodes,
    edges,
    width: nextX - gap + 16,
    height: Math.max(380, ...hosts.map((h) => h.height + h.y)) + 20,
  };
}
