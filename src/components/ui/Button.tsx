import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  iconLeft?: ReactNode;
}

export function Button({
  children,
  variant = "secondary",
  size = "md",
  iconLeft,
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
    </button>
  );
}
