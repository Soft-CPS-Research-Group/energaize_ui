import { Bell, Circle, Trash2 } from "lucide-react";
import { useUI } from "../../contexts/UIContext";
import { formatRelativeTime } from "../../utils/time";
import { Button } from "../ui/Button";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NotificationPanel({ open, onClose }: Props): JSX.Element | null {
  const {
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
    removeNotification,
    unreadCount
  } = useUI();

  if (!open) return null;

  return (
    <section className="notif-panel" role="dialog" aria-label="Notifications">
      <header className="notif-head">
        <div>
          <h3>Notifications</h3>
          <p>{unreadCount} unread</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </header>

      <div className="notif-actions">
        <Button variant="secondary" size="sm" onClick={markAllNotificationsRead}>
          Mark all read
        </Button>
      </div>

      <ul className="notif-list">
        {notifications.length === 0 ? (
          <li className="notif-empty">
            <Bell size={16} />
            <span>No notifications yet</span>
          </li>
        ) : (
          notifications.map((item) => (
            <li key={item.id} className={`notif-item notif-${item.severity}${item.read ? " is-read" : ""}`}>
              <button
                type="button"
                className="notif-main"
                onClick={() => markNotificationRead(item.id)}
                title="Mark as read"
              >
                <Circle size={10} />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.message}</p>
                  <small>{formatRelativeTime(item.timestamp)}</small>
                </div>
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => removeNotification(item.id)}
                aria-label="Remove notification"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
