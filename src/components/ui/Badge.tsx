import type { ReactNode } from "react";

interface Props {
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  children: ReactNode;
  className?: string;
}

export function Badge({ children, tone = "neutral", className = "" }: Props): JSX.Element {
  return <span className={`badge badge-${tone}${className ? ` ${className}` : ""}`}>{children}</span>;
}
