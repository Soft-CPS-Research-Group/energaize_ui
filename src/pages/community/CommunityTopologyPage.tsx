import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Battery,
  Building2,
  Car,
  CircleGauge,
  Edit3,
  Home,
  Link2,
  Network,
  PlugZap,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Sun,
  Trash2,
  Wand2
} from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../contexts/AuthContext";
import { useUI } from "../../contexts/UIContext";
import type { EnergyEntity, EnergyEntityKind, EnergyTreeNode } from "../../data/energyCommunity";
import { getEnergyEntity, getEnergyTree, getEntityKpis } from "../../data/energyCommunity";

type RoleContext = Parameters<typeof getEntityKpis>[1];
type Position = { x: number; y: number };
type TopologyEdgeTone = "production" | "storage" | "demand" | "grid";
type AddableKind = Extract<
  EnergyEntityKind,
  | "group"
  | "building"
  | "battery"
  | "ev"
  | "ev_charger"
  | "pv"
  | "solar_plant"
  | "grid_meter"
  | "appliance"
  | "heat_pump"
  | "heater"
  | "water_pump"
  | "micro_wind_turbine"
  | "non_shiftable_load"
  | "generic_device"
>;
type EntityOverrides = Record<string, Partial<Pick<EnergyEntity, "label" | "status" | "serial" | "capacity" | "description">>>;

interface GraphNode extends Position {
  id: string;
  entity: EnergyEntity;
  parentId: string | null;
  depth: number;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  tone: TopologyEdgeTone;
}

const ADDABLE_ITEMS: Array<{ kind: AddableKind; label: string }> = [
  { kind: "building", label: "Site / Building" },
  { kind: "group", label: "Community Site" },
  { kind: "battery", label: "Battery" },
  { kind: "ev_charger", label: "EV Charger" },
  { kind: "ev", label: "Electric Vehicle" },
  { kind: "pv", label: "PV System" },
  { kind: "solar_plant", label: "Solar Plant" },
  { kind: "grid_meter", label: "Grid Meter" },
  { kind: "appliance", label: "Appliance" },
  { kind: "heat_pump", label: "Heat Pump" },
  { kind: "heater", label: "Heater" },
  { kind: "water_pump", label: "Water Pump" },
  { kind: "micro_wind_turbine", label: "Micro Wind Turbine" },
  { kind: "non_shiftable_load", label: "Non-shiftable Load" },
  { kind: "generic_device", label: "Generic Device" }
];

function iconForKind(kind: EnergyEntityKind): JSX.Element {
  if (kind === "community") return <Network size={15} />;
  if (kind === "building" || kind === "apartment") return <Building2 size={15} />;
  if (kind === "house") return <Home size={15} />;
  if (kind === "battery") return <Battery size={14} />;
  if (kind === "ev_charger") return <PlugZap size={14} />;
  if (kind === "ev") return <Car size={14} />;
  if (kind === "pv" || kind === "solar_plant") return <Sun size={14} />;
  if (kind === "transformer" || kind === "grid_meter") return <PlugZap size={14} />;
  if (kind === "group") return <CircleGauge size={14} />;
  return <Network size={15} />;
}

function nodeClass(entity: EnergyEntity, selected: boolean, draggable: boolean, dragging: boolean): string {
  return [
    "energy-topology-node",
    `is-${entity.kind.replace("_", "-")}`,
    `is-${entity.status}`,
    selected ? "is-selected" : "",
    draggable ? "is-draggable" : "",
    dragging ? "is-dragging" : ""
  ].filter(Boolean).join(" ");
}

function edgeToneFor(entity: EnergyEntity): TopologyEdgeTone {
  if (entity.kind === "pv" || entity.kind === "solar_plant") return "production";
  if (entity.kind === "micro_wind_turbine") return "production";
  if (entity.kind === "battery") return "storage";
  if (entity.kind === "transformer" || entity.kind === "grid_meter" || entity.kind === "group") return "grid";
  return "demand";
}

function canHostChildren(entity: EnergyEntity): boolean {
  return ["community", "group", "building", "house", "apartment"].includes(entity.kind);
}

