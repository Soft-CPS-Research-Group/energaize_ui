import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useLocation } from "react-router-dom";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { isKpiManagerRole, isPredictorRole, isTrainingManagerRole } from "../../utils/roles";
import { useUI } from "../../contexts/UIContext";
import { useAlerts } from "../../hooks/useAlerts";
import { CommunityTree } from "./CommunityTree";
import CommunityList from "../community-tree/CommunityList";
import { InstitutionalDock } from "./InstitutionalDock";
import { TopBar } from "./TopBar";
import { ToastStack } from "./ToastStack";
import { listHosts } from "../../api/trainingApi";
import { HOSTS_POLL_MS } from "../../constants";
import GraphicsView from "../../pages/community/Dashboard/GraphicsView";
import type { EnergyCommunity } from "../../models/energy.model";
import type { SelectedEquipment } from "../../models/energy.selectedEquipment";

interface AppShellProps {
  communityData: EnergyCommunity | null;
  selectedEquipment: SelectedEquipment[] | null;
  setSelectedEquipment: (equipment: SelectedEquipment[]) => void;
  onCommunityChange: (community: EnergyCommunity) => void;
}

export function AppShell({
                           communityData,
                           selectedEquipment,
                           setSelectedEquipment,
                           onCommunityChange,
                         }: AppShellProps): JSX.Element {
  const location = useLocation();
  const { session } = useAuth();
  const { activeCommunity, pushNotification } = useUI();
  const unionAuthNoticeRef = useRef<string | null>(null);
  const isTiago = session?.email.trim().toLowerCase() === "tiago.fonseca@energaize.io";
  const isRecManager = session?.role === "rec_manager";
  const [showAssetTree, setShowAssetTree] = useState(true);

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
  const isDashboardRoute = location.pathname.startsWith("/app/community/dashboard");

  const [dashboardVisited, setDashboardVisited] = useState(false);

  useEffect(() => {
    if (isDashboardRoute) setDashboardVisited(true);
  }, [isDashboardRoute]);

  return (
      <div className="app-shell">
        <TopBar />

        <div className={`app-body${showTree ? "" : " no-tree"}`}>
          {showTree ? (
              isRecManager ? (
                  <div style={{ position: "relative", height: "100%", flexShrink: 0, zIndex: 20 }}>
                    {isDashboardRoute && (
                        <button
                            className="sidebar-edge-toggle"
                            type="button"
                            onClick={() => setShowAssetTree((prev) => !prev)}
                            title={showAssetTree ? "Ocultar painel" : "Mostrar painel"}
                            aria-label="Alternar painel lateral"
                            style={{
                              position: "absolute",
                              top: "18px",
                              left: showAssetTree ? "264px" : "0px",
                              zIndex: 60,
                              borderRadius: showAssetTree ? "50%" : "0 8px 8px 0",
                              transition: "left 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
                            }}
                        >
                          {showAssetTree ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
                        </button>
                    )}

                    <motion.div
                        className="tree-column-wrapper"
                        initial={false}
                        animate={{
                          width: showAssetTree ? 280 : 0,
                        }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        style={{
                          height: "100%",
                          overflow: "hidden",
                        }}
                    >
                      {isDashboardRoute && (
                          <div
                              className="sidebar-fixed-content"
                              style={{ opacity: showAssetTree ? 1 : 0, transition: "opacity 0.2s ease" }}
                          >
                            <CommunityList
                                community={communityData}
                                selectedItems={selectedEquipment ?? []}
                                onSelectionChange={setSelectedEquipment}
                            />
                          </div>
                      )}
                    </motion.div>
                  </div>
              ) : (
                  <CommunityTree />
              )
          ) : null}

          <div className="workspace-main">
            {dashboardVisited && (
                <div style={{ display: isDashboardRoute ? "contents" : "none" }}>
                  <GraphicsView
                      onCommunityChange={onCommunityChange}
                      selectedEquipment={isRecManager ? selectedEquipment : null}
                      setSelectedEquipment={setSelectedEquipment}
                  />
                </div>
            )}

            {!isDashboardRoute && (
                <motion.div
                    key={location.pathname}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  <Outlet />
                </motion.div>
            )}
          </div>
        </div>

        <ToastStack />
        <InstitutionalDock />
      </div>
  );
}