import type { ReactNode } from "react";

export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      {action}
    </header>
  );
}
