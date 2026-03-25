import type { ReactNode } from "react";

interface Props {
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  children: ReactNode;
}

export function Badge({ children, tone = "neutral" }: Props): JSX.Element {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
