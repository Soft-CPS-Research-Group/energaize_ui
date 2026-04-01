import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

export function Button({
  children,
  variant = "secondary",
  size = "md",
  iconLeft,
  iconRight,
  className,
  ...rest
}: Props): JSX.Element {
  return (
    <button
      className={`btn btn-${variant} btn-${size}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {iconLeft ? <span className="btn-icon">{iconLeft}</span> : null}
      <span>{children}</span>
      {iconRight ? <span className="btn-icon">{iconRight}</span> : null}
    </button>
  );
}
