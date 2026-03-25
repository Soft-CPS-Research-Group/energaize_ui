import {
  Bell,
  ChevronDown,
  ExternalLink,
  FileText,
  Menu,
  Settings2
} from "lucide-react";
import { useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { AI_AVATAR_URL, APP_NAME } from "../../constants";
import { useAuth } from "../../contexts/AuthContext";
import { useUI } from "../../contexts/UIContext";
import { ThemeToggle } from "../ui/ThemeToggle";
import { NotificationPanel } from "./NotificationPanel";
import { UserMenu } from "./UserMenu";

const AI_TABS = [
  { to: "/app/ai/jobs", label: "Jobs" },
  { to: "/app/ai/datasets", label: "Datasets" },
  { to: "/app/ai/configs", label: "Experiment Configs" }
];

export function TopBar(): JSX.Element {
  const { session } = useAuth();
  const { communities, activeCommunity, setActiveCommunity, unreadCount, setMobileTreeOpen } = useUI();
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const tabs = session?.role === "ai_manager" ? AI_TABS : [{ to: "/app/logs", label: "Logs" }];
  const isAiManager = session?.role === "ai_manager";
  const brandLink = isAiManager ? "/app/ai/jobs" : "/communities";
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

        {!isAiManager ? (
          <div className="community-switcher">
            <button className="icon-btn mobile-only" type="button" onClick={() => setMobileTreeOpen(true)}>
              <Menu size={16} />
            </button>
            <select
              aria-label="Active community"
              value={activeCommunity.id}
              onChange={(event) => setActiveCommunity(event.target.value)}
            >
              {communities.map((community) => (
                <option key={community.id} value={community.id}>
                  {community.name}
                </option>
              ))}
            </select>
            <button
              className="icon-btn"
              type="button"
              title="Community settings"
              onClick={() => navigate("/communities")}
            >
              <ChevronDown size={15} />
            </button>
          </div>
        ) : null}
      </div>

      <nav className="topbar-nav" aria-label="Primary navigation">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => `top-tab${isActive ? " is-active" : ""}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="topbar-right">
        <a
          className="icon-btn"
          href="http://193.136.62.78:5000/#/"
          target="_blank"
          rel="noreferrer"
          title="Open MLflow"
          aria-label="Open MLflow"
        >
          <ExternalLink size={16} />
        </a>

        <Link className={`icon-btn${location.pathname === "/app/logs" ? " is-active" : ""}`} to="/app/logs" title="Logs">
          <FileText size={16} />
        </Link>

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
            {session?.role === "ai_manager" ? (
              <img src={AI_AVATAR_URL} alt={session.name} />
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
