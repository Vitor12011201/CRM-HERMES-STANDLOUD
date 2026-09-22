import { getDb } from "@/lib/db";
import { getFinancialTotals } from "@/lib/finance";

export async function getFinancialSummary() {
  const db = getDb();
  const projects = await db.project.findMany({
    where: { status: { not: "CANCELLED" } },
    include: { payments: { select: { amountCents: true } } },
  });
  const totals = getFinancialTotals(projects);
  return {
    contractedCents: totals.contractedCents,
    receivedCents: totals.receivedCents,
    outstandingCents: totals.outstandingCents,
    activeProjectCount: projects.filter((project) => project.status === "ACTIVE").length,
  };
}
