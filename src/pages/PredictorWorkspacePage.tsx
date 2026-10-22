import { useState, useEffect } from "react";
import { Route, Routes, useLocation, Navigate } from "react-router-dom";
import { usePredictorHouses } from "../hooks/usePredictor";
import { usePredictorScope, usePredictorWorkspace } from "../contexts/PredictorWorkspaceContext";
import { LABORATORY_WORKSPACE_ID, type CommunityHouses } from "./ai/predictor/workspaceScope";
import { InfoTip } from "../components/ui/InfoTip";
import { PredictView } from "./ai/predictor/PredictView";
import { TrainView } from "./ai/predictor/TrainView";
import { LogsView } from "./ai/predictor/LogsView";
import { AnalysisView } from "./ai/predictor/AnalysisView";
import { EVChargingLoader } from "../components/ui/EVChargingLoader";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { Settings } from "lucide-react";
import { Modal } from "../components/ui/Modal";
import { readStorage, writeStorage, STORAGE_KEYS } from "../utils/storage";
import { PredictorHealthStatus } from "./ai/predictor/PredictorHealthStatus";

const TAB_COPY = {
  Predict: "Forecasts for the next 24 hours, refreshed every 15 minutes.",
  Train: "Retrain a house's models and follow the job until it finishes.",
  Logs: "Live log stream from the forecasting service.",
  Analysis: "Compare stored models and choose which one each house uses.",
} as const;

/** "House 3 has no measurement source. Building B (R-H-09) is not forecast." for the sites a community workspace cannot show. */
function hiddenSitesText(detail: CommunityHouses): string {
  const name = (site: { name?: string; id: string }) => site.name || site.id;
  const parts = [
    ...detail.unlinked.map((site) => `${name(site)} has no measurement source in its site settings.`),
    ...detail.notForecast.map(({ site, houseId }) => `${name(site)} (${houseId}) is not forecast by the predictor.`),
  ];
  return parts.join(" ");
}

