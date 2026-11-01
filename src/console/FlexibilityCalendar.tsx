import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Search,
  X,
  Layers3,
  Plus,
  Repeat2,
  Sparkles,
} from "lucide-react";
import {
  selectionRequest,
  type ChosenFlexibility,
  type ChosenOffer,
} from "../api/flexibilitySelection";
import { EquipmentArt } from "./EquipmentArt";
import { FlexibilityPreferences } from "./FlexibilityPreferences";
import { EVChargingLoader } from "../components/ui/EVChargingLoader";

export interface CalendarEquipment {
  id: string;
  name: string;
  kind: string;
  canEdit: boolean;
  cycles: Array<{ id: string; name: string }>;
}
export interface CalendarOccurrence {
  occurrence_id: string;
  event_id: string;
  asset_id: string;
  starts_at: string;
  ends_at: string;
  occurrence_at: string;
  revision: number;
  exception_revision: number;
  exception_action?: string | null;
  recurrence: unknown;
  created_by: string | null;
  status: string;
  resolution: string;
  title: string;
  type_specific_data?: {
    soc_at_departure?: number | null;
    duration_minutes?: number | null;
    energy_required_kwh?: number | null;
    setpoint?: number | null;
    cycle_snapshot?: { name?: string } | null;
  };
}
type Source = "recurrent" | "punctual" | "forecast";
interface Entry {
  id: string;
  assetId: string;
  source: Source;
  start: string | null;
  end: string | null;
  anchor: string;
  occurrence?: CalendarOccurrence;
  forecastId?: string;
  selectedFields: string[];
  inactive: boolean;
  forecastState?: string;
}
interface Snapshot {
  occurrences: CalendarOccurrence[];
  selections: Record<string, ChosenFlexibility>;
  failures: string[];
}
export interface CalendarAction {
  action: "create" | "edit" | "cancel";
  day: string;
  assetId: string;
  occurrence?: CalendarOccurrence;
}
const labels: Record<Source, string> = {
  recurrent: "Recurring",
  punctual: "One-off",
  forecast: "Prediction",
};
const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const isoDay = (value: string) => dayKey(new Date(value));
const hour = (value: string | null) =>
  value
    ? new Date(value).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Not specified";
