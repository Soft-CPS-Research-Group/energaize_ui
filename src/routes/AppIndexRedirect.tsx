import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export function AppIndexRedirect(): JSX.Element {
  const { session } = useAuth();

  if (!session) return <Navigate to="/login" replace />;

  if (session.role === "ai_manager") {
    return <Navigate to="/app/ai/jobs" replace />;
  }

  return <Navigate to="/app/workspace" replace />;
}
