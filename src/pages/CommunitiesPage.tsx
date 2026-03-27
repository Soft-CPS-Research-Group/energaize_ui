import { ArrowRight, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useUI } from "../contexts/UIContext";
import type { CommunityContext } from "../types";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";

type SortMode = "name" | "status" | "activity";
type FilterMode = "all" | "normal" | "alerts" | "offline";

export function CommunitiesPage(): JSX.Element {
  const { session } = useAuth();
  const { communities, setActiveCommunity } = useUI();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortMode>("name");
  const [filter, setFilter] = useState<FilterMode>("all");

  const filtered = useMemo(() => {
    const byQuery = communities.filter((community) => {
      const target = `${community.name} ${community.location} ${community.description || ""}`.toLowerCase();
      return target.includes(search.toLowerCase());
    });

    const byFilter = byQuery.filter((community) => filter === "all" || community.status === filter);

    return [...byFilter].sort((a, b) => sortCommunity(a, b, sortBy));
  }, [communities, filter, search, sortBy]);

  function enterCommunity(community: CommunityContext): void {
    setActiveCommunity(community.id);
    navigate(session?.role === "ai_manager" ? "/app/ai/jobs" : "/app/logs");
  }

  return (
    <div className="page communities-page">
      <PageHeader
        title="Communities"
        subtitle="Select a community to access operational views."
        actions={
          <Button variant="primary" iconLeft={<Plus size={14} />}>
            Create Community
          </Button>
        }
      />

      <section className="toolbar">
        <label className="search-inline">
          <Search size={14} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            type="search"
            placeholder="Search communities"
          />
        </label>

        <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortMode)}>
          <option value="name">Sort: Name</option>
          <option value="status">Sort: Status</option>
          <option value="activity">Sort: Activity</option>
        </select>

        <select value={filter} onChange={(event) => setFilter(event.target.value as FilterMode)}>
          <option value="all">All states</option>
          <option value="normal">Normal</option>
          <option value="alerts">With alerts</option>
          <option value="offline">Offline</option>
        </select>
      </section>

      {filtered.length === 0 ? (
        <EmptyState
          title="No communities available"
          message="Create your first community to start monitoring assets and training workflows."
          action={<Button variant="primary">Create Community</Button>}
        />
      ) : (
        <section className="community-grid">
          {filtered.map((community) => (
            <article key={community.id} className="community-card">
              <header>
                <h3>{community.name}</h3>
                <Badge tone={community.status === "alerts" ? "warning" : community.status === "offline" ? "danger" : "success"}>
                  {community.status}
                </Badge>
              </header>

              <p>{community.description}</p>

              <dl>
                <div>
                  <dt>Location</dt>
                  <dd>{community.location}</dd>
                </div>
                <div>
                  <dt>Buildings</dt>
                  <dd>{community.buildings}</dd>
                </div>
                <div>
                  <dt>Assets</dt>
                  <dd>{community.assets ?? "-"}</dd>
                </div>
              </dl>

              <Button
                variant="secondary"
                iconLeft={<ArrowRight size={14} />}
                onClick={() => enterCommunity(community)}
              >
                Enter
              </Button>
            </article>
          ))}
        </section>
      )}
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
