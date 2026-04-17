import React from "react";
import { cn } from "../../utils/kpiUtils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn("panel", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: CardProps) {
  return <header className={className} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={className} {...props} />;
}

export function CardContent({ className, ...props }: CardProps) {
  return <div className={className} {...props} />;
}