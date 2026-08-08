import type { ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  className?: string;
}

/** Amber status pill ("Full" / "Waitlist" / "#N in queue"). One look, one place. */
export function Badge({ children, className }: BadgeProps) {
  return (
    <span className={`badge${className ? ` ${className}` : ""}`}>{children}</span>
  );
}
