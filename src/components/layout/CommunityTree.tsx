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
  ListOrdered,
  Network,
  PanelsTopLeft,
  Server,
  Sun,
  X
} from "lucide-react";
import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useUI } from "../../contexts/UIContext";
import { isKpiManagerRole, isPredictorRole, isTrainingManagerRole, roleLabel } from "../../utils/roles";

interface TreeNode {
  id: string;
  label: string;
  icon: JSX.Element;
  children?: TreeNode[];
}

const AI_SIDE_LINKS = [
  { to: "/app/ai/datasets", label: "Datasets", icon: <Database size={14} /> },
  { to: "/app/ai/configs", label: "Experiment Configs", icon: <FileCog size={14} /> },
  { to: "/app/ai/jobs", label: "Jobs", icon: <Cpu size={14} /> },
  { to: "/app/ai/queue", label: "Queue", icon: <ListOrdered size={14} /> },
  { to: "/app/ai/hosts", label: "Hosts", icon: <Server size={14} /> }
] as const;

function useEntityTree(): TreeNode[] {
  return useMemo(
    () => [
      {
        id: "community",
        label: "Community",
        icon: <Network size={15} />,
        children: [
          {
            id: "building-a",
            label: "Building A",
            icon: <Building2 size={15} />,
            children: [
              { id: "battery-a", label: "Battery", icon: <Battery size={14} /> },
              { id: "ev-a1", label: "EV 1", icon: <Car size={14} /> },
              { id: "pv-a", label: "PV", icon: <Sun size={14} /> }
            ]
          },
          {
            id: "building-b",
            label: "Building B",
            icon: <Building2 size={15} />,
            children: [
              { id: "ev-b1", label: "EV 1", icon: <Car size={14} /> },
              { id: "bess-b", label: "BESS", icon: <Battery size={14} /> }
            ]
          },
          {
            id: "building-c",
            label: "Building C",
            icon: <Building2 size={15} />,
            children: [{ id: "meter-c", label: "Main Meter", icon: <CircleGauge size={14} /> }]
          }
        ]
      }
    ],
    []
  );
}

function TreeItem({ node, depth = 0 }: { node: TreeNode; depth?: number }): JSX.Element {
  const { selectedEntityId, setSelectedEntityId } = useUI();
  const [open, setOpen] = useState(true);
  const hasChildren = Boolean(node.children && node.children.length > 0);

  return (
    <li>
      <div
        className={`tree-item${selectedEntityId === node.id ? " is-active" : ""}`}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
      >
        {hasChildren ? (
          <button className="tree-toggle" type="button" onClick={() => setOpen((prev) => !prev)}>
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="tree-toggle-placeholder" />
        )}

        <button className="tree-target" type="button" onClick={() => setSelectedEntityId(node.id)}>
          {node.icon}
          <span>{node.label}</span>
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
  const tree = useEntityTree();
  const isTrainingManager = isTrainingManagerRole(session?.role);
  const isRoleMockMenu = isPredictorRole(session?.role) || isKpiManagerRole(session?.role);
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
            <span className="section-kicker">{isTrainingManager ? "Training Manager" : roleKicker}</span>
            {!treeCollapsed ? <strong>{activeCommunity.name}</strong> : null}
          </div>
          <button className="icon-btn" type="button" onClick={toggleTreeCollapsed} title="Toggle tree">
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

            {!isRoleMockMenu ? <div className="tree-section-head">Community Composition</div> : null}
          </section>
        ) : null}

        {!isRoleMockMenu ? (
          <ul className="tree-root">
            {tree.map((node) => (
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
                <div className="tree-section-head">Community Composition</div>
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
                {tree.map((node) => (
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