function itemLabel(kind: AddableKind): string {
  return ADDABLE_ITEMS.find((item) => item.kind === kind)?.label ?? "Element";
}

function defaultSerial(kind: AddableKind): string | undefined {
  if (kind === "ev") return "EVSE-new";
  if (kind === "ev_charger") return "EVSE-new";
  if (kind === "battery") return "BAT-new";
  if (kind === "grid_meter") return "GM-new";
  return undefined;
}

function defaultCapacity(kind: AddableKind): string | undefined {
  if (kind === "ev_charger") return "11 kW";
  if (kind === "ev") return "50 kWh";
  if (kind === "battery") return "12 kWh";
  if (kind === "pv") return "5 kWp";
  if (kind === "solar_plant") return "250 kWp";
  if (kind === "grid_meter") return "1.2 MW";
  if (kind === "micro_wind_turbine") return "3 kW";
  return undefined;
}

function cloneVisibleTree(node: EnergyTreeNode, hiddenIds: Set<string>, overrides: EntityOverrides): EnergyTreeNode | null {
  if (hiddenIds.has(node.id)) return null;
  return {
    ...node,
    ...overrides[node.id],
    children: node.children
      .map((child) => cloneVisibleTree(child, hiddenIds, overrides))
      .filter((child): child is EnergyTreeNode => Boolean(child))
  };
}

function buildEditableTree(
  baseTree: EnergyTreeNode[],
  localEntities: EnergyEntity[],
  hiddenIds: Set<string>,
  overrides: EntityOverrides
): EnergyTreeNode[] {
  const tree = baseTree
    .map((node) => cloneVisibleTree(node, hiddenIds, overrides))
    .filter((node): node is EnergyTreeNode => Boolean(node));
  const byId = new Map<string, EnergyTreeNode>();

  function indexNode(node: EnergyTreeNode): void {
    byId.set(node.id, node);
    node.children.forEach(indexNode);
  }

  tree.forEach(indexNode);

  localEntities.forEach((entity) => {
    if (hiddenIds.has(entity.id) || !entity.parentId) return;
    const parent = byId.get(entity.parentId);
    if (!parent) return;
    const node: EnergyTreeNode = { ...entity, ...overrides[entity.id], children: [] };
    parent.children.push(node);
    byId.set(node.id, node);
  });

  return tree;
}

function flattenTree(nodes: EnergyTreeNode[]): EnergyEntity[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

function findTreeNode(nodes: EnergyTreeNode[], entityId: string): EnergyTreeNode | null {
  for (const node of nodes) {
    if (node.id === entityId) return node;
    const child = findTreeNode(node.children, entityId);
    if (child) return child;
  }
  return null;
}

function collectNodeIds(node: EnergyTreeNode): string[] {
  return [node.id, ...node.children.flatMap(collectNodeIds)];
}

function buildGraphLayout(tree: EnergyTreeNode[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const root = tree[0];
  if (!root) return { nodes: [], edges: [] };

  let leafCursor = 0;
  let maxDepth = 0;
  const rawNodes: Array<GraphNode & { xUnit: number }> = [];

  function visit(node: EnergyTreeNode, depth: number, parentId: string | null): number {
    maxDepth = Math.max(maxDepth, depth);

    let xUnit: number;
    if (node.children.length === 0) {
      xUnit = leafCursor;
      leafCursor += 1;
    } else {
      const childPositions = node.children.map((child) => visit(child, depth + 1, node.id));
      xUnit = childPositions.reduce((sum, value) => sum + value, 0) / childPositions.length;
    }

    rawNodes.push({ id: node.id, entity: node, parentId, depth, x: 0, y: 0, xUnit });
    return xUnit;
  }

  visit(root, 0, null);

  const minX = Math.min(...rawNodes.map((node) => node.xUnit));
  const maxX = Math.max(...rawNodes.map((node) => node.xUnit));
  const nodes = rawNodes.map(({ xUnit, ...node }) => ({
    ...node,
    x: maxX === minX ? 50 : 8 + ((xUnit - minX) / (maxX - minX)) * 84,
    y: maxDepth === 0 ? 50 : 8 + (node.depth / maxDepth) * 78
  }));

  const edges = nodes
    .filter((node) => node.parentId)
    .map((node) => ({
      id: `${node.parentId}-${node.id}`,
      from: node.parentId as string,
      to: node.id,
      tone: edgeToneFor(node.entity)
    }));

  return { nodes, edges };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function TopologyGraphNode({
  node,
  role,
  selected,
  draggable,
  dragging,
  style,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp
}: {
  node: GraphNode;
  role: RoleContext;
  selected: boolean;
  draggable: boolean;
  dragging: boolean;
  style: CSSProperties;
  onSelect: (entityId: string) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, entityId: string) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>, entityId: string) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>, entityId: string) => void;
}): JSX.Element {
  const kpi = getEntityKpis(node.entity, role)[0];

  return (
    <button
      type="button"
      className={nodeClass(node.entity, selected, draggable, dragging)}
      style={style}
      onClick={() => onSelect(node.id)}
      onPointerDown={(event) => onPointerDown(event, node.id)}
      onPointerMove={(event) => onPointerMove(event, node.id)}
      onPointerUp={(event) => onPointerUp(event, node.id)}
      onPointerCancel={(event) => onPointerUp(event, node.id)}
    >
      <span className="topology-node-icon">{iconForKind(node.entity.kind)}</span>
      <span className="topology-node-copy">
        <strong>{node.entity.label}</strong>
        <small>{kpi.label}: {kpi.value}</small>
      </span>
      <i className={`topology-status is-${node.entity.status}`} aria-label={node.entity.status} />
    </button>
  );
}

