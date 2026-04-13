import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  iconOnly?: boolean;
}

export function Button({
  children,
  variant = "secondary",
  size = "md",
  iconLeft,
  iconRight,
  iconOnly = false,
  className,
  ...rest
}: Props): JSX.Element {
  return (
    <button
      className={`btn btn-${variant} btn-${size}${iconOnly ? " btn-icon-only" : ""}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {iconLeft ? <span className="btn-icon">{iconLeft}</span> : null}
      {iconOnly ? null : <span>{children}</span>}
      {iconRight ? <span className="btn-icon">{iconRight}</span> : null}
    </button>
  );
}
