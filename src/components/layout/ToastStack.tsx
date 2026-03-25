import { CheckCircle2, Info, TriangleAlert, X, XCircle } from "lucide-react";
import { useUI } from "../../contexts/UIContext";

function ToastIcon({ severity }: { severity: "info" | "success" | "warning" | "error" }): JSX.Element {
  if (severity === "success") return <CheckCircle2 size={15} />;
  if (severity === "warning") return <TriangleAlert size={15} />;
  if (severity === "error") return <XCircle size={15} />;
  return <Info size={15} />;
}

export function ToastStack(): JSX.Element | null {
  const { toasts, dismissToast } = useUI();

  if (toasts.length === 0) return null;

  return (
    <aside className="toast-stack" aria-live="polite" aria-label="Feedback toasts">
      {toasts.slice(0, 5).map((toast) => (
        <article key={toast.id} className={`toast toast-${toast.severity}`}>
          <div className="toast-icon">
            <ToastIcon severity={toast.severity} />
          </div>
          <div className="toast-content">
            <strong>{toast.title}</strong>
            <p>{toast.message}</p>
          </div>
          <button type="button" className="toast-close" onClick={() => dismissToast(toast.id)} aria-label="Dismiss">
            <X size={13} />
          </button>
        </article>
      ))}
    </aside>
  );
}