export function CommunityTopologyPage(): JSX.Element {
  const { session } = useAuth();
  const { activeCommunity, selectedEntityId, setSelectedEntityId } = useUI();
  const canEdit = session?.role === "rec_manager";
  const baseTree = useMemo(() => getEnergyTree(activeCommunity, session?.role), [activeCommunity, session?.role]);
  const [localEntities, setLocalEntities] = useState<EnergyEntity[]>([]);
  const [hiddenEntityIds, setHiddenEntityIds] = useState<Set<string>>(() => new Set());
  const [entityOverrides, setEntityOverrides] = useState<EntityOverrides>({});
  const [extraEdges, setExtraEdges] = useState<GraphEdge[]>([]);
  const [positionOverrides, setPositionOverrides] = useState<Record<string, Position>>({});
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const [draftKind, setDraftKind] = useState<AddableKind>("building");
  const [draftLabel, setDraftLabel] = useState("");
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [dragging, setDragging] = useState<{ id: string; pointerId: number; moved: boolean } | null>(null);
  const [ignoreClickId, setIgnoreClickId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLocalEntities([]);
    setHiddenEntityIds(new Set());
    setEntityOverrides({});
    setExtraEdges([]);
    setPositionOverrides({});
    setInspectorId(null);
    setConnectFromId(null);
    setEditMode(false);
    setDraftLabel("");
  }, [activeCommunity.id, session?.role]);

  const topologyTree = useMemo(
    () => buildEditableTree(baseTree, localEntities, hiddenEntityIds, entityOverrides),
    [baseTree, entityOverrides, hiddenEntityIds, localEntities]
  );
  const entities = useMemo(() => flattenTree(topologyTree), [topologyTree]);
  const graph = useMemo(() => buildGraphLayout(topologyTree), [topologyTree]);
  const visibleById = useMemo(() => new Map(entities.map((entity) => [entity.id, entity])), [entities]);
  const root = topologyTree[0];
  const requestedEntityId = inspectorId || selectedEntityId;
  const baseSelected = getEnergyEntity(activeCommunity, session?.role, requestedEntityId);
  const selectedForInspector = visibleById.get(requestedEntityId) ?? visibleById.get(baseSelected.id) ?? root ?? baseSelected;
  const activeParent =
    canHostChildren(selectedForInspector)
      ? selectedForInspector
      : selectedForInspector.parentId
        ? visibleById.get(selectedForInspector.parentId) ?? root
        : root;
  const activeParentId = activeParent?.id ?? "";
  const positionedNodes = graph.nodes.map((node) => ({ ...node, ...(positionOverrides[node.id] ?? {}) }));
  const positionedById = new Map(positionedNodes.map((node) => [node.id, node]));
  const canRemoveSelected = canEdit && Boolean(root && selectedForInspector.id !== root.id);
  const visibleExtraEdges = extraEdges.filter((edge) => positionedById.has(edge.from) && positionedById.has(edge.to));
  const displayedEdges = [...graph.edges, ...visibleExtraEdges];
  const isEmptyBuilder = canEdit && positionedNodes.length <= 1;

  function selectNode(entityId: string): void {
    setInspectorId(entityId);
    setSelectedEntityId(entityId);
  }

  function handleNodeClick(entityId: string): void {
    if (ignoreClickId === entityId) {
      setIgnoreClickId(null);
      return;
    }
    if (connectFromId && canEdit) {
      if (connectFromId !== entityId) {
        const target = visibleById.get(entityId);
        const edgeId = `manual-${connectFromId}-${entityId}`;
        const sameConnection = (edge: GraphEdge) =>
          (edge.from === connectFromId && edge.to === entityId) || (edge.from === entityId && edge.to === connectFromId);
        if (!graph.edges.some(sameConnection)) {
          setExtraEdges((prev) =>
            prev.some((edge) => edge.id === edgeId || sameConnection(edge))
              ? prev
              : [...prev, { id: edgeId, from: connectFromId, to: entityId, tone: target ? edgeToneFor(target) : "grid" }]
          );
        }
      }
      setConnectFromId(null);
      selectNode(entityId);
      return;
    }
    selectNode(entityId);
  }

  function pointerPosition(event: ReactPointerEvent<HTMLButtonElement>): Position | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * 100, 5, 95),
      y: clamp(((event.clientY - rect.top) / rect.height) * 100, 6, 94)
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>, entityId: string): void {
    if (!canEdit) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging({ id: entityId, pointerId: event.pointerId, moved: false });
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>, entityId: string): void {
    if (!dragging || dragging.id !== entityId || dragging.pointerId !== event.pointerId) return;
    const nextPosition = pointerPosition(event);
    if (!nextPosition) return;
    setPositionOverrides((prev) => ({ ...prev, [entityId]: nextPosition }));
    setDragging((prev) => (prev ? { ...prev, moved: true } : prev));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>, entityId: string): void {
    if (!dragging || dragging.id !== entityId || dragging.pointerId !== event.pointerId) return;
    if (dragging.moved) setIgnoreClickId(entityId);
    setDragging(null);
  }

  function addElement(): void {
    if (!canEdit || !activeParentId) return;
    const parent = visibleById.get(activeParentId);
    const count = localEntities.filter((entity) => entity.kind === draftKind).length + 1;
    const label = draftLabel.trim() || `${itemLabel(draftKind)} ${count}`;
    const entity: EnergyEntity = {
      id: `custom-${Date.now()}-${count}`,
      parentId: activeParentId,
      label,
      kind: draftKind,
      status: "online",
      ownerScope: parent?.ownerScope === "prosumer" ? "prosumer" : "community",
      serial: defaultSerial(draftKind),
      capacity: defaultCapacity(draftKind)
    };

    setLocalEntities((prev) => [...prev, entity]);
    setDraftLabel("");
    selectNode(entity.id);
  }

  function updateSelected(patch: EntityOverrides[string]): void {
    if (!canEdit) return;
    const entityId = selectedForInspector.id;
    setEntityOverrides((prev) => ({ ...prev, [entityId]: { ...prev[entityId], ...patch } }));
    setLocalEntities((prev) => prev.map((entity) => (entity.id === entityId ? { ...entity, ...patch } : entity)));
  }

  function removeSelected(): void {
    if (!canRemoveSelected) return;
    const node = findTreeNode(topologyTree, selectedForInspector.id);
    const ids = new Set(node ? collectNodeIds(node) : [selectedForInspector.id]);
    setHiddenEntityIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    setLocalEntities((prev) => prev.filter((entity) => !ids.has(entity.id)));
    setPositionOverrides((prev) => {
      const next = { ...prev };
      ids.forEach((id) => delete next[id]);
      return next;
    });
    setEntityOverrides((prev) => {
      const next = { ...prev };
      ids.forEach((id) => delete next[id]);
      return next;
    });
    setExtraEdges((prev) => prev.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to)));
    setConnectFromId((prev) => (prev && ids.has(prev) ? null : prev));
    setEditMode(false);
    if (root) selectNode(root.id);
  }

  function resetLocalChanges(): void {
    setLocalEntities([]);
    setHiddenEntityIds(new Set());
    setEntityOverrides({});
    setExtraEdges([]);
    setPositionOverrides({});
    setConnectFromId(null);
    setEditMode(false);
    if (root) selectNode(root.id);
  }

  function runAutoLayout(): void {
    setPositionOverrides({});
    setConnectFromId(null);
  }

  return (
    <div className="page energy-console-page energy-topology-page">
      <header className="energy-page-head">
        <div>
          <span className="section-kicker">{canEdit ? "Operational topology" : "Read-only topology"}</span>
          <h1>Topology</h1>
          <p>{activeCommunity.name} structure, assets and current operating state.</p>
        </div>
        <div className="energy-head-actions">
          <Button
            variant="secondary"
            iconLeft={<Wand2 size={15} />}
            onClick={runAutoLayout}
            title="Reset node positions to the automatic layered layout"
          >
            Auto layout
          </Button>
        </div>
      </header>

      <section className="energy-topology-shell">
        <div className="energy-topology-toolbar">
          <Button
            className={connectFromId ? "is-active" : ""}
            size="sm"
            variant="secondary"
            iconLeft={<Link2 size={14} />}
            disabled={!canEdit}
            onClick={() => setConnectFromId((prev) => (prev ? null : selectedForInspector.id))}
          >
            {connectFromId ? "Select target" : "Connect"}
          </Button>
          <Button
            className={editMode ? "is-active" : ""}
            size="sm"
            variant="secondary"
            iconLeft={<Edit3 size={14} />}
            disabled={!canEdit}
            onClick={() => setEditMode((prev) => !prev)}
          >
            {editMode ? "Editing" : "Edit"}
          </Button>
          <Button size="sm" variant="danger" iconLeft={<Trash2 size={14} />} disabled={!canRemoveSelected} onClick={removeSelected}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" iconLeft={<RotateCcw size={14} />} disabled={!canEdit} onClick={resetLocalChanges}>
            Reset
          </Button>
          <span>
            {connectFromId
              ? `Connecting from ${visibleById.get(connectFromId)?.label ?? "selected node"}`
              : canEdit
                ? "Click for details. Drag nodes to refine the layout."
                : "Prosumer access is limited to own context."}
          </span>
        </div>

        {canEdit ? (
          <form
            className="topology-edit-tray"
            onSubmit={(event) => {
              event.preventDefault();
              addElement();
            }}
          >
            <label>
              <span>Element</span>
              <select value={draftKind} onChange={(event) => setDraftKind(event.target.value as AddableKind)}>
                {ADDABLE_ITEMS.map((item) => (
                  <option key={item.kind} value={item.kind}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Name</span>
              <input value={draftLabel} onChange={(event) => setDraftLabel(event.target.value)} placeholder={itemLabel(draftKind)} />
            </label>
            <div className="topology-target-chip">
              <span>Selected scope</span>
              <strong>{activeParent?.label ?? "Select a graph node"}</strong>
            </div>
            <Button variant="primary" iconLeft={<Plus size={14} />} disabled={!activeParentId}>
              Add element
            </Button>
          </form>
        ) : null}

        <div className="energy-topology-canvas" ref={canvasRef}>
          <svg className="energy-topology-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {displayedEdges.map((edge) => {
              const from = positionedById.get(edge.from);
              const to = positionedById.get(edge.to);
              if (!from || !to) return null;
              const midY = from.y + (to.y - from.y) * 0.5;
              return (
                <path
                  key={edge.id}
                  className={`energy-edge is-${edge.tone}`}
                  d={`M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>

          {canEdit ? (
            <div className="topology-graph-hint">
              {connectFromId ? "Choose the target node for the new connection." : "REC edit mode: drag nodes, add elements, connect nodes, or delete the selected item."}
            </div>
          ) : null}

          {isEmptyBuilder ? (
            <div className="topology-empty-builder">
              <strong>Start with the first building or shared asset.</strong>
              <span>Select an element above, name it if needed, then add it to the selected scope.</span>
            </div>
          ) : null}

          {positionedNodes.map((node) => (
            <TopologyGraphNode
              key={node.id}
              node={node}
              role={session?.role}
              selected={selectedForInspector.id === node.id}
              draggable={canEdit}
              dragging={dragging?.id === node.id}
              style={{ left: `${node.x}%`, top: `${node.y}%` }}
              onSelect={handleNodeClick}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            />
          ))}
        </div>

        <aside className="energy-inspector panel">
          <header>
            <div>
              <span className="section-kicker">Inspector</span>
              <h2>{selectedForInspector.label}</h2>
            </div>
            <Badge tone={selectedForInspector.status === "warning" ? "warning" : selectedForInspector.status === "offline" ? "danger" : "success"}>
              {selectedForInspector.status}
            </Badge>
          </header>

          {editMode && canEdit ? (
            <form
              className="topology-inspector-form"
              onSubmit={(event) => {
                event.preventDefault();
                setEditMode(false);
              }}
            >
              <label>
                <span>Name</span>
                <input value={selectedForInspector.label} onChange={(event) => updateSelected({ label: event.target.value })} />
              </label>
              <label>
                <span>Status</span>
                <select
                  value={selectedForInspector.status}
                  onChange={(event) => updateSelected({ status: event.target.value as EnergyEntity["status"] })}
                >
                  <option value="online">Online</option>
                  <option value="warning">Warning</option>
                  <option value="offline">Offline</option>
                </select>
              </label>
              <label>
                <span>Serial</span>
                <input value={selectedForInspector.serial || ""} onChange={(event) => updateSelected({ serial: event.target.value })} />
              </label>
              <label>
                <span>Capacity</span>
                <input value={selectedForInspector.capacity || ""} onChange={(event) => updateSelected({ capacity: event.target.value })} />
              </label>
              <label className="full-col">
                <span>Description</span>
                <textarea
                  value={selectedForInspector.description || ""}
                  onChange={(event) => updateSelected({ description: event.target.value })}
                  placeholder="Operational note or location context"
                />
              </label>
            </form>
          ) : (
            <p className="topology-inspector-note">
              {selectedForInspector.description || selectedForInspector.location || "Click any graph node to inspect its operational details."}
            </p>
          )}

          <dl className="energy-detail-list">
            <div>
              <dt>Type</dt>
              <dd>{selectedForInspector.kind.replace("_", " ")}</dd>
            </div>
            <div>
              <dt>Serial</dt>
              <dd>{selectedForInspector.serial || "-"}</dd>
            </div>
            <div>
              <dt>Capacity</dt>
              <dd>{selectedForInspector.capacity || "-"}</dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>{selectedForInspector.ownerScope}</dd>
            </div>
          </dl>

          <section className="energy-inspector-kpis">
            {getEntityKpis(selectedForInspector, session?.role).map((kpi) => (
              <div key={kpi.id}>
                <span>{kpi.label}</span>
                <strong>{kpi.value}</strong>
              </div>
            ))}
          </section>

          <div className="energy-inspector-actions">
            <Button
              variant="secondary"
              iconLeft={<ShieldCheck size={14} />}
              disabled={!canEdit}
              onClick={() => updateSelected({ status: "online" })}
            >
              Validate
            </Button>
            <Button variant="primary" iconLeft={<Save size={14} />} disabled={!canEdit} onClick={() => setEditMode(false)}>
              Save
            </Button>
          </div>
        </aside>
      </section>
    </div>
  );
}
