import { motion } from "framer-motion";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { InstitutionalDock } from "../components/layout/InstitutionalDock";
import { EVChargingLoader } from "../components/ui/EVChargingLoader";
import { APP_NAME, AUTH_SCENE_STORAGE_KEY, LOGIN_BACKGROUNDS } from "../constants";
import { useAuth } from "../contexts/AuthContext";
import { useUI } from "../contexts/UIContext";

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
  "Plugging into genius mode.",
  "Booting optimism and clean electrons.",
  "Charging the brain grid. Please honk once."
] as const;

const LOGOUT_SCENE_LINES = [
  "Unplugged. No sparks, no drama.",
  "Charging session complete. Grid says thanks.",
  "Disconnecting like a very polite EV."
] as const;

type AuthSceneMode = "none" | "login" | "logout";
const LOGIN_SCENE_DURATION_MS = 1500;
const LOGOUT_SCENE_DURATION_MS = 1200;

function pickRandomLine(lines: readonly string[]): string {
  return lines[Math.floor(Math.random() * lines.length)] || "";
}

function AuthTransitionScene({
  mode,
  line
}: {
  mode: Exclude<AuthSceneMode, "none">;
  line: string;
}): JSX.Element {
  return (
    <motion.div
      className="auth-scene-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      <div className={`auth-scene${mode === "login" ? " is-login" : " is-logout"}`}>
        <div className="auth-scene-track" aria-hidden="true">
          {line ? <p className="auth-scene-caption">{line}</p> : null}
          <span className="auth-scene-station" />
          <span className="auth-scene-cable" />
          <span className="auth-scene-car" />
          <span className="auth-scene-energy e1" />
          <span className="auth-scene-energy e2" />
          <span className="auth-scene-energy e3" />
          <span className="auth-scene-pulse" />
        </div>
      </div>
    </motion.div>
  );
}

export function LoginPage(): JSX.Element {
  const { session, login } = useAuth();
  const { theme, setTheme } = useUI();
  const navigate = useNavigate();
  const [email, setEmail] = useState("ai@energaize.io");
  const [password, setPassword] = useState("ai123");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bgIndex, setBgIndex] = useState(0);
  const [claimIndex, setClaimIndex] = useState(0);
  const [authScene, setAuthScene] = useState<AuthSceneMode>("none");
  const [authSceneLine, setAuthSceneLine] = useState("");
  const sceneTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setBgIndex((previous) => (previous + 1) % LOGIN_BACKGROUNDS.length);
    }, 9000);
    return () => window.clearInterval(timer);
  }, []);

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

  if (session && authScene !== "login") {
    return <Navigate to={session.role === "ai_manager" ? "/app/ai/jobs" : "/communities"} replace />;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authScene === "login") return;
    setLoading(true);
    setError(null);
    let succeeded = false;

    try {
      await login({ email, password, remember });
      succeeded = true;
      const role = email.trim().toLowerCase() === "ai@energaize.io" ? "ai_manager" : "other";
      const target = role === "ai_manager" ? "/app/ai/jobs" : "/communities";
      setAuthScene("login");
      setAuthSceneLine(pickRandomLine(LOGIN_SCENE_LINES));
      if (sceneTimeoutRef.current) {
        window.clearTimeout(sceneTimeoutRef.current);
        sceneTimeoutRef.current = null;
      }
      sceneTimeoutRef.current = window.setTimeout(() => {
        setLoading(false);
        navigate(target, { replace: true });
        sceneTimeoutRef.current = null;
      }, LOGIN_SCENE_DURATION_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected authentication error");
    } finally {
      if (!succeeded) {
        setLoading(false);
      }
    }
  }

  return (
    <div className="login-page">
      <motion.div
        key={LOGIN_BACKGROUNDS[bgIndex]}
        className="login-bg"
        initial={{ opacity: 0.72 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        style={{
          backgroundImage: `linear-gradient(120deg, rgba(12, 27, 21, 0.2), rgba(8, 12, 18, 0.7)), url("${LOGIN_BACKGROUNDS[bgIndex]}")`
        }}
      />
      <div className="login-overlay" />
      {authScene === "login" || authScene === "logout" ? (
        <AuthTransitionScene mode={authScene} line={authSceneLine} />
      ) : null}

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

      <motion.main
        className="login-content"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <form className="login-card" onSubmit={onSubmit}>
          <header className="login-branding">
            <div className="logo-row login-logo-center">
              <img
                className="login-brand login-brand-light"
                src="/assets/logos/energaize-light.png"
                alt={APP_NAME}
              />
              <img
                className="login-brand login-brand-dark"
                src="/assets/logos/energaize-dark.png"
                alt={APP_NAME}
              />
            </div>
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
            <button type="button" className="link-btn">
              Forgot password?
            </button>
          </div>

          {error ? <p className="error-text">{error}</p> : null}

          <button type="submit" className="btn btn-primary btn-md login-submit" disabled={loading}>
            {loading ? <EVChargingLoader compact /> : "Log in"}
          </button>

          <motion.p
            key={LOGIN_CLAIMS[claimIndex]}
            className="login-claim"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.26, ease: "easeOut" }}
          >
            {LOGIN_CLAIMS[claimIndex]}
          </motion.p>
        </form>

      </motion.main>

      <InstitutionalDock />
    </div>
  );
}
