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

  // Auto-select the first house on component mount when houses become available
  useEffect(() => {
    if (houses && houses.length > 0 && !selectedHouse) {
      setSelectedHouse(houses[0]);
    }
  }, [houses, selectedHouse]);

  if (housesLoading) {
    return (
      <div className="page flex h-full items-center justify-center">
         <EVChargingLoader label="Discovering houses in predictor cluster..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page flex h-full items-center justify-center">
        <EmptyState 
          title="Predictor Service Offline" 
          message="Could not connect to the predictor microservice API. Please verify that the microservice is running locally."
          action={<Button onClick={() => window.location.reload()}>Retry Connection</Button>}
        />
      </div>
    );
  }

  return (
    <div className="page flex flex-col h-full space-y-4">
      <PageHeader 
        title="Consumption Predictor" 
        subtitle="Manage energy consumption & production forecasting models and predictions."
        actions={
          <div className="toolbar">
              <select
                value={selectedHouse || ""}
                onChange={(e) => setSelectedHouse(e.target.value)}
                className="input"
                disabled={isLogsTab} // Logs are global, hide context change
              >
                {!selectedHouse && <option value="" disabled>Select House...</option>}
                {houses?.map((house: string) => (
                  <option key={house} value={house}>
                    {house}
                  </option>
                ))}
              </select>
              <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
                <Settings size={16} />
              </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto w-full p-4">
         <Routes>
           <Route path="/" element={<PredictView selectedHouseId={selectedHouse} timezone={timezone} />} />
           <Route path="/train" element={<TrainView selectedHouseId={selectedHouse} />} />
           <Route path="/logs" element={<LogsView />} />
           <Route path="*" element={<Navigate to="/app/predictor" replace />} />
         </Routes>
      </div>

      <Modal title="Predictor Settings" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", paddingBottom: "16px" }}>
          <div>
            <label style={{ display: "block", marginBottom: "8px", fontWeight: "bold" }}>Timezone Display</label>
            <select 
              value={timezone} 
              onChange={(e) => setTimezone(e.target.value)} 
              className="input" 
              style={{ width: "100%", padding: "10px 14px", backgroundColor: "var(--bg-subtle)", color: "inherit", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "0.875rem", cursor: "pointer", outline: "none", appearance: "none" }}
            >
              <option value="Europe/Lisbon">Europe/Lisbon (PT)</option>
              <option value="Europe/London">Europe/London</option>
              <option value="Europe/Madrid">Europe/Madrid</option>
              <option value="Europe/Paris">Europe/Paris</option>
              <option value="Europe/Berlin">Europe/Berlin</option>
              <option value="UTC">UTC</option>
            </select>
            <div style={{ fontSize: "0.8rem", opacity: 0.7, marginTop: "8px" }}>
              Controls how future predictions and history bounds are formatted on the X-Axis. Default supports Portugal.
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
