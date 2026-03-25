import type { ReactNode } from "react";

interface Props {
  title: string;
  message: string;
  action?: ReactNode;
}

export function EmptyState({ title, message, action }: Props): JSX.Element {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{message}</p>
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}
