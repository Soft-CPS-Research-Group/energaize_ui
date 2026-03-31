import { Bell } from "lucide-react";
import { useUI } from "../contexts/UIContext";
import { formatDateTime } from "../utils/time";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
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
    <div className="page">
      <PageHeader
        title="Notifications"
        subtitle="Operational events and API feedback."
        actions={
          <div className="jobs-command-group">
            <Button variant="secondary" onClick={markAllNotificationsRead}>
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
        <section className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Title</th>
                <th>Message</th>
                <th>Time</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {notifications.map((item) => (
                <tr key={item.id} className={item.read ? "is-muted" : ""}>
                  <td>{item.severity}</td>
                  <td>{item.title}</td>
                  <td>{item.message}</td>
                  <td>{formatDateTime(item.timestamp)}</td>
                  <td>
                    <div className="table-actions">
                      <Button size="sm" variant="ghost" onClick={() => markNotificationRead(item.id)}>
                        Read
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeNotification(item.id)}>
                        Remove
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
