import { useState, useEffect } from "react";
import { Route, Routes, useLocation, Navigate } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { usePredictorHouses } from "../hooks/usePredictor";
import { PredictView } from "./ai/predictor/PredictView";
import { TrainView } from "./ai/predictor/TrainView";
import { LogsView } from "./ai/predictor/LogsView";
import { EVChargingLoader } from "../components/ui/EVChargingLoader";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { Settings } from "lucide-react";
import { Modal } from "../components/ui/Modal";

export function PredictorWorkspacePage(): JSX.Element {
  const location = useLocation();
  const isLogsTab = location.pathname.endsWith("/logs");
  const [selectedHouse, setSelectedHouse] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string>("Europe/Lisbon");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { data: housesData, isLoading: housesLoading, error } = usePredictorHouses();
  const houses = Array.isArray(housesData) ? housesData : (housesData as any)?.houses || [];

  useEffect(() => {
    if (houses && houses.length > 0 && !selectedHouse) {
      setSelectedHouse(houses[0]);
    }
  }, [houses, selectedHouse]);

  if (housesLoading) {
    return (
      <div className="predictor-workspace-loading">
        <EVChargingLoader label="Discovering houses in predictor cluster..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="predictor-workspace-loading">
        <EmptyState
          title="Predictor Service Offline"
          message="Could not connect to the predictor microservice API. Please verify that the microservice is running locally."
          action={<Button onClick={() => window.location.reload()}>Retry Connection</Button>}
        />
      </div>
    );
  }

  return (
    <div className="page predictor-workspace">
      <PageHeader
        title="Consumption Predictor"
        subtitle="Manage energy consumption & production forecasting models and predictions."
      />

      <div className="predictor-toolbar">
        <div className="predictor-toolbar-end">
          {!isLogsTab && (
            <select
              value={selectedHouse || ""}
              onChange={(e) => setSelectedHouse(e.target.value)}
              className="predictor-house-select"
            >
              {!selectedHouse && <option value="" disabled>Select house…</option>}
              {houses?.map((house: string) => (
                <option key={house} value={house}>{house}</option>
              ))}
            </select>
          )}
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
      </div>

      <div className="predictor-content">
        <Routes>
          <Route path="/" element={<PredictView selectedHouseId={selectedHouse} timezone={timezone} />} />
          <Route path="/train" element={<TrainView selectedHouseId={selectedHouse} />} />
          <Route path="/logs" element={<LogsView />} />
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
              Controls how timestamps are displayed on the forecast chart X-axis.
            </span>
          </label>
        </div>
      </Modal>
    </div>
  );
}
