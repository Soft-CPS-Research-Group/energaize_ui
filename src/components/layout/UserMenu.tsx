import { LogOut, User } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { Button } from "../ui/Button";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function UserMenu({ open, onClose }: Props): JSX.Element | null {
  const { session, logout } = useAuth();

  if (!open || !session) return null;

  return (
    <section className="user-menu" role="dialog" aria-label="User menu">
      <header>
        <strong>{session.name}</strong>
        <small>{session.email}</small>
      </header>

      <Link className="menu-link" to="/app/account" onClick={onClose}>
        <User size={15} />
        <span>Profile</span>
      </Link>

      <Button
        variant="danger"
        size="sm"
        iconLeft={<LogOut size={14} />}
        onClick={() => {
          logout();
          onClose();
        }}
      >
        Logout
      </Button>
    </section>
  );
}
