import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { isKpiManagerRole, isPredictorRole, isTrainingManagerRole } from "../../utils/roles";
import { useUI } from "../../contexts/UIContext";
import { useAlerts } from "../../hooks/useAlerts";
import { CommunityTree } from "./CommunityTree";
import { InstitutionalDock } from "./InstitutionalDock";
import { TopBar } from "./TopBar";
import { ToastStack } from "./ToastStack";
import { listHosts } from "../../api/trainingApi";
import { HOSTS_POLL_MS } from "../../constants";

export function AppShell(): JSX.Element {
  const location = useLocation();
  const { session } = useAuth();
  const { activeCommunity, pushNotification } = useUI();
  const unionAuthNoticeRef = useRef<string | null>(null);
  const isTiago = session?.email.trim().toLowerCase() === "tiago.fonseca@energaize.io";
  const hostsQuery = useQuery({
    queryKey: ["hosts"],
    queryFn: listHosts,
    refetchInterval: HOSTS_POLL_MS,
    enabled: isTiago
  });

  useEffect(() => {
    if (!isTiago) return;
    const auth = hostsQuery.data?.hosts?.["union-inesctec"]?.info?.union_auth;
    if (!auth || typeof auth !== "object") return;
    const state = auth as { status?: string; user_code?: string; updated_at?: number };
    if (state.status !== "authentication_required") {
      unionAuthNoticeRef.current = null;
      return;
    }
    const noticeKey = `${state.user_code || "required"}:${state.updated_at || ""}`;
    if (unionAuthNoticeRef.current === noticeKey) return;
    unionAuthNoticeRef.current = noticeKey;
    pushNotification({
      title: "Union authentication required",
      message: "Open the Union INESC TEC host details to complete authentication.",
      severity: "warning",
      source: "union-inesctec"
    });
  }, [hostsQuery.data, isTiago, pushNotification]);

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
