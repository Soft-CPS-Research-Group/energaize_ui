import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { roleHomePath } from "../utils/roles";

export function AppIndexRedirect(): JSX.Element {
  const { session } = useAuth();

  if (!session) return <Navigate to="/login" replace />;

  return <Navigate to={roleHomePath(session.role)} replace />;
}
