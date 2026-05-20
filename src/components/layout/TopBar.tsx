import {
  Bell,
  Boxes,
  ChevronDown,
  FlaskConical,
  FileText,
  Settings2
} from "lucide-react";
import { useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { AI_AVATAR_URL, APP_NAME } from "../../constants";
import { useAuth } from "../../contexts/AuthContext";
import { useUI } from "../../contexts/UIContext";
import { getProsumerBuildingScopes, getProsumerScopeForEntity } from "../../data/energyCommunity";
import { isCommunityUserRole, isKpiManagerRole, isPredictorRole, isTrainingManagerRole } from "../../utils/roles";
import { ThemeToggle } from "../ui/ThemeToggle";
import { NotificationPanel } from "./NotificationPanel";
import { UserMenu } from "./UserMenu";

const AI_TABS = [
  { to: "/app/ai/jobs", label: "Jobs" },
  { to: "/app/ai/datasets", label: "Datasets" },
  { to: "/app/ai/configs", label: "Experiment Configs" }
];

const AI_TABS_WITH_DEPLOY = [...AI_TABS, { to: "/app/ai/deploy", label: "Deploy" }];

const PREDICTOR_TABS = [
  { to: "/app/predictor", label: "Predict" },
  { to: "/app/predictor/train", label: "Train" },
  { to: "/app/predictor/logs", label: "Logs" },
  { to: "/app/predictor/analysis", label: "Analysis" },
];

const KPI_TABS = [
  { to: "/app/kpi-manager/dashboard", label: "Dashboard" },
  { to: "/app/kpi-manager/compare", label: "Compare" },
  { to: "/app/kpi-manager/correlations", label: "Correlations" },
  { to: "/app/kpi-manager/scheduler", label: "Scheduler" },
  { to: "/app/kpi-manager/thresholds", label: "Thresholds" },
  { to: "/app/kpi-manager/reports", label: "Reports" },
  { to: "/app/kpi-manager/data-health", label: "Data Health" },
  { to: "/app/kpi-manager/explorer", label: "Explorer" },
  { to: "/app/kpi-manager/library", label: "Library" },
];

const COMMUNITY_TABS = [
  { to: "/app/community/dashboard", label: "Dashboard" },
  { to: "/app/community/topology", label: "Topology" },
  { to: "/app/community/logs", label: "Logs" }
];

const PROSUMER_TABS = [...COMMUNITY_TABS, { to: "/app/community/flexibility", label: "Flexibility" }];

export function TopBar(): JSX.Element {
  const { session } = useAuth();
  const { activeCommunity, selectedEntityId, unreadCount } = useUI();
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const isTrainingManager = isTrainingManagerRole(session?.role);
  const isPredictor = isPredictorRole(session?.role);
  const isKpiManager = isKpiManagerRole(session?.role);
  const isCommunityUser = isCommunityUserRole(session?.role);
  const isProsumer = session?.role === "prosumer";
  const prosumerScopes = isProsumer ? getProsumerBuildingScopes(activeCommunity) : [];
  const prosumerScope = isProsumer ? getProsumerScopeForEntity(activeCommunity, selectedEntityId) : null;

  const tabs = isTrainingManager
    ? session?.role === "training_manager"
      ? AI_TABS_WITH_DEPLOY
      : AI_TABS
    : isPredictor
      ? PREDICTOR_TABS
      : isKpiManager
        ? KPI_TABS
        : isCommunityUser
          ? session?.role === "prosumer"
            ? PROSUMER_TABS
            : COMMUNITY_TABS
          : [{ to: "/app/logs", label: "Logs" }];
  const brandLink = isTrainingManager
    ? "/app/ai/jobs"
    : isPredictor
      ? "/app/predictor"
      : isKpiManager
        ? "/app/kpi-manager"
        : isProsumer
          ? "/app/community/dashboard"
          : "/communities";
  const avatarFallback = session?.name?.split(" ").map((part) => part[0]).slice(0, 2).join("") || "U";

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link className="brand" to={brandLink}>
          <img
            className="brand-logo brand-logo-light"
            src="/assets/logos/energaize-light.png"
            alt={APP_NAME}
          />
          <img
            className="brand-logo brand-logo-dark"
            src="/assets/logos/energaize-dark.png"
            alt={APP_NAME}
          />
        </Link>

        {isCommunityUser ? (
          <div className="community-context">
            {isProsumer ? (
              prosumerScopes.length > 1 ? (
                <button
                  className="community-context-main"
                  type="button"
                  title="Change building"
                  onClick={() => navigate("/communities")}
                >
                  <span className="community-context-copy">
                    <small>My building</small>
                    <strong>{prosumerScope?.label ?? "Choose building"}</strong>
                  </span>
                  <ChevronDown size={15} />
                </button>
              ) : (
                <div className="community-context-main is-static" title={prosumerScope?.label ?? "My building"}>
                  <span className="community-context-copy">
                    <small>My building</small>
                    <strong>{prosumerScope?.label ?? activeCommunity.name}</strong>
                  </span>
                </div>
              )
            ) : (
              <button
                className="community-context-main"
                type="button"
                title="Change community"
                onClick={() => navigate("/communities")}
              >
                <span className="community-context-copy">
                  <small>Community</small>
                  <strong>{activeCommunity.name}</strong>
                </span>
                <ChevronDown size={15} />
              </button>
            )}
          </div>
        ) : null}
      </div>

      <nav className="topbar-nav" aria-label="Primary navigation">
        {tabs.length > 0 ? (
          tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === "/app/predictor" || tab.to === "/app/kpi-manager/dashboard"}
              className={({ isActive }) => `top-tab${isActive ? " is-active" : ""}`}
            >
              {tab.label}
            </NavLink>
          ))
        ) : (
          <span className="topbar-nav-placeholder">Menu (mock)</span>
        )}
      </nav>

      <div className="topbar-right">
        {isTrainingManager ? (
          <>
            <a
              className="icon-btn"
              href="http://193.136.62.78:5000/#/"
              target="_blank"
              rel="noreferrer"
              title="Open MLflow Tracking"
              aria-label="Open MLflow Tracking"
            >
              <FlaskConical size={16} />
            </a>

            <a
              className="icon-btn"
              href="https://193.136.62.78:9443/"
              target="_blank"
              rel="noreferrer"
              title="Open Portainer"
              aria-label="Open Portainer"
            >
              <Boxes size={16} />
            </a>
          </>
        ) : null}

        {!isKpiManager && !isCommunityUser ? (
          <Link className={`icon-btn${location.pathname === "/app/logs" ? " is-active" : ""}`} to="/app/logs" title="Logs">
            <FileText size={16} />
          </Link>
        ) : null}

        <button
          className="icon-btn notif-trigger"
          type="button"
          title="Notifications"
          onClick={() => {
            setNotifOpen((prev) => !prev);
            setUserOpen(false);
          }}
        >
          <Bell size={16} />
          {unreadCount > 0 ? <span className="notif-dot">{Math.min(unreadCount, 9)}</span> : null}
        </button>

        <ThemeToggle />

        <button
          className="avatar-btn"
          type="button"
          onClick={() => {
            setUserOpen((prev) => !prev);
            setNotifOpen(false);
          }}
        >
          <span className="avatar-media">
            {isTrainingManager ? (
              <img src={AI_AVATAR_URL} alt={session?.name ?? "User"} />
            ) : (
              avatarFallback
            )}
          </span>
          <Settings2 size={14} />
        </button>

        <NotificationPanel open={notifOpen} onClose={() => setNotifOpen(false)} />
        <UserMenu open={userOpen} onClose={() => setUserOpen(false)} />
      </div>
    </header>
  );
}