const dayLabel = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
function rangeLabel(start: string | null, end: string | null) {
  return `${hour(start)} – ${hour(end)}${start && end && isoDay(start) !== isoDay(end) ? " · next day" : ""}`;
}
const fieldNames: Record<string, string> = {
  starts_at: "arrival",
  ends_at: "departure",
  soc_at_arrival: "arrival charge",
  soc_at_departure: "charge target",
  cycle: "programme",
};
const forecastStates: Record<string, string> = {
  expired: "Expired",
  disabled: "Not in use",
  failed: "Prediction unavailable",
  insufficient_data: "Not enough history",
  ambiguous: "Needs a clearer association",
};
const offerStates: Record<string, string> = {
  incomplete: "Missing information",
  infeasible: "The time window cannot meet the requirement",
  conflict: "Overlapping needs",
  unavailable: "Unavailable for this occurrence",
};
function onDay(entry: Entry, day: string) {
  const from = +new Date(`${day}T00:00:00`),
    end = new Date(`${day}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return entry.start && entry.end
    ? +new Date(entry.start) < +end && +new Date(entry.end) > from
    : isoDay(entry.anchor) === day;
}
function belongs(offer: ChosenOffer, entry: Entry) {
  if (entry.occurrence)
    return (
      offer.event_id === entry.occurrence.event_id &&
      !!offer.occurrence_at &&
      +new Date(offer.occurrence_at) ===
        +new Date(entry.occurrence.occurrence_at)
    );
  if (
    !Object.values(offer.origins).some(
      (o) => o.source === "forecast" && o.reference_id === entry.forecastId,
    )
  )
    return false;
  if (entry.start && entry.end && offer.starts_at && offer.ends_at)
    return (
      +new Date(entry.start) < +new Date(offer.ends_at) &&
      +new Date(entry.end) > +new Date(offer.starts_at)
    );
  return (
    isoDay(
      offer.occurrence_at || offer.starts_at || offer.ends_at || entry.anchor,
    ) === isoDay(entry.anchor)
  );
}
/** Calendar first, a quiet day inspector second. Source emphasis comes only from
 * backend field origins; the browser never chooses a precedence policy. */
export function FlexibilityCalendar({
  equipment,
  actorId,
  initialDay,
  initialMonth,
  initialAsset = "",
  onAction,
  onState,
  refreshTarget,
}: {
  equipment: CalendarEquipment[];
  actorId: string;
  initialDay?: string;
  initialMonth?: string;
  initialAsset?: string;
  onAction: (action: CalendarAction) => void;
  onState?: (state: { day: string; month: string; asset: string }) => void;
  refreshTarget?: HTMLElement;
}) {
  const [day, setDay] = useState(initialDay || dayKey(new Date()));
  const [month, setMonth] = useState(() => {
    const d = new Date(
      initialMonth || `${initialDay || dayKey(new Date())}T12:00:00`,
    );
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [asset, setAsset] = useState(initialAsset),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState<string | null>(null),
    [reload, setReload] = useState(0);
  const [focusedAsset, setFocusedAsset] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false),
    [search, setSearch] = useState("");
  const picker = useRef<HTMLDivElement>(null),
    pickerButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!pickerOpen) return;
    const outside = (event: PointerEvent) => {
      if (picker.current && !event.composedPath().includes(picker.current))
        setPickerOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPickerOpen(false);
        pickerButton.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [pickerOpen]);
  const chooseAsset = (id: string) => {
    setAsset(id);
    setFocusedAsset(null);
    setPreferences(null);
    setPickerOpen(false);
  };
  const chooseDay = (value: string, id: string | null = null) => {
    setDay(value);
    setFocusedAsset(id);
    setPreferences(null);
  };
  const request = useRef<AbortController>();
  const seq = useRef(0);
  const shown = useMemo(
    () => (asset ? equipment.filter((a) => a.id === asset) : equipment),
    [equipment, asset],
  );
  const { start, until, days } = useMemo(() => {
    const s = new Date(month);
    s.setDate(1 - ((s.getDay() + 6) % 7));
    const u = new Date(s);
    u.setDate(u.getDate() + 42);
    return {
      start: s.toISOString(),
      until: u.toISOString(),
      days: Array.from({ length: 42 }, (_, i) => {
        const d = new Date(s);
        d.setDate(d.getDate() + i);
        return d;
      }),
    };
  }, [month]);
  useEffect(() => {
    onState?.({ day, month: month.toISOString(), asset });
  }, [day, month, asset, onState]);
  const load = useCallback(async () => {
    request.current?.abort();
    const abort = new AbortController();
    request.current = abort;
    const current = ++seq.current;
    if (!shown.length) {
      setSnapshot({ occurrences: [], selections: {}, failures: [] });
      setLoading(false);
      return;
    }
    try {
      const chunks = Array.from(
        { length: Math.ceil(shown.length / 100) },
        (_, i) => shown.slice(i * 100, i * 100 + 100),
      );
      const selectable = shown.filter((a) =>
        ["ev_charger", "appliance"].includes(a.kind),
      );
      // Neither read depends on the other. Start both together rather than
      // adding the declared-availability round trip to every calendar load.
      const [declared, results] = await Promise.all([
        Promise.all(
          chunks.map((group) =>
            selectionRequest<{ occurrences: CalendarOccurrence[] }>(
              "/effective",
              {
                method: "POST",
                body: JSON.stringify({
                  asset_ids: group.map((a) => a.id),
                  from: start,
                  until,
                }),
                signal: abort.signal,
              },
            ),
          ),
        ),
        Promise.allSettled(
          selectable.map(
            async (a) =>
              [
                a.id,
                await selectionRequest<ChosenFlexibility>(
                  `/assets/${a.id}/selection?${new URLSearchParams({ from: start, until })}`,
                  { signal: abort.signal },
                ),
              ] as const,
          ),
        ),
      ]);
      if (abort.signal.aborted || current !== seq.current) return;
      const selections: Record<string, ChosenFlexibility> = {};
      const failures: string[] = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled") selections[r.value[0]] = r.value[1];
        else failures.push(selectable[i].name);
      });
      setSnapshot({
        occurrences: declared.flatMap((r) => r.occurrences),
        selections,
        failures,
      });
      setError("");
    } catch (e) {
      if (!abort.signal.aborted) setError((e as Error).message);
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  }, [shown, start, until]);
  useEffect(() => {
    setSnapshot(null);
    setError("");
    setLoading(true);
    void load();
    return () => request.current?.abort();
  }, [load, reload]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "hidden") void load();
    };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    refreshTarget?.addEventListener("flex-calendar-refresh", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      refreshTarget?.removeEventListener("flex-calendar-refresh", refresh);
    };
  }, [load, refreshTarget]);
  const entries = useMemo(() => {
    const rows: Entry[] = (snapshot?.occurrences || []).map((o) => ({
      id: o.occurrence_id,
      assetId: o.asset_id,
      source:
        !o.recurrence || o.exception_action === "modify"
          ? "punctual"
          : "recurrent",
      start: o.starts_at,
      end: o.ends_at,
      anchor: o.occurrence_at,
      occurrence: o,
      selectedFields: [],
      inactive: o.status === "cancelled" || o.resolution === "cancelled",
    }));
    Object.values(snapshot?.selections || {}).forEach((s) =>
      (s.forecast_windows || []).forEach((w, i) => {
        const anchor = w.starts_at || w.occurrence_at || w.ends_at;
        if (!anchor) return;
        rows.push({
          id: `forecast-${s.asset_id}-${i}`,
          assetId: s.asset_id,
          source: "forecast",
          start: w.starts_at,
          end: w.ends_at,
          anchor,
          forecastId: s.forecast?.prediction_id,
          selectedFields: [],
          inactive: s.forecast_state !== "usable",
          forecastState: s.forecast_state,
        });
      }),
    );
    rows.forEach((e) => {
      const origins = (snapshot?.selections[e.assetId]?.offers || [])
        .filter((o) => o.status === "resolved" && belongs(o, e))
        .flatMap((o) => Object.entries(o.origins));
      e.selectedFields = [
        ...new Set(
          origins
            .filter(
              ([, origin]) =>
                origin.source === e.source &&
                origin.reference_id ===
                  (e.source === "forecast"
                    ? e.forecastId
                    : e.occurrence?.event_id),
            )
            .map(([field]) => field),
        ),
      ];
      // The legacy backend still resolves devices outside the EV/washer selection scope.
      if (
        !["ev_charger", "appliance"].includes(
          equipment.find((a) => a.id === e.assetId)?.kind || "",
        ) &&
        e.occurrence?.resolution === "eligible"
      )
        e.selectedFields = ["starts_at", "ends_at"];
    });
    return rows.sort(
      (a, b) =>
        +new Date(a.anchor) - +new Date(b.anchor) ||
        a.source.localeCompare(b.source),
    );
  }, [snapshot, equipment]);
  const selected = entries.filter((e) => onDay(e, day));
  const contextEquipment = focusedAsset
    ? shown.filter((a) => a.id === focusedAsset)
    : shown;
  const selectedOffers = (id: string) =>
    (snapshot?.selections[id]?.offers || []).filter((o) => {
      const anchor = o.occurrence_at || o.starts_at || o.ends_at;
      return (
        anchor &&
        onDay({ start: o.starts_at, end: o.ends_at, anchor } as Entry, day)
      );
    });
  const move = (amount: number) => {
    const d = new Date(month.getFullYear(), month.getMonth() + amount, 1);
    setMonth(d);
    chooseDay(dayKey(d));
  };
  const dayAction = (
    action: CalendarAction["action"],
    assetId: string,
    occurrence?: CalendarOccurrence,
  ) => onAction({ action, assetId, day, occurrence });
  const restore = async (o: CalendarOccurrence) => {
    try {
      await selectionRequest(`/events/${o.event_id}/exceptions`, {
        method: "PUT",
        body: JSON.stringify({
          occurrence_at: o.occurrence_at,
          action: "restore",
          expected_event_revision: o.revision,
          expected_exception_revision: o.exception_revision,
        }),
      });
      setReload((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="availability-workspace">
      <div
        className={`availability-equipment ${equipment.length > 4 ? "has-picker" : ""}`}
        role="group"
        aria-label="Filter flexibility by equipment"
      >
        <button
          className={!asset ? "is-active" : ""}
          aria-pressed={!asset}
          onClick={() => {
            chooseAsset("");
          }}
        >
          <Layers3 size={22} />
          <span>
            All equipment<small>{equipment.length} connected</small>
          </span>
        </button>
        {equipment.length <= 4 ? (
          equipment.map((a) => (
            <button
              key={a.id}
              className={asset === a.id ? "is-active" : ""}
              aria-pressed={asset === a.id}
              onClick={() => chooseAsset(a.id)}
            >
              <EquipmentArt type={a.kind} />
              <span>
                {a.name}
                <small>
                  {a.kind === "ev_charger"
                    ? "EV charging"
                    : a.kind === "appliance"
                      ? "Appliance"
                      : "Equipment"}
                </small>
              </span>
            </button>
          ))
        ) : (
          <div className="availability-equipment-picker" ref={picker}>
            <button
              ref={pickerButton}
              className={`availability-picker-trigger ${asset ? "is-active" : ""}`}
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
              onClick={() => {
                setPickerOpen(!pickerOpen);
                setSearch("");
              }}
            >
              {asset ? (
                <EquipmentArt
                  type={equipment.find((a) => a.id === asset)?.kind}
                />
              ) : (
                <Search size={20} />
              )}
              <span>
                {asset
                  ? equipment.find((a) => a.id === asset)?.name
                  : "Choose equipment"}
              </span>
              <ChevronDown size={16} />
            </button>
            {pickerOpen && (
              <div
                className="availability-picker-menu"
                role="dialog"
                aria-label="Choose equipment"
              >
                <header>
                  <strong>Equipment</strong>
                  <button
                    className="icon-btn"
                    aria-label="Close equipment chooser"
                    onClick={() => {
                      setPickerOpen(false);
                      pickerButton.current?.focus();
                    }}
                  >
                    <X size={16} />
                  </button>
                </header>
                <label className="availability-equipment-search">
                  <Search size={16} />
                  <input
                    autoFocus
                    type="search"
                    aria-label="Search equipment"
                    placeholder="Search equipment…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div className="availability-picker-options">
                  {equipment
                    .filter((a) =>
                      a.name
                        .toLocaleLowerCase()
                        .includes(search.trim().toLocaleLowerCase()),
                    )
                    .map((a) => (
                      <button
                        key={a.id}
                        aria-pressed={asset === a.id}
                        onClick={() => {
                          chooseAsset(a.id);
                          pickerButton.current?.focus();
                        }}
                      >
                        <EquipmentArt type={a.kind} />
                        <span>{a.name}</span>
                        {asset === a.id && <Check size={15} />}
                      </button>
                    ))}
                  {!equipment.some((a) =>
                    a.name
                      .toLocaleLowerCase()
                      .includes(search.trim().toLocaleLowerCase()),
                  ) && <p>No equipment found.</p>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {error && (
        <p className="availability-message" role="alert">
          {snapshot
            ? "Could not update the calendar. Showing the last available information."
            : `Could not load the calendar. ${error}`}
        </p>
      )}
      {!!snapshot?.failures.length && (
        <p className="availability-message" role="status">
          The selected plan is temporarily unavailable for{" "}
          {snapshot.failures.join(", ")}. Your saved availability is shown
          below.
        </p>
      )}
      {loading && (
        <div className="availability-loading">
          <EVChargingLoader compact label="Loading your flexibility…" />
        </div>
      )}
      <div className="availability-layout">
        <section
          className="availability-calendar"
          aria-label="Flexibility calendar"
          aria-busy={loading}
        >
          <header>
            <h2>
              {month.toLocaleDateString("en-GB", {
                month: "long",
                year: "numeric",
              })}
            </h2>
            <div>
              <button
                className="btn text"
                onClick={() => {
                  const now = new Date();
                  setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
                  chooseDay(dayKey(now));
                }}
              >
                Today
              </button>
              <button
                className="icon-btn"
                aria-label="Previous month"
                onClick={() => move(-1)}
              >
                <ChevronLeft size={19} />
              </button>
              <button
                className="icon-btn"
                aria-label="Next month"
                onClick={() => move(1)}
              >
                <ChevronRight size={19} />
              </button>
            </div>
          </header>
          <div className="availability-weekdays">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="availability-days">
            {days.map((date) => {
              const key = dayKey(date),
                rows = entries.filter((e) => onDay(e, key)),
                devices = shown.filter((a) =>
                  rows.some((e) => e.assetId === a.id),
                );
              return (
                <div
                  key={key}
                  className={`availability-day ${date.getMonth() !== month.getMonth() ? "is-outside" : ""} ${day === key ? "is-current" : ""}`}
                >
                  <button
                    className={`availability-date ${key === dayKey(new Date()) ? "is-today" : ""}`}
                    aria-label={dayLabel(key)}
                    aria-pressed={day === key}
                    onClick={() => chooseDay(key)}
                  >
                    <time dateTime={key}>{date.getDate()}</time>
                    <small>
                      {devices.length
                        ? `${devices.length} ${devices.length === 1 ? "device" : "devices"}`
                        : ""}
                    </small>
                  </button>
                  <div className="availability-day-entries">
                    {devices.slice(0, 4).map((a) => (
                      <button
                        key={a.id}
                        className={`availability-entry is-equipment ${day === key && focusedAsset === a.id ? "is-focused" : ""}`}
                        data-calendar-asset={a.id}
                        aria-label={`${a.name} · ${dayLabel(key)}`}
                        aria-pressed={day === key && focusedAsset === a.id}
                        onClick={() => chooseDay(key, a.id)}
                        title={a.name}
                      >
                        <EquipmentArt type={a.kind} />
                        <span className="availability-entry-name">
                          {a.name}
                        </span>
                      </button>
                    ))}
                    {devices.length > 4 && (
                      <button
                        className="availability-more"
                        onClick={() => chooseDay(key)}
                      >
                        +{devices.length - 4} equipment
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        <aside
          className="availability-agenda"
          aria-label="Flexibility for selected day"
        >
          <header>
            <span className="eyebrow">YOUR AVAILABILITY</span>
            <h2>{dayLabel(day)}</h2>
            {focusedAsset && !asset && (
              <button
                className="availability-day-all"
                onClick={() => {
                  setFocusedAsset(null);
                  setPreferences(null);
                }}
              >
                All equipment for this day
              </button>
            )}
          </header>
          {contextEquipment
            .filter(
              (a) =>
                selected.some((e) => e.assetId === a.id) ||
                selectedOffers(a.id).length,
            )
            .map((a) => (
              <section className="availability-device" key={a.id}>
                <header>
                  <EquipmentArt type={a.kind} />
                  <div>
                    <h3>{a.name}</h3>
                    {["ev_charger", "appliance"].includes(a.kind) && (
                      <button
                        className="availability-preferences"
                        onClick={() =>
                          setPreferences(preferences === a.id ? null : a.id)
                        }
                        aria-expanded={preferences === a.id}
                      >
                        Availability preferences
                      </button>
                    )}
                  </div>
                </header>
                {preferences === a.id && (
                  <FlexibilityPreferences
                    onSaved={() => void load()}
                    assetId={a.id}
                    kind={a.kind}
                    canEdit={a.canEdit}
                    from={start}
                    until={until}
                    cycles={a.cycles}
                  />
                )}
                {selectedOffers(a.id).map((o) => (
                  <div
                    key={o.need_id}
                    className={`availability-plan ${o.status === "resolved" ? "" : "has-issue"}`}
                  >
                    <span>
                      {o.status === "resolved" ? (
                        <>
                          <Check size={15} />
                          Window in use
                        </>
                      ) : (
                        offerStates[o.status]
                      )}
                    </span>
                    <strong>
                      {o.starts_at && isoDay(o.starts_at) !== day && (
                        <small>
                          From{" "}
                          {new Date(o.starts_at).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })}
                        </small>
                      )}
                      {rangeLabel(o.starts_at, o.ends_at)}
                    </strong>
                    {o.soc_at_departure !== null && (
                      <small>
                        Charge target {Math.round(o.soc_at_departure * 100)}%
                      </small>
                    )}
                    {o.soc_at_arrival !== null && (
                      <small>
                        Expected arrival charge{" "}
                        {Math.round(o.soc_at_arrival * 100)}%
                      </small>
                    )}
                    {o.cycle && (
                      <small>
                        {o.cycle.name} · {o.cycle.duration_minutes} min ·{" "}
                        {o.cycle.energy_consumption_kwh} kWh
                      </small>
                    )}
                    {o.latest_start && (
                      <small>
                        Start by {hour(o.latest_start)} to finish the cycle
                      </small>
                    )}
                    {o.semantics === "expected_usage" && (
                      <small>
                        Expected use · machine readiness is not confirmed
                      </small>
                    )}
                  </div>
                ))}
                <div className="availability-sources">
                  {selected
                    .filter((e) => e.assetId === a.id)
                    .map((e) => (
                      <article
                        key={e.id}
                        className={`availability-source ${e.selectedFields.length ? "is-used" : ""} ${e.inactive ? "is-inactive" : ""}`}
                        data-source={e.source}
                        data-selected={!!e.selectedFields.length}
                      >
                        <header>
                          <span>
                            {e.source === "forecast" ? (
                              <Sparkles size={14} />
                            ) : e.source === "recurrent" ? (
                              <Repeat2 size={14} />
                            ) : (
                              <span className="availability-dot" />
                            )}
                            {labels[e.source]}
                          </span>
                          {e.selectedFields.length > 0 && (
                            <span className="availability-used">
                              <Check size={12} />
                              Used
                            </span>
                          )}
                        </header>
                        <p>
                          {e.start && isoDay(e.start) !== day && (
                            <small className="availability-previous">
                              From{" "}
                              {new Date(e.start).toLocaleDateString("en-GB", {
                                day: "numeric",
                                month: "short",
                              })}{" "}
                              ·{" "}
                            </small>
                          )}
                          {rangeLabel(e.start, e.end)}
                        </p>
                        {e.selectedFields.length > 0 && (
                          <small>
                            {e.selectedFields
                              .map((f) =>
                                a.kind === "appliance" && f === "starts_at"
                                  ? "start"
                                  : a.kind === "appliance" && f === "ends_at"
                                    ? "finish"
                                    : fieldNames[f] || f,
                              )
                              .join(" · ")}
                          </small>
                        )}
                        {e.source === "forecast" && (
                          <small>
                            {e.forecastState === "usable"
                              ? "Simulated prediction"
                              : forecastStates[e.forecastState || ""] ||
                                "Not used"}
                          </small>
                        )}
                        {e.occurrence?.type_specific_data?.soc_at_departure !=
                          null && (
                          <small>
                            Charge target{" "}
                            {Math.round(
                              e.occurrence.type_specific_data.soc_at_departure *
                                100,
                            )}
                            %
                          </small>
                        )}
                        {e.inactive && e.source !== "forecast" && (
                          <small>Unavailable for this occurrence</small>
                        )}
                        {e.occurrence?.type_specific_data?.duration_minutes !=
                          null && (
                          <small>
                            {e.occurrence.type_specific_data.cycle_snapshot
                              ?.name &&
                              `${e.occurrence.type_specific_data.cycle_snapshot.name} · `}
                            {e.occurrence.type_specific_data.duration_minutes}{" "}
                            min{" "}
                            {a.kind === "water_pump"
                              ? "required running time"
                              : "cycle"}
                          </small>
                        )}
                        {e.occurrence?.type_specific_data?.setpoint != null && (
                          <small>
                            Target {e.occurrence.type_specific_data.setpoint} °C
                          </small>
                        )}
                        {e.occurrence?.resolution === "needs_attention" && (
                          <small>Check the time window and requirements.</small>
                        )}
                        {e.occurrence?.resolution === "conflict" && (
                          <small>Overlapping requests need attention.</small>
                        )}
                        {e.occurrence &&
                          a.canEdit &&
                          e.occurrence.created_by === actorId && (
                            <div className="availability-source-actions">
                              {!e.inactive && (
                                <>
                                  <button
                                    onClick={() =>
                                      dayAction("edit", a.id, e.occurrence)
                                    }
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() =>
                                      dayAction("cancel", a.id, e.occurrence)
                                    }
                                  >
                                    Cancel
                                  </button>
                                </>
                              )}
                              {!!e.occurrence.exception_revision &&
                                e.occurrence.exception_action !== "restore" && (
                                  <button
                                    onClick={() => void restore(e.occurrence!)}
                                  >
                                    Remove date-specific change
                                  </button>
                                )}
                            </div>
                          )}
                      </article>
                    ))}
                </div>
              </section>
            ))}
          {!selected.length && !loading && (
            <div className="availability-empty">
              <EquipmentArt type={asset ? shown[0]?.kind : "ev_charger"} />
              <h3>
                {error ? "Calendar unavailable" : "No plans for this day"}
              </h3>
              <p>
                {error
                  ? "Your saved plans will appear when the connection is restored."
                  : "Add the time your equipment is available."}
              </p>
            </div>
          )}
          {contextEquipment.some((a) => a.canEdit) && (
            <button
              className="btn primary availability-add"
              onClick={() => dayAction("create", asset || focusedAsset || "")}
            >
              <Plus size={17} />
              Plan something
            </button>
          )}
        </aside>
      </div>
      <p className="availability-timezone">
        Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}.
      </p>
    </div>
  );
}
