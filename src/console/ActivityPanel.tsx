/* Visual thesis: a quiet, translucent journal beside the account, not another menu.
   Content: context and time controls, chronological changes, expandable confirmations.
   Interaction: native modal focus, restrained entrance, scroll to older activity. */
import { useEffect, useRef, useState } from "react";
import {
  History,
  RefreshCw,
  X,
  ChevronDown,
  Check,
  AlertCircle,
  SlidersHorizontal,
} from "lucide-react";
import "./activity.css";

export interface ActivityScope {
  communityId?: string;
  siteId?: string;
  resourceId?: string;
  label?: string;
}
interface Confirmation {
  target: string;
  note: string;
  recorded_at: string;
  actor_status: "unverified";
}
export interface ActivityItem {
  id: string;
  occurred_at: string;
  community_id: string | null;
  site_id: string;
  resource_id: string;
  resource_name: string;
  action: string;
  status: "pending" | "resolved";
  actor_status: "unavailable";
  confirmations: Confirmation[];
}
interface Page {
  items: ActivityItem[];
  next_cursor: string | null;
  source: string;
}
const words = (text: string) => text.replaceAll("_", " ");
const date = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const time = (value: string) =>
  new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

export function ActivityPanel({
  scope,
  onClose,
  theme,
}: {
  scope: ActivityScope;
  onClose: () => void;
  theme?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    request = useRef<AbortController>();
  const [days, setDays] = useState("7"),
    [kind, setKind] = useState("all"),
    [scoped, setScoped] = useState(true);
  const [anchor, setAnchor] = useState(() => new Date()),
    [start, setStart] = useState(""),
    [end, setEnd] = useState("");
  const [items, setItems] = useState<ActivityItem[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const inFlight = useRef(false),
    generation = useRef(0);
  const custom = days === "custom";
  const rangeEnd = custom && end ? new Date(end + "T00:00:00") : anchor;
  const rangeStart =
    custom && start
      ? new Date(start + "T00:00:00")
      : new Date(anchor.getTime() - Number(days || 7) * 86400000);
  if (custom && end) rangeEnd.setDate(rangeEnd.getDate() + 1);
  const valid =
    !custom ||
    !!(
      start &&
      end &&
      rangeStart < rangeEnd &&
      rangeEnd.getTime() - rangeStart.getTime() <= 366 * 86400000
    );
  const key = [
    scope.communityId,
    scoped ? scope.siteId : "",
    scoped ? scope.resourceId : "",
    kind,
    days,
    start,
    end,
    anchor.toISOString(),
  ].join("|");
  async function load(next: string | null = null) {
    if (inFlight.current || !valid) return;
    const serial = generation.current;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    request.current = controller;
    const params = new URLSearchParams({
      since: rangeStart.toISOString(),
      until: rangeEnd.toISOString(),
      kind,
      limit: "40",
    });
    if (scope.communityId) params.set("community_id", scope.communityId);
    if (scoped && scope.siteId) params.set("site_id", scope.siteId);
    if (scoped && scope.resourceId) params.set("resource_id", scope.resourceId);
    if (next) params.set("cursor", next);
    try {
      const response = await fetch(
        "/community-api/api/identity/activity?" + params,
        { credentials: "same-origin", signal: controller.signal },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw Error(
          response.status === 404
            ? "Activity is not available on this backend version yet."
            : response.status === 401
              ? "Your session has expired. Sign in again."
              : typeof body.error?.message === "string"
                ? body.error.message
                : "Activity could not be loaded. Please try again.",
        );
      if (!Array.isArray(body.items))
        throw Error("Activity could not be loaded. Please try again.");
      if (generation.current !== serial) return;
      const page = body as Page;
      setItems((old) =>
        next
          ? [
              ...old,
              ...page.items.filter(
                (row) => !old.some((existing) => existing.id === row.id),
              ),
            ]
          : page.items,
      );
      setCursor(page.next_cursor);
    } catch (e) {
      if (!controller.signal.aborted && generation.current === serial)
        setError((e as Error).message);
    } finally {
      if (generation.current === serial) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal?.();
    return () => {
      request.current?.abort();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    generation.current++;
    request.current?.abort();
    inFlight.current = false;
    setItems([]);
    setCursor(null);
    setBusy(false);
    setError("");
    scroll.current?.scrollTo?.({ top: 0 });
    void load();
    return () => {
      generation.current++;
      request.current?.abort();
    };
  }, [key]);
  return (
    <dialog
      ref={dialog}
      className="activity-dialog"
      data-theme={theme}
      aria-labelledby="activity-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) {
          const r = dialog.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <header className="activity-head">
        <div className="activity-title">
          <History size={21} />
          <div>
            <h2 id="activity-title">Activity</h2>
            <p>
              {scoped
                ? scope.label || "Your communities"
                : "Community activity"}
            </p>
          </div>
        </div>
        <div className="activity-actions">
          <button
            aria-label="Refresh activity"
            title="Refresh activity"
            disabled={busy}
            onClick={() => setAnchor(new Date())}
          >
            <RefreshCw size={17} />
          </button>
          <button aria-label="Close activity" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
      </header>
      <div className="activity-filters">
        <label>
          <span>Period</span>
          <select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="custom">Choose dates</option>
          </select>
        </label>
        <label>
          <span>Show</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">All activity</option>
            <option value="changes">Changes</option>
            <option value="open">Open reviews</option>
            <option value="resolved">Resolved reviews</option>
          </select>
        </label>
        {(scope.siteId || scope.resourceId) && (
          <label>
            <span>Scope</span>
            <select
              value={scoped ? "current" : "community"}
              onChange={(e) => setScoped(e.target.value === "current")}
            >
              <option value="current">
                Current {scope.resourceId ? "equipment" : "site"}
              </option>
              <option value="community">All accessible sites</option>
            </select>
          </label>
        )}
      </div>
      {custom && (
        <div className="activity-dates">
          <label>
            From
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            Through
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          {!valid && (
            <span role="status">Choose a valid range of up to one year.</span>
          )}
        </div>
      )}
      <p className="activity-coverage">
        Inventory changes and configuration reviews. Times are shown in your
        local time zone.
      </p>
      <div
        className="activity-scroll"
        ref={scroll}
        aria-busy={busy}
        onScroll={(e) => {
          const n = e.currentTarget;
          if (
            n.scrollHeight - n.scrollTop - n.clientHeight < 120 &&
            cursor &&
            !busy &&
            !error
          )
            void load(cursor);
        }}
      >
        {items.map((item, index) => (
          <section key={item.id} className="activity-entry">
            {(index === 0 ||
              date(items[index - 1].occurred_at) !==
                date(item.occurred_at)) && (
              <h3 className="activity-day">{date(item.occurred_at)}</h3>
            )}
            <div className="activity-row">
              <time dateTime={item.occurred_at}>{time(item.occurred_at)}</time>
              <span className={"activity-mark " + item.status}>
                {item.status === "pending" ? (
                  <AlertCircle size={17} />
                ) : (
                  <Check size={17} />
                )}
              </span>
              <div className="activity-record">
                <div className="activity-record-head">
                  <strong>{item.resource_name}</strong>
                  <span className={"activity-state " + item.status}>
                    {item.status === "pending" ? "Needs review" : "Resolved"}
                  </span>
                </div>
                <p className="activity-action">{words(item.action)}</p>
                <small>Author unavailable in this historical record</small>
                <details>
                  <summary>
                    <SlidersHorizontal size={13} /> Configuration review{" "}
                    <ChevronDown size={13} />
                  </summary>
                  <div className="activity-detail">
                    {item.confirmations.length ? (
                      item.confirmations.map((c) => (
                        <div key={c.target}>
                          <strong>{words(c.target)}</strong>
                          <p>{c.note}</p>
                          <small>
                            Manual confirmation · {date(c.recorded_at)},{" "}
                            {time(c.recorded_at)} · Author unverified
                          </small>
                        </div>
                      ))
                    ) : (
                      <p>
                        Review the algorithm, Percepta and other integrations
                        for this change.
                      </p>
                    )}
                  </div>
                </details>
              </div>
            </div>
          </section>
        ))}
        {error && (
          <div className="activity-message" role="alert">
            <AlertCircle size={24} />
            <p>{error}</p>
            <button onClick={() => void load(cursor)}>Try again</button>
          </div>
        )}
        {!items.length && !busy && !error && valid && (
          <div className="activity-message">
            <History size={32} />
            <h3>No recorded activity</h3>
            <p>
              There are no inventory changes in this period for the resources
              you can access.
            </p>
          </div>
        )}
        {busy && (
          <p className="activity-loading" role="status">
            Loading activity…
          </p>
        )}
        {cursor && !busy && !error && (
          <button className="activity-more" onClick={() => void load(cursor)}>
            Load older activity <ChevronDown size={15} />
          </button>
        )}
        {!!items.length && !cursor && !busy && !error && (
          <p className="activity-end">End of this period</p>
        )}
      </div>
    </dialog>
  );
}
