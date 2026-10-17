import { AuthTransitionScene } from "../components/ui/AuthTransitionScene";
import { AUTH_TRANSITION_DURATION_MS, useAuthTransition } from "../contexts/AuthTransitionContext";
import { motion } from "framer-motion";
import { AuthBackdrop } from "../components/ui/AuthBackdrop";
import { Eye, EyeOff, Info, Lock, Mail } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { InstitutionalDock } from "../components/layout/InstitutionalDock";
import { Modal } from "../components/ui/Modal";
import { EVChargingLoader } from "../components/ui/EVChargingLoader";
import { APP_NAME, AUTH_SCENE_STORAGE_KEY, MOCK_USERS } from "../constants";
import { useAuth } from "../contexts/AuthContext";
import { useUI } from "../contexts/UIContext";
import { roleHomePath, roleLabel } from "../utils/roles";

import "./MediterraneanLogin.css";

const MEDITERRANEAN_BACKGROUNDS = [
  "/assets/mediterranean/login-olive-retreat.webp",
  "/assets/mediterranean/login-sunset-villa.webp",
  "/assets/mediterranean/login-coastal-village.webp",
  "/assets/mediterranean/login-coastal-courtyard.webp",
  "/assets/mediterranean/login-limestone-courtyard.webp",
  "/assets/mediterranean/login-vineyard.webp",
] as const;

const LOGIN_CLAIMS = [
  "Monitor. Optimize. Coordinate.",
  "Clean energy. Better decisions.",
  "Train smarter, operate faster.",
  "From data to action, in one console.",
  "Small grid, big intelligence.",
  "Keep calm and optimize the grid.",
  "Forecast today, save tomorrow.",
  "Less guesswork. More green power.",
  "Turning kWh into smart choices."
] as const;

const LOGIN_SCENE_LINES = [
  "A brighter day starts here.",
  "Your energy, connected.",
  "Welcome to your energy community."
] as const;

const LOGOUT_SCENE_LINES = [
  "You have signed out.",
  "You have signed out.",
  "You have signed out."
] as const;

type AuthSceneMode = "none" | "logout";
const LOGOUT_SCENE_DURATION_MS = AUTH_TRANSITION_DURATION_MS;

function pickRandomLine(lines: readonly string[]): string {
  return lines[Math.floor(Math.random() * lines.length)] || "";
}

