import { LogOut, User } from "lucide-react";
import { Link } from "react-router-dom";
import { AUTH_SCENE_STORAGE_KEY } from "../../constants";
import { useAuth } from "../../contexts/AuthContext";
import { ProfileAvatar } from "../ui/ProfileAvatar";
import { roleLabel } from "../../utils/roles";
import { Button } from "../ui/Button";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function UserMenu({ open, onClose }: Props): JSX.Element | null {
  const { session, logout } = useAuth();

  if (!open || !session) return null;

  return (
    <section id="profile-menu" className="user-menu" role="dialog" aria-label="User menu">
      <header className="profile-menu-identity">
        <ProfileAvatar session={session} />
        <div><strong>{session.name}</strong><small>{session.email}</small><small>{roleLabel(session.role)}</small></div>
      </header>

      <Link className="menu-link" to="/app/account" onClick={onClose}>
        <User size={15} />
        <span>Account & preferences</span>
      </Link>

      {(session.role === "rec_manager" || session.role === "prosumer") && <Link className="menu-link" to="/app/people" onClick={onClose}>Homes and people</Link>}

      <Button
        variant="danger"
        size="sm"
        iconLeft={<LogOut size={14} />}
        onClick={async () => {
          sessionStorage.setItem(AUTH_SCENE_STORAGE_KEY, "logout");
          await logout();
          onClose();
        }}
      >
        Logout
      </Button>
    </section>
  );
}
