import { AlertTriangle, ArrowRight, Boxes, Building2, CheckCircle2, CloudOff, Plus, Search, Settings2, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { APP_NAME } from "../constants";
import { InstitutionalDock } from "../components/layout/InstitutionalDock";
import { UserMenu } from "../components/layout/UserMenu";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { useAuth } from "../contexts/AuthContext";
import { useUI } from "../contexts/UIContext";
import { getProsumerBuildingScopes, type EnergyEntity } from "../data/energyCommunity";
import type { CommunityContext } from "../types";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Modal } from "../components/ui/Modal";
import { communityWorkspaceHomePath, isCommunityUserRole, roleHomePath } from "../utils/roles";

type SortMode = "name" | "status" | "activity";
type FilterMode = "all" | "normal" | "alerts" | "offline";

export function CommunitiesPage(): JSX.Element {
  const { session } = useAuth();
  const { communities, activeCommunity, setActiveCommunity, addCommunity, setSelectedEntityId } = useUI();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortMode>("name");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [userOpen, setUserOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draftCommunity, setDraftCommunity] = useState({
    name: "",
    location: "",
    description: ""
  });
  const avatarFallback = session?.name?.split(" ").map((part) => part[0]).slice(0, 2).join("") || "U";
  const isProsumer = session?.role === "prosumer";
  const prosumerBuildings = useMemo(
    () => (isProsumer ? getProsumerBuildingScopes(activeCommunity) : []),
    [activeCommunity, isProsumer]
  );

  const filtered = useMemo(() => {
    const byQuery = communities.filter((community) => {
      const target = `${community.name} ${community.location} ${community.description || ""}`.toLowerCase();
      return target.includes(search.toLowerCase());
    });

    const byFilter = byQuery.filter((community) => filter === "all" || community.status === filter);

    return [...byFilter].sort((a, b) => sortCommunity(a, b, sortBy));
  }, [communities, filter, search, sortBy]);

  const filteredProsumerBuildings = useMemo(() => {
    const query = search.toLowerCase();
    return prosumerBuildings.filter((building) => {
      const target = `${building.label} ${building.location || ""} ${building.description || ""}`.toLowerCase();
      return target.includes(query);
    });
  }, [prosumerBuildings, search]);

  useEffect(() => {
    if (!isProsumer || prosumerBuildings.length !== 1) return;
    setSelectedEntityId(prosumerBuildings[0].id);
    navigate(communityWorkspaceHomePath(session?.role), { replace: true });
  }, [isProsumer, navigate, prosumerBuildings, session?.role, setSelectedEntityId]);

  function enterCommunity(community: CommunityContext): void {
    setActiveCommunity(community.id);
    navigate(isCommunityUserRole(session?.role) ? communityWorkspaceHomePath(session?.role) : roleHomePath(session?.role));
  }

  function enterProsumerBuilding(building: EnergyEntity): void {
    setSelectedEntityId(building.id);
    navigate(communityWorkspaceHomePath(session?.role));
  }

  function statusIcon(status: CommunityContext["status"]): JSX.Element {
    if (status === "alerts") return <AlertTriangle size={14} />;
    if (status === "offline") return <CloudOff size={14} />;
    return <CheckCircle2 size={14} />;
  }

  function createCommunity(): void {
    const name = draftCommunity.name.trim();
    if (!name) return;
    const community = addCommunity({
      name,
      location: draftCommunity.location.trim() || "Location not set",
      description: draftCommunity.description.trim() || "New energy community.",
      buildings: 0,
      assets: 0,
      topologyPreset: "blank"
    });
    setCreateOpen(false);
    setDraftCommunity({ name: "", location: "", description: "" });
    setActiveCommunity(community.id);
    navigate("/app/community/topology");
  }

  if (isProsumer) {
    return (
      <div className="community-select-page">
        <header className="topbar community-select-appbar">
          <div className="topbar-left">
            <button className="brand community-select-brand" type="button" onClick={() => navigate("/app/community/dashboard")}>
              <img className="brand-logo brand-logo-light" src="/assets/logos/energaize-light.png" alt={APP_NAME} />
              <img className="brand-logo brand-logo-dark" src="/assets/logos/energaize-dark.png" alt={APP_NAME} />
            </button>
          </div>

          <nav className="topbar-nav" aria-label="Prosumer building selection">
            <span className="top-tab is-active">My buildings</span>
          </nav>

          <div className="topbar-right communities-header-actions">
            <ThemeToggle />

            <button
              className="avatar-btn"
              type="button"
              onClick={() => setUserOpen((prev) => !prev)}
              aria-label="Open user menu"
              title="User menu"
            >
              <span className="avatar-media">{avatarFallback}</span>
              <Settings2 size={14} />
            </button>

            <UserMenu open={userOpen} onClose={() => setUserOpen(false)} />
          </div>
        </header>

        <main className="community-select-shell">
          <section className="community-select-panel">
            <header className="community-select-panel-head">
              <div>
                <span className="section-kicker">Prosumer access</span>
                <h1>Choose your building</h1>
                <p>Open the building or home associated with your account.</p>
              </div>
              <label className="search-inline">
                <Search size={14} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  type="search"
                  placeholder="Search buildings..."
                />
              </label>
            </header>

            {filteredProsumerBuildings.length === 0 ? (
              <EmptyState
                title="No buildings assigned"
                message="This account does not have an assigned building yet."
              />
            ) : (
              <ul className="community-select-list">
                {filteredProsumerBuildings.map((building) => (
                  <li key={building.id}>
                    <article className="community-select-item">
                      <div className="community-select-icon">
                        <Building2 size={28} />
                      </div>
                      <div className="community-select-main">
                        <h2>{building.label}</h2>
                        <span>{building.location || activeCommunity.name}</span>
                        <p>{building.description || `Personal energy workspace in ${activeCommunity.name}.`}</p>
                        <div className="community-select-meta">
                          <small><Boxes size={13} /> Personal assets</small>
                          <small>{activeCommunity.name}</small>
                        </div>
                      </div>
                      <div className="community-select-side">
                        <Button
                          variant="primary"
                          iconRight={<ArrowRight size={14} />}
                          onClick={() => enterProsumerBuilding(building)}
                        >
                          Enter
                        </Button>
                        <Badge tone={building.status === "warning" ? "warning" : building.status === "offline" ? "danger" : "success"}>
                          <span className="community-status-inline">{statusIcon(building.status === "warning" ? "alerts" : building.status === "offline" ? "offline" : "normal")} {building.status}</span>
                        </Badge>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>

        <InstitutionalDock />
      </div>
    );
  }

  return (
    <div className="community-select-page">
      <header className="topbar community-select-appbar">
        <div className="topbar-left">
          <button className="brand community-select-brand" type="button" onClick={() => navigate("/communities")}>
            <img className="brand-logo brand-logo-light" src="/assets/logos/energaize-light.png" alt={APP_NAME} />
            <img className="brand-logo brand-logo-dark" src="/assets/logos/energaize-dark.png" alt={APP_NAME} />
          </button>
        </div>

        <nav className="topbar-nav" aria-label="Community selection">
          <span className="top-tab is-active">Communities</span>
        </nav>

        <div className="topbar-right communities-header-actions">
          <ThemeToggle />

          <button
            className="avatar-btn"
            type="button"
            onClick={() => setUserOpen((prev) => !prev)}
            aria-label="Open user menu"
            title="User menu"
          >
            <span className="avatar-media">{avatarFallback}</span>
            <Settings2 size={14} />
          </button>

          <UserMenu open={userOpen} onClose={() => setUserOpen(false)} />
        </div>
      </header>

      <main className="community-select-shell">
        <section className="community-select-panel">
          <header className="community-select-panel-head">
            <div>
              <span className="section-kicker">Energy communities</span>
              <h1>Choose a community</h1>
              <p>Enter a REC workspace or a prosumer view with the selected community as context.</p>
            </div>
            <label className="search-inline">
              <Search size={14} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                type="search"
                placeholder="Search communities..."
              />
            </label>
          </header>

          <div className="community-select-controls">
            <label>
              <span>Sort by</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortMode)}>
                <option value="name">Name A-Z</option>
                <option value="status">Status</option>
                <option value="activity">Activity</option>
              </select>
            </label>

            <label>
              <span>Status</span>
              <select value={filter} onChange={(event) => setFilter(event.target.value as FilterMode)}>
                <option value="all">All states</option>
                <option value="normal">Normal</option>
                <option value="alerts">With alerts</option>
                <option value="offline">Offline</option>
              </select>
            </label>

            <Button className="community-select-create" variant="primary" iconLeft={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
              New Community
            </Button>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title="No communities available"
              message="Create your first community to start monitoring assets and energy flows."
              action={<Button variant="primary" onClick={() => setCreateOpen(true)}>New Community</Button>}
            />
          ) : (
            <ul className="community-select-list">
              {filtered.map((community) => (
                <li key={community.id}>
                  <article className="community-select-item">
                    <div className="community-select-icon">
                      <Sun size={28} />
                    </div>
                    <div className="community-select-main">
                      <h2>{community.name}</h2>
                      <span>{community.location}</span>
                      <p>{community.description}</p>
                      <div className="community-select-meta">
                        <small><Building2 size={13} /> {community.buildings} buildings</small>
                        <small><Boxes size={13} /> {community.assets ?? 0} assets</small>
                      </div>
                    </div>
                    <div className="community-select-side">
                      <Button
                        variant="primary"
                        iconRight={<ArrowRight size={14} />}
                        onClick={() => enterCommunity(community)}
                      >
                        View
                      </Button>
                      <Badge tone={community.status === "alerts" ? "warning" : community.status === "offline" ? "danger" : "success"}>
                        <span className="community-status-inline">{statusIcon(community.status)} {community.status}</span>
                      </Badge>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <InstitutionalDock />

      <Modal title="New Community" open={createOpen} onClose={() => setCreateOpen(false)} width="sm">
        <form
          className="community-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            createCommunity();
          }}
        >
          <label>
            <span>Name</span>
            <input
              value={draftCommunity.name}
              onChange={(event) => setDraftCommunity((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Solar Community"
              autoFocus
            />
          </label>
          <label>
            <span>Location</span>
            <input
              value={draftCommunity.location}
              onChange={(event) => setDraftCommunity((prev) => ({ ...prev, location: event.target.value }))}
              placeholder="Porto, PT"
            />
          </label>
          <label>
            <span>Description</span>
            <textarea
              value={draftCommunity.description}
              onChange={(event) => setDraftCommunity((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Residential community with PV, storage and flexible loads."
            />
          </label>
          <p className="community-create-note">
            The topology starts empty. Add buildings, homes, shared assets and connections in the topology editor.
          </p>
          <div className="inline-end">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" iconLeft={<Plus size={14} />} disabled={!draftCommunity.name.trim()}>
              Create
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function sortCommunity(a: CommunityContext, b: CommunityContext, sortBy: SortMode): number {
  if (sortBy === "name") return a.name.localeCompare(b.name);
  if (sortBy === "status") return a.status.localeCompare(b.status);
  const scoreA = (a.assets ?? 0) + a.buildings * 2;
  const scoreB = (b.assets ?? 0) + b.buildings * 2;
  return scoreB - scoreA;
}
