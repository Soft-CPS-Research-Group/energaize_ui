import { useEffect, useState, type FormEvent } from "react";
import {
  selectionRequest,
  type SelectionPolicy,
  type SelectionSettings,
} from "../api/flexibilitySelection";
const defaults: SelectionSettings = {
  base_window_kind: "required",
  required_departure_time: null,
  default_soc_at_departure: null,
  default_cycle_id: null,
};
/** Equipment-level preferences, opened in context rather than a technical rules screen. */
export function FlexibilityPreferences({
  assetId,
  kind,
  canEdit,
  from,
  until,
  cycles,
  onSaved,
}: {
  assetId: string;
  kind: string;
  canEdit: boolean;
  from: string;
  until: string;
  cycles: Array<{ id: string; name: string }>;
  onSaved: () => void;
}) {
  const [policy, setPolicy] = useState<SelectionPolicy | null>(null),
    [settings, setSettings] = useState(defaults);
  const [enabled, setEnabled] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const base = `/assets/${encodeURIComponent(assetId)}`;
  useEffect(() => {
    const abort = new AbortController();
    setPolicy(null);
    setError("");
    setNotice("");
    selectionRequest<SelectionPolicy>(`${base}/policy`, {
      signal: abort.signal,
    })
      .then((p) => {
        if (!abort.signal.aborted) {
          setPolicy(p);
          setSettings({ ...defaults, ...p.settings.selection });
          setEnabled(p.settings.forecast_enabled);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [base]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!policy || !canEdit || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await selectionRequest<SelectionPolicy>(`${base}/policy`, {
        method: "PUT",
        body: JSON.stringify({
          expected_revision: policy.revision,
          settings: {
            ...policy.settings,
            forecast_enabled: enabled,
            selection: settings,
          },
        }),
      });
      setPolicy(next);
      await selectionRequest(`${base}/selection`, {
        method: "POST",
        body: JSON.stringify({ asset_ids: [assetId], from, until }),
      });
      setNotice("Preferences saved.");
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="availability-preferences-form"
      aria-label="Availability preferences"
      onSubmit={save}
    >
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!policy && !error && <p role="status">Loading preferences…</p>}
      {policy && (
        <fieldset disabled={!canEdit || busy}>
          <label>
            Recurring times
            <select
              value={settings.base_window_kind}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  base_window_kind: e.target
                    .value as SelectionSettings["base_window_kind"],
                })
              }
            >
              <option value="required">Must stay within these hours</option>
              <option value="habitual">
                Usual times · predictions can refine them
              </option>
            </select>
          </label>
          {kind === "ev_charger" ? (
            <>
              <label>
                Car needed by · optional
                <input
                  type="time"
                  value={settings.required_departure_time || ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      required_departure_time: e.target.value || null,
                    })
                  }
                />
              </label>
              <label>
                Usual charge target (%)
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={
                    settings.default_soc_at_departure === null
                      ? ""
                      : Math.round(settings.default_soc_at_departure * 100)
                  }
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      default_soc_at_departure:
                        e.target.value === ""
                          ? null
                          : Number(e.target.value) / 100,
                    })
                  }
                />
              </label>
              <p>
                The target completes predictions without a saved request. A
                one-off request can set its own time and target.
              </p>
            </>
          ) : (
            <>
              <label>
                Usual programme · optional
                <select
                  value={settings.default_cycle_id || ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      default_cycle_id: e.target.value || null,
                    })
                  }
                >
                  <option value="">No default programme</option>
                  {cycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                Predictions estimate when you usually wash. They keep the
                selected programme and cycle length.
              </p>
            </>
          )}
          <label className="availability-check">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Use valid predictions
          </label>
          {canEdit && (
            <button className="btn primary" type="submit">
              {busy ? "Saving…" : "Save preferences"}
            </button>
          )}
        </fieldset>
      )}
    </form>
  );
}
