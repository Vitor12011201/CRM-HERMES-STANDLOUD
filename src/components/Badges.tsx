import type { LeadStatus, ProjectStatus } from "@/generated/prisma/enums";
import { leadStatusLabels } from "@/lib/lead";
import { projectStatusLabels } from "@/lib/constants";

const scoreStyles = { A: "bg-emerald-100 text-emerald-800", B: "bg-amber-100 text-amber-800", C: "bg-slate-100 text-slate-700" } as const;
const statusStyles: Record<LeadStatus, string> = {
  NEW: "bg-slate-100 text-slate-700", QUALIFIED: "bg-blue-100 text-blue-800", CONTACTED: "bg-violet-100 text-violet-800", REPLIED: "bg-cyan-100 text-cyan-800", INTERESTED: "bg-amber-100 text-amber-800", DEMO_SENT: "bg-indigo-100 text-indigo-800", MEETING: "bg-fuchsia-100 text-fuchsia-800", PROPOSAL_SENT: "bg-orange-100 text-orange-800", WON: "bg-emerald-100 text-emerald-800", LOST: "bg-red-100 text-red-800",
};

export function ClassificationBadge({ classification }: { classification: "A" | "B" | "C" }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${scoreStyles[classification]}`}>Classe {classification}</span>;
}

export function StatusBadge({ status }: { status: LeadStatus }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[status]}`}>{leadStatusLabels[status]}</span>;
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const styles: Record<ProjectStatus, string> = { ACTIVE: "bg-blue-100 text-blue-800", COMPLETED: "bg-emerald-100 text-emerald-800", CANCELLED: "bg-slate-100 text-slate-700" };
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>{projectStatusLabels[status]}</span>;
}
