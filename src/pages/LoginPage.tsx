import { motion } from "framer-motion";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { InstitutionalDock } from "../components/layout/InstitutionalDock";
import { APP_NAME, LOGIN_BACKGROUNDS } from "../constants";
import { useAuth } from "../contexts/AuthContext";
import { useUI } from "../contexts/UIContext";

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

  useEffect(() => {
    const timer = window.setInterval(() => {
      setBgIndex((previous) => (previous + 1) % LOGIN_BACKGROUNDS.length);
    }, 9000);
    return () => window.clearInterval(timer);
  }, []);

  if (session) {
    return <Navigate to={session.role === "ai_manager" ? "/app/ai/jobs" : "/communities"} replace />;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await login({ email, password, remember });
      const role = email.trim().toLowerCase() === "ai@energaize.io" ? "ai_manager" : "other";
      navigate(role === "ai_manager" ? "/app/ai/jobs" : "/communities", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected authentication error");
    } finally {
      setLoading(false);
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
          <header>
            <div className="logo-row">
              <img
                className="login-brand login-brand-light"
                src="/assets/logos/energaize-dark.png"
                alt={APP_NAME}
              />
              <img
                className="login-brand login-brand-dark"
                src="/assets/logos/energaize-light.png"
                alt={APP_NAME}
              />
            </div>
            <h1>Log in to EnergAIze</h1>
            <p>Intelligent Energy Communities Management</p>
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
            {loading ? "Signing in..." : "Log in"}
          </button>

          <motion.div
            className="login-claim"
            initial={{ opacity: 0.3 }}
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          >
            Monitor. Optimize. Coordinate.
          </motion.div>
        </form>

      </motion.main>

      <InstitutionalDock />
    </div>
  );
}
