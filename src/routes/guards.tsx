import { Navigate, Outlet, useLocation } from "react-router-dom";
import { EVChargingLoader } from "../components/ui/EVChargingLoader";
import { useAuth } from "../contexts/AuthContext";
import type { UserRole } from "../types";

export function AuthGuard(): JSX.Element {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="route-loading">
        <EVChargingLoader label="Powering the console..." />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

export function RoleGuard({ allowed }: { allowed: UserRole[] }): JSX.Element {
  const { session } = useAuth();

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (!allowed.includes(session.role)) {
    return <Navigate to="/communities" replace />;
  }

  return <Outlet />;
}

export function RootRedirect(): JSX.Element {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="route-loading">
        <EVChargingLoader label="Starting EnergAIze..." />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;

  if (session.role === "ai_manager") {
    return <Navigate to="/app/ai/jobs" replace />;
  }

  return <Navigate to="/communities" replace />;
}
