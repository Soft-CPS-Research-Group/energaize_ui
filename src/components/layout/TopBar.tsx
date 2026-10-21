import { TRAINING_ENABLED } from '../../api/trainingContext';
import { TrainingWorkspaceSelector } from '../../contexts/TrainingWorkspaceContext';
import {
  Bell,
  Boxes,
  ChevronDown,
  FlaskConical,
  FileText
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { APP_NAME } from "../../constants";
import { useAuth } from "../../contexts/AuthContext";
import { useUI } from "../../contexts/UIContext";
import { isCommunityUserRole, isKpiManagerRole, isPredictorRole, isTrainingManagerRole } from "../../utils/roles";
import { ThemeToggle } from "../ui/ThemeToggle";
import { NotificationPanel } from "./NotificationPanel";
import { ProfileAvatar } from "../ui/ProfileAvatar";
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
  { to: '/app/community/dashboard', label: 'Overview' },
  { to: '/app/community/inventory', label: 'Inventory' },
  { to: '/app/community/flexibility', label: 'Flexibility' },
];
const PROSUMER_TABS = [
  { to: '/app/community/dashboard', label: 'Overview' },
  { to: '/app/community/equipment', label: 'Equipment' },
  { to: '/app/community/vehicles', label: 'My vehicles' },
  { to: '/app/community/flexibility', label: 'Flexibility' }
];

export function TopBar(): JSX.Element {
  const { session } = useAuth();
  const { unreadCount } = useUI();
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const location = useLocation();
  const toolsRef = useRef<HTMLDivElement>(null);
  const userTriggerRef = useRef<HTMLButtonElement>(null);
  const notificationTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { setUserOpen(false); setNotifOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!userOpen && !notifOpen) return;
    const outside = (event: PointerEvent) => {
      if (!toolsRef.current?.contains(event.target as Node)) { setUserOpen(false); setNotifOpen(false); }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      (userOpen ? userTriggerRef : notificationTriggerRef).current?.focus();
      setUserOpen(false); setNotifOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [userOpen, notifOpen]);

  const isTrainingManager = isTrainingManagerRole(session?.role);
  const isPredictor = isPredictorRole(session?.role);
  const isKpiManager = isKpiManagerRole(session?.role);
  const isCommunityUser = isCommunityUserRole(session?.role);
  const isProsumer = session?.role === "prosumer";

  const tabs = isTrainingManager
    ? TRAINING_ENABLED || session?.role === "training_manager"
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

        {isTrainingManager ? (
          TRAINING_ENABLED ? <TrainingWorkspaceSelector /> : <div className="ai-workspace-context"><small>Workspace</small><strong>AI Manager</strong></div>
        ) : null}
        {isPredictor ? <div className="ai-workspace-context"><small>Workspace</small><strong>Predictor</strong></div> : null}
        {isCommunityUser ? <Link className="community-context-main" to={isProsumer?'/app/community/dashboard':'/communities'}><span className="community-context-copy"><small>Workspace</small><strong>{isProsumer?'My energy':'Communities'}</strong></span><ChevronDown size={15}/></Link> : null}
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

      <div className="topbar-right" ref={toolsRef}>
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
          ref={notificationTriggerRef}
          aria-expanded={notifOpen}
          aria-haspopup="dialog"
          aria-controls="notification-menu"
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
          ref={userTriggerRef}
          aria-haspopup="dialog"
          aria-controls="profile-menu"
          aria-label="Open user menu"
          aria-expanded={userOpen}
          type="button"
          onClick={() => {
            setUserOpen((prev) => !prev);
            setNotifOpen(false);
          }}
        >
          <ProfileAvatar session={session} />

        </button>

        <NotificationPanel open={notifOpen} onClose={() => setNotifOpen(false)} />
        <UserMenu open={userOpen} onClose={() => setUserOpen(false)} />
      </div>
    </header>
  );
}