export function PredictorWorkspacePage(): JSX.Element {
  const location = useLocation();
  const isLogsTab     = location.pathname.endsWith("/logs");
  const isTrainTab    = location.pathname.endsWith("/train");
  const isAnalysisTab = location.pathname.endsWith("/analysis");
  const heroTitle     = isLogsTab ? "Logs" : isTrainTab ? "Train" : isAnalysisTab ? "Analysis" : "Predict";
  const [selectedHouse, setSelectedHouseState] = useState<string | null>(
    () => readStorage<string | null>(STORAGE_KEYS.predictorHouse, null)
  );

  function setSelectedHouse(house: string | null) {
    setSelectedHouseState(house);
    if (house) writeStorage(STORAGE_KEYS.predictorHouse, house);
  }
  const [timezone, setTimezoneState] = useState<string>(
    () => readStorage<string>(STORAGE_KEYS.predictorTimezone, "Europe/Lisbon")
  );

  function setTimezone(value: string) {
    setTimezoneState(value);
    writeStorage(STORAGE_KEYS.predictorTimezone, value);
  }
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { isLoading: housesLoading, error, refetch, isFetching } = usePredictorHouses();
  const workspace = usePredictorWorkspace();
  // Only the houses of the workspace chosen in the top bar; the Laboratory has every house.
  const { houses, community, detail } = usePredictorScope();

  useEffect(() => {
    if (!houses || houses.length === 0) return;
    // If stored house is still valid, keep it; otherwise default to first
    if (selectedHouse && houses.includes(selectedHouse)) return;
    setSelectedHouse(houses[0]);
  }, [houses]);

  if (housesLoading || workspace.loading) {
    return (
      <div className="predictor-workspace-loading">
        <EVChargingLoader label={housesLoading ? "Discovering houses in predictor cluster..." : "Loading the community's houses..."} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="predictor-workspace-loading">
        <EmptyState
          title="Forecasting service unreachable"
          message="The predictor did not answer. It may be offline or restarting; forecasts and training are unavailable until it is back."
          action={<Button onClick={() => refetch()} disabled={isFetching}>{isFetching ? "Retrying…" : "Try again"}</Button>}
        />
      </div>
    );
  }

  if (workspace.error) {
    return (
      <div className="predictor-workspace-loading">
        <EmptyState
          title="Community service unreachable"
          message={`The community's sites could not be loaded (${workspace.error}), so its houses are unknown. The Laboratory still shows every house.`}
          action={
            <div className="predictor-empty-actions">
              <Button onClick={workspace.retry}>Try again</Button>
              <Button variant="secondary" onClick={() => workspace.select(LABORATORY_WORKSPACE_ID)}>Open the Laboratory</Button>
            </div>
          }
        />
      </div>
    );
  }

  if (community && detail && houses.length === 0) {
    const hidden = hiddenSitesText(detail);
    return (
      <div className="predictor-workspace-loading">
        <EmptyState
          title={`No houses of ${community.name} are forecast`}
          message={
            (detail.unlinked.length + detail.notForecast.length === 0
              ? "This community has no sites yet."
              : `A site shows here when its measurement source (perceptor-site) is set in the site settings and the predictor forecasts that house. ${hidden}`)
          }
          action={<Button variant="secondary" onClick={() => workspace.select(LABORATORY_WORKSPACE_ID)}>Open the Laboratory</Button>}
        />
      </div>
    );
  }

  const hiddenSites = detail ? detail.unlinked.length + detail.notForecast.length : 0;

  return (
    <div className="page predictor-workspace">
      <header className="jobs-hero ai-jobs-heading predictor-heading">
        <div className="ai-heading-copy">
          <span className="ai-ceramic-compute predictor-ceramic-art" aria-hidden="true" />
          <div>
            <span className="ai-eyebrow">Forecasting service{community ? ` · ${community.name}` : ""}</span>
            <h1>{heroTitle}</h1>
            <p>{TAB_COPY[heroTitle]}</p>
            {community && detail && (
              <p className="predictor-scope-note">
                {houses.length} {houses.length === 1 ? "house" : "houses"} of {community.name}
                {hiddenSites > 0 && (
                  <>
                    {" "}· {hiddenSites} {hiddenSites === 1 ? "site" : "sites"} not shown{" "}
                    <InfoTip tip={hiddenSitesText(detail)} width={300} />
                  </>
                )}
              </p>
            )}
          </div>
        </div>

        <div className="ai-heading-actions predictor-heading-actions">
          {!isLogsTab && !isAnalysisTab && (
            <select
              value={selectedHouse || ""}
              onChange={(e) => setSelectedHouse(e.target.value)}
              className="predictor-house-select"
              aria-label="House"
            >
              {!selectedHouse && <option value="" disabled>Select house…</option>}
              {houses?.map((house: string) => (
                <option key={house} value={house}>{house}</option>
              ))}
            </select>
          )}
          <PredictorHealthStatus timezone={timezone} />
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Settings size={14} />}
            iconOnly
            onClick={() => setSettingsOpen(true)}
          >
            Settings
          </Button>
        </div>
      </header>

      <div className="predictor-content">
        <Routes>
          <Route path="/" element={<PredictView selectedHouseId={selectedHouse} timezone={timezone} />} />
          <Route path="/train" element={<TrainView selectedHouseId={selectedHouse} timezone={timezone} />} />
          <Route path="/logs" element={<LogsView timezone={timezone} />} />
          <Route path="/analysis" element={<AnalysisView timezone={timezone} />} />
          <Route path="*" element={<Navigate to="/app/predictor" replace />} />
        </Routes>
      </div>

      <Modal title="Predictor Settings" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <div className="form-grid">
          <label className="full-col">
            <span>Timezone Display</span>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              <option value="Europe/Lisbon">Europe/Lisbon (PT)</option>
              <option value="Europe/London">Europe/London</option>
              <option value="Europe/Madrid">Europe/Madrid</option>
              <option value="Europe/Paris">Europe/Paris</option>
              <option value="Europe/Berlin">Europe/Berlin</option>
              <option value="UTC">UTC</option>
            </select>
            <span style={{ fontSize: "0.8rem", color: "var(--text-soft)" }}>
              Used for times on the forecast chart, training jobs and the service status. Saved in this browser.
            </span>
          </label>
        </div>
      </Modal>
    </div>
  );
}
