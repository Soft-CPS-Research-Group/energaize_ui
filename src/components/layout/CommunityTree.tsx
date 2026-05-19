import {
  Battery,
  Cpu,
  Database,
  Building2,
  Car,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  FileCog,
  Home,
  ListOrdered,
  Network,
  PanelsTopLeft,
  PlugZap,
  Server,
  Sun,
  X
} from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useUI } from "../../contexts/UIContext";
import type { EnergyEntityKind, EnergyTreeNode } from "../../data/energyCommunity";
import { getEnergyTree, getProsumerBuildingScopes } from "../../data/energyCommunity";
import { isCommunityUserRole, isKpiManagerRole, isPredictorRole, isTrainingManagerRole, roleLabel } from "../../utils/roles";

const AI_SIDE_LINKS = [
  { to: "/app/ai/datasets", label: "Datasets", icon: <Database size={14} /> },
  { to: "/app/ai/configs", label: "Experiment Configs", icon: <FileCog size={14} /> },
  { to: "/app/ai/jobs", label: "Jobs", icon: <Cpu size={14} /> },
  { to: "/app/ai/queue", label: "Queue", icon: <ListOrdered size={14} /> },
  { to: "/app/ai/hosts", label: "Hosts", icon: <Server size={14} /> }
] as const;

function iconForKind(kind: EnergyEntityKind): JSX.Element {
  if (kind === "community") return <Network size={15} />;
  if (kind === "building" || kind === "apartment") return <Building2 size={15} />;
  if (kind === "house") return <Home size={15} />;
  if (kind === "battery") return <Battery size={14} />;
  if (kind === "ev_charger") return <PlugZap size={14} />;
  if (kind === "ev") return <Car size={14} />;
  if (kind === "pv" || kind === "solar_plant") return <Sun size={14} />;
  if (kind === "transformer" || kind === "grid_meter") return <PlugZap size={14} />;
  if (kind === "appliance" || kind === "heat_pump" || kind === "heater" || kind === "water_pump" || kind === "non_shiftable_load") {
    return <CircleGauge size={14} />;
  }
  if (kind === "group") return <CircleGauge size={14} />;
  return <Network size={15} />;
}

function findTreeNode(nodes: EnergyTreeNode[], entityId: string): EnergyTreeNode | null {
  for (const node of nodes) {
    if (node.id === entityId) return node;
    const child = findTreeNode(node.children, entityId);
    if (child) return child;
  }
  return null;
}