export function LoginPage(): JSX.Element {
  const { session, login } = useAuth();
  const transition = useAuthTransition();
  const { theme, setTheme } = useUI();
  const navigate = useNavigate();
  const [email, setEmail] = useState("tiago.fonseca@energaize.io");
  const [password, setPassword] = useState("TfTm#2026!");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimIndex, setClaimIndex] = useState(0);
  const [authScene, setAuthScene] = useState<AuthSceneMode>("none");
  const [authSceneLine, setAuthSceneLine] = useState("");
  const [accountsModalOpen, setAccountsModalOpen] = useState(false);
  const sceneTimeoutRef = useRef<number | null>(null);
  const loginAccounts = useMemo(
    () =>
      Object.entries(MOCK_USERS)
        .map(([accountEmail, account]) => ({
          email: accountEmail,
          password: account.password,
          name: account.name,
          role: roleLabel(account.role)
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    []
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClaimIndex((previous) => (previous + 1) % LOGIN_CLAIMS.length);
    }, 3200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const stored = sessionStorage.getItem(AUTH_SCENE_STORAGE_KEY);
    if (stored === "logout") {
      sessionStorage.removeItem(AUTH_SCENE_STORAGE_KEY);
      setAuthScene("logout");
      setAuthSceneLine(pickRandomLine(LOGOUT_SCENE_LINES));
    }
  }, []);

  useEffect(() => {
    if (authScene !== "logout") return;
    if (sceneTimeoutRef.current) {
      window.clearTimeout(sceneTimeoutRef.current);
      sceneTimeoutRef.current = null;
    }
    sceneTimeoutRef.current = window.setTimeout(() => {
      setAuthScene("none");
      setAuthSceneLine("");
      sceneTimeoutRef.current = null;
    }, LOGOUT_SCENE_DURATION_MS);
    return () => {
      if (sceneTimeoutRef.current) {
        window.clearTimeout(sceneTimeoutRef.current);
        sceneTimeoutRef.current = null;
      }
    };
  }, [authScene]);

  useEffect(() => {
    return () => {
      if (sceneTimeoutRef.current) {
        window.clearTimeout(sceneTimeoutRef.current);
        sceneTimeoutRef.current = null;
      }
    };
  }, []);

  if (session && !transition.pending) {
    return <Navigate to={roleHomePath(session.role)} replace />;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authScene !== "none" || transition.pending) return;
    setLoading(true);
    setError(null);
    transition.begin(pickRandomLine(LOGIN_SCENE_LINES));
    try {
      const signedIn = await login({ email, password, remember });
      // Mount the real workspace now. Its readiness signal releases the overlay
      // after the minimum animation time, without remounting or fetching twice.
      navigate(roleHomePath(signedIn.role), { replace: true });
      if (signedIn.role !== "prosumer" && signedIn.role !== "rec_manager") transition.ready();
    } catch (err) {
      transition.cancel();
      setLoading(false);
      setError(err instanceof Error ? err.message : "Unexpected authentication error");
    }
  }

  return (
    <div className="login-page mediterranean-login">
      <AuthBackdrop images={MEDITERRANEAN_BACKGROUNDS} showMotionControl={false} />
      <div className="login-overlay" />
      {authScene === "logout" ? (
        <AuthTransitionScene mode={authScene} line={authSceneLine} />
      ) : null}

      <button
        className="login-accounts-trigger"
        type="button"
        title="Test accounts"
        aria-label="View test accounts"
        onClick={() => setAccountsModalOpen(true)}
      >
        <Info size={16} />
      </button>

      <div className="login-theme-switch">
        <button
          type="button"
          className={`theme-mini${theme === "light" ? " is-active" : ""}`}
          onClick={() => setTheme("light")}
        >
          Light
        </button>
        <button
          type="button"
          className={`theme-mini${theme === "dark" ? " is-active" : ""}`}
          onClick={() => setTheme("dark")}
        >
          Dark
        </button>
      </div>

      <Modal title="Available test accounts" open={accountsModalOpen} onClose={() => setAccountsModalOpen(false)} width="md">
        <section className="login-accounts-modal">
          <p>Select a test account to fill in the sign-in form. Community access follows the users and permissions registered in the backend.</p>
          <ul className="login-accounts-list">
            {loginAccounts.map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  className="login-account-item"
                  onClick={() => {
                    setEmail(account.email);
                    setPassword(account.password);
                    setRemember(true);
                    setError(null);
                    setAccountsModalOpen(false);
                  }}
                >
                  <div className="login-account-main">
                    <strong>{account.name}</strong>
                    <small>{account.role}</small>
                  </div>
                  <code>{account.email}</code>
                  <code>{account.password}</code>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </Modal>

      <motion.main
        className="login-content"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <section className="login-story" aria-label="EnergAIze">
          <div className="logo-row">
            <img className="login-brand login-brand-light" src="/assets/logos/energaize-light.png" alt={APP_NAME} />
            <img className="login-brand login-brand-dark" src="/assets/logos/energaize-dark.png" alt={APP_NAME} />
          </div>
          <h1>A brighter way<br />to live with energy.</h1>
          <motion.p key={LOGIN_CLAIMS[claimIndex]} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
            {LOGIN_CLAIMS[claimIndex]}
          </motion.p>
        </section>
        <form className="login-card" onSubmit={onSubmit}>
          <header className="login-welcome">
            <span>YOUR ENERGY, CONNECTED</span>
            <h2>Welcome back.</h2>
            <p>Sign in to your workspace.</p>
          </header>

          <label>
            <span>Email</span>
            <div className="input-wrap">
              <Mail size={15} />
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                placeholder="you@energaize.io"
                required
              />
            </div>
          </label>

          <label>
            <span>Password</span>
            <div className="input-wrap">
              <Lock size={15} />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                required
              />
              <button
                className="ghost-inline"
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label="Toggle password visibility"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </label>

          <div className="login-helpers">
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              <span>Remember me</span>
            </label>
            <Link to="/forgot-password" className="link-btn">Forgot password?</Link>
          </div>

          {error ? <p className="error-text">{error}</p> : null}

          <button type="submit" className="btn btn-primary btn-md login-submit" disabled={loading}>
            {loading ? <EVChargingLoader compact /> : "Log in"}
          </button>


        </form>

      </motion.main>

      <InstitutionalDock />
    </div>
  );
}
