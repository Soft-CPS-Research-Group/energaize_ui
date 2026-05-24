import { motion } from "framer-motion";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { isKpiManagerRole, isPredictorRole, isTrainingManagerRole } from "../../utils/roles";
import { useUI } from "../../contexts/UIContext";
import { useAlerts } from "../../hooks/useAlerts";
import { CommunityTree } from "./CommunityTree";
import { InstitutionalDock } from "./InstitutionalDock";
import { TopBar } from "./TopBar";
import { ToastStack } from "./ToastStack";

export function AppShell(): JSX.Element {
  const location = useLocation();
  const { session } = useAuth();
  const { activeCommunity, pushNotification } = useUI();

  useAlerts({
    community: activeCommunity?.id || "living_lab",
    enabled: location.pathname.startsWith("/app/kpi-manager"),
    onNewAlert: (alert) => {
      try {
        const val = Number(alert.value);
        const valStr = isNaN(val) ? String(alert.value) : val.toFixed(3);
        pushNotification({
          title: `KPI Alert: ${alert.kpi || "Unknown"}`,
          message: `${alert.scope || "Unknown"} breached threshold. Value: ${valStr}`,
          severity: alert.severity === "critical" ? "error" : (alert.severity || "warning") as any,
        });
      } catch (e) {
        console.error("Failed to push notification for alert:", alert, e);
      }
    },
  });

  const hideTree =
    isTrainingManagerRole(session?.role) ||
    isPredictorRole(session?.role) ||
    isKpiManagerRole(session?.role) ||
    location.pathname.startsWith("/app/community/topology");
  const showTree = !hideTree;

  return (
    <div className="app-shell">
      <TopBar />

      <div className={`app-body${showTree ? "" : " no-tree"}`}>
        {showTree ? <CommunityTree /> : null}

        <motion.main
          key={location.pathname}
          className="workspace-main"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <Outlet />
        </motion.main>
      </div>

      <ToastStack />
      <InstitutionalDock />
    </div>
  );
}