function TreeItem({ node, depth = 0 }: { node: EnergyTreeNode; depth?: number }): JSX.Element {
  const { selectedEntityId, setSelectedEntityId, treeCollapsed } = useUI();
  const [open, setOpen] = useState(true);
  const hasChildren = Boolean(node.children && node.children.length > 0);

  return (
    <li>
      <div
        className={`tree-item${selectedEntityId === node.id ? " is-active" : ""}`}
        style={{ paddingLeft: treeCollapsed ? 0 : `${10 + depth * 14}px` }}
      >
        {hasChildren ? (
          <button className="tree-toggle" type="button" onClick={() => setOpen((prev) => !prev)}>
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="tree-toggle-placeholder" />
        )}

        <button className="tree-target" type="button" onClick={() => setSelectedEntityId(node.id)}>
          {iconForKind(node.kind)}
          <span>{node.label}</span>
          {node.status !== "online" ? <small className={`tree-status-dot is-${node.status}`} /> : null}
        </button>
      </div>

      {hasChildren && open ? (
        <ul className="tree-group">
          {node.children?.map((child) => (
            <TreeItem key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function CommunityTree(): JSX.Element {
  const { session } = useAuth();
  const {
    communities,
    activeCommunity,
    setActiveCommunity,
    treeCollapsed,
    toggleTreeCollapsed,
    mobileTreeOpen,
    setMobileTreeOpen
  } = useUI();
  const tree = getEnergyTree(activeCommunity, session?.role);
  const isTrainingManager = isTrainingManagerRole(session?.role);
  const isCommunityUser = isCommunityUserRole(session?.role);
  const isProsumer = session?.role === "prosumer";
  const isRoleMockMenu = isPredictorRole(session?.role) || isKpiManagerRole(session?.role);
  const visibleTree =
    isProsumer
      ? getProsumerBuildingScopes(activeCommunity)
          .map((scope) => findTreeNode(tree, scope.id))
          .filter((node): node is EnergyTreeNode => Boolean(node))
      : tree;
  const roleKicker =
    session?.role && roleLabel(session.role) !== "unknown"
      ? roleLabel(session.role)
          .split(" ")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ")
      : "Context";

  return (
    <>
      <aside className={`community-tree${treeCollapsed ? " is-collapsed" : ""}${isTrainingManager ? " is-ai" : ""}`}>
        <header>
          <div>
            <span className="section-kicker">
              {isTrainingManager ? "Training Manager" : isCommunityUser ? "Selected scope" : roleKicker}
            </span>
            {!treeCollapsed ? <strong>{isCommunityUser ? "Entity tree" : activeCommunity.name}</strong> : null}
          </div>
          <button
            className="icon-btn"
            type="button"
            onClick={toggleTreeCollapsed}
            title={treeCollapsed ? "Expand entity tree" : "Collapse entity tree"}
            aria-label={treeCollapsed ? "Expand entity tree" : "Collapse entity tree"}
          >
            <PanelsTopLeft size={15} />
          </button>
        </header>

        {!treeCollapsed ? (
          <section className="tree-section">
            {isTrainingManager ? (
              <>
                <label className="tree-community-picker">
                  <span className="section-kicker">Community</span>
                  <select
                    aria-label="Community context"
                    value={activeCommunity.id}
                    onChange={(event) => setActiveCommunity(event.target.value)}
                  >
                    {communities.map((community) => (
                      <option key={community.id} value={community.id}>
                        {community.name}
                      </option>
                    ))}
                  </select>
                </label>

                <nav className="ai-side-nav" aria-label="AI manager sections">
                  {AI_SIDE_LINKS.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) => `ai-side-link${isActive ? " is-active" : ""}`}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </NavLink>
                  ))}
                </nav>
              </>
            ) : isRoleMockMenu ? (
              <nav className="role-side-nav-mock" aria-label="Role menu mock">
                <span className="role-side-item">Menu items em breve</span>
              </nav>
            ) : null}

            {!isRoleMockMenu ? <div className="tree-section-head">{isProsumer ? "My buildings" : "Community Composition"}</div> : null}
          </section>
        ) : null}

        {!isRoleMockMenu ? (
          <ul className="tree-root">
            {visibleTree.map((node) => (
              <TreeItem key={node.id} node={node} />
            ))}
          </ul>
        ) : null}
      </aside>

      {mobileTreeOpen ? (
        <div className="mobile-tree-overlay" role="presentation" onClick={() => setMobileTreeOpen(false)}>
          <aside className="mobile-tree" onClick={(event) => event.stopPropagation()}>
            <header>
              <strong>{activeCommunity.name}</strong>
              <button
                className="icon-btn"
                type="button"
                onClick={() => setMobileTreeOpen(false)}
                aria-label="Close entity tree"
              >
                <X size={15} />
              </button>
            </header>

            {isTrainingManager ? (
              <section className="tree-section">
                <label className="tree-community-picker">
                  <span className="section-kicker">Community</span>
                  <select
                    aria-label="Community context"
                    value={activeCommunity.id}
                    onChange={(event) => setActiveCommunity(event.target.value)}
                  >
                    {communities.map((community) => (
                      <option key={community.id} value={community.id}>
                        {community.name}
                      </option>
                    ))}
                  </select>
                </label>

                <nav className="ai-side-nav" aria-label="AI manager sections">
                  {AI_SIDE_LINKS.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) => `ai-side-link${isActive ? " is-active" : ""}`}
                      onClick={() => setMobileTreeOpen(false)}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </NavLink>
                  ))}
                </nav>
                <div className="tree-section-head">{isProsumer ? "My buildings" : "Community Composition"}</div>
              </section>
            ) : isRoleMockMenu ? (
              <section className="tree-section">
                <nav className="role-side-nav-mock" aria-label="Role menu mock">
                  <span className="role-side-item">Menu items em breve</span>
                </nav>
              </section>
            ) : null}

            {!isRoleMockMenu ? (
              <ul className="tree-root">
                {visibleTree.map((node) => (
                  <TreeItem key={node.id} node={node} />
                ))}
              </ul>
            ) : null}
          </aside>
        </div>
      ) : null}
    </>
  );
}
