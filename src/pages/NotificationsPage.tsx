import { Bell, Check, Trash2 } from "lucide-react";
import { useUI } from "../contexts/UIContext";
import { formatDateTime } from "../utils/time";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Badge } from "../components/ui/Badge";
import { PageHeader } from "../components/ui/PageHeader";

export function NotificationsPage(): JSX.Element {
  const {
    notifications,
    markAllNotificationsRead,
    markNotificationRead,
    removeNotification,
    clearNotifications,
    unreadCount
  } = useUI();

  return (
    <div className="page notifications-page common-page">
      <PageHeader
        title="Notifications"
        subtitle="Updates from your workspace, in one place."
        actions={
          <div className="jobs-command-group">
            <Button variant="secondary" onClick={markAllNotificationsRead} disabled={unreadCount === 0}>
              Mark all read ({unreadCount})
            </Button>
            <Button variant="ghost" onClick={clearNotifications} disabled={notifications.length === 0}>
              Clear all
            </Button>
          </div>
        }
      />

      {notifications.length === 0 ? (
        <EmptyState
          title="No notifications"
          message="System and operational notifications will appear here."
          action={<Bell size={20} />}
        />
      ) : (
        <section className="panel notifications-list" aria-label="Notification history">
          {notifications.map(item => (
            <article key={item.id} className={`notification-row${item.read ? " is-read" : ""}`}>
              <span className={`notification-status notification-status--${item.severity}`}><Bell size={17} /></span>
              <div className="notification-copy">
                <header><strong>{item.title}</strong><Badge tone={item.severity === "error" ? "danger" : item.severity === "success" ? "success" : item.severity === "warning" ? "warning" : "info"}>{item.severity}</Badge>{!item.read ? <span className="notification-unread">Unread</span> : null}</header>
                <p>{item.message}</p>
                <small>{formatDateTime(item.timestamp)}{item.source ? ` · ${item.source}` : ""}</small>
              </div>
              <div className="notification-row-actions">
                <Button size="sm" variant="ghost" iconLeft={<Check size={14} />} disabled={item.read} onClick={() => markNotificationRead(item.id)} aria-label={`Mark ${item.title} as read`}>{item.read ? "Read" : "Mark read"}</Button>
                <Button size="sm" variant="ghost" iconLeft={<Trash2 size={14} />} onClick={() => removeNotification(item.id)} aria-label={`Remove ${item.title}`}>Remove</Button>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
