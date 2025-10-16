import { ReactNode } from "react";
import { clsx } from "clsx";

type StatCardProps = {
  title: string;
  value: ReactNode;
  description?: ReactNode;
  className?: string;
};

export function StatCard({ title, value, description, className }: StatCardProps) {
  return (
    <div className={clsx("card", className)}>
      <h2>{title}</h2>
      <div className="stat-value">{value}</div>
      {description && <p style={{ marginTop: "0.5rem", opacity: 0.75 }}>{description}</p>}
    </div>
  );
}
