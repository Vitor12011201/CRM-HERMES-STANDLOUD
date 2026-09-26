import { env } from "cloudflare:workers";

import type {
  DashboardFinanceDto,
  DashboardFollowUpItemDto,
  DashboardFollowUpsDto,
  DashboardFunnelDto,
} from "@/lib/dashboard-api-data";
import { getBusinessCalendarDateKey, getFollowUpTimingForBusinessDate } from "@/lib/business-time";
import { rate } from "@/lib/dashboard";

type DashboardStatement = {
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
};

export type DashboardReadDatabase = {
  prepare(query: string): DashboardStatement;
};

type FunnelRow = {
  totalLeads: number | null;
  classA: number | null;
  classB: number | null;
  classC: number | null;
  invalidClassificationCount: number | null;
  contacted: number | null;
  replied: number | null;
  interested: number | null;
  proposals: number | null;
  won: number | null;
  lost: number | null;
};

type FollowUpRow = {
  id: string;
  companyName: string;
  nextFollowUpAt: string;
};

type FinanceRow = {
  contractedCents: number | null;
  receivedCents: number | null;
};

const funnelQuery = `
  SELECT
    COUNT(*) AS totalLeads,
    COALESCE(SUM(CASE WHEN qualificationScore BETWEEN 8 AND 10 THEN 1 ELSE 0 END), 0) AS classA,
    COALESCE(SUM(CASE WHEN qualificationScore BETWEEN 5 AND 7 THEN 1 ELSE 0 END), 0) AS classB,
    COALESCE(SUM(CASE WHEN qualificationScore BETWEEN 0 AND 4 THEN 1 ELSE 0 END), 0) AS classC,
    COALESCE(SUM(CASE WHEN qualificationScore < 0 OR qualificationScore > 10 THEN 1 ELSE 0 END), 0) AS invalidClassificationCount,
    COALESCE(SUM(CASE
      WHEN status IN ('CONTACTED', 'REPLIED', 'INTERESTED', 'DEMO_SENT', 'MEETING', 'PROPOSAL_SENT', 'WON')
        OR (status = 'LOST' AND lastContactAt IS NOT NULL)
      THEN 1 ELSE 0 END), 0) AS contacted,
    COALESCE(SUM(CASE WHEN status IN ('REPLIED', 'INTERESTED', 'DEMO_SENT', 'MEETING', 'PROPOSAL_SENT', 'WON') THEN 1 ELSE 0 END), 0) AS replied,
    COALESCE(SUM(CASE WHEN status IN ('INTERESTED', 'DEMO_SENT', 'MEETING', 'PROPOSAL_SENT', 'WON') THEN 1 ELSE 0 END), 0) AS interested,
    COALESCE(SUM(CASE WHEN status IN ('PROPOSAL_SENT', 'WON') THEN 1 ELSE 0 END), 0) AS proposals,
    COALESCE(SUM(CASE WHEN status = 'WON' THEN 1 ELSE 0 END), 0) AS won,
    COALESCE(SUM(CASE WHEN status = 'LOST' THEN 1 ELSE 0 END), 0) AS lost
  FROM Lead
`;

const followUpsQuery = `
  SELECT id, companyName, nextFollowUpAt
  FROM Lead
  WHERE nextFollowUpAt IS NOT NULL
  ORDER BY nextFollowUpAt ASC
`;

const financeQuery = `
  SELECT
    COALESCE(SUM(totalAmountCents), 0) AS contractedCents,
    COALESCE((
      SELECT SUM(Payment.amountCents)
      FROM Payment
      INNER JOIN Project ON Project.id = Payment.projectId
      WHERE Project.status != 'CANCELLED'
    ), 0) AS receivedCents
  FROM Project
  WHERE status != 'CANCELLED'
`;

function numberValue(value: number | null | undefined) {
  return Number(value ?? 0);
}

function dashboardDatabase() {
  return env.DB as unknown as DashboardReadDatabase;
}

export async function getDashboardFunnel(database: DashboardReadDatabase = dashboardDatabase()): Promise<DashboardFunnelDto> {
  const row = await database.prepare(funnelQuery).first<FunnelRow>();
  if (numberValue(row?.invalidClassificationCount) > 0) {
    // This preserves the existing fail-closed classification contract.
    throw new RangeError("A pontuação deve ser um número inteiro entre 0 e 10.");
  }

  const contacted = numberValue(row?.contacted);
  const replied = numberValue(row?.replied);
  const interested = numberValue(row?.interested);
  const proposals = numberValue(row?.proposals);
  const won = numberValue(row?.won);

  return {
    totalLeads: numberValue(row?.totalLeads),
    classA: numberValue(row?.classA),
    classB: numberValue(row?.classB),
    classC: numberValue(row?.classC),
    contacted,
    replied,
    interested,
    proposals,
    won,
    lost: numberValue(row?.lost),
    responseRate: rate(replied, contacted),
    interestRate: rate(interested, contacted),
    proposalRate: rate(proposals, interested),
    conversionRate: rate(won, contacted),
  };
}

export async function getDashboardFollowUps(
  database: DashboardReadDatabase = dashboardDatabase(),
  reference = new Date(),
): Promise<DashboardFollowUpsDto> {
  const { results } = await database.prepare(followUpsQuery).all<FollowUpRow>();
  const businessDate = getBusinessCalendarDateKey(reference);
  const overdue: DashboardFollowUpItemDto[] = [];
  const today: DashboardFollowUpItemDto[] = [];
  const upcoming: DashboardFollowUpItemDto[] = [];

  for (const row of results) {
    const item = { id: row.id, companyName: row.companyName, nextFollowUpAt: row.nextFollowUpAt };
    const timing = getFollowUpTimingForBusinessDate(row.nextFollowUpAt, businessDate);
    if (timing === "OVERDUE") overdue.push(item);
    else if (timing === "TODAY") today.push(item);
    else if (upcoming.length < 6) upcoming.push(item);
  }

  return {
    overdue: { count: overdue.length, items: overdue },
    today: { count: today.length, items: today },
    upcoming: { count: upcoming.length, items: upcoming },
  };
}

export async function getDashboardFinance(database: DashboardReadDatabase = dashboardDatabase()): Promise<DashboardFinanceDto> {
  const row = await database.prepare(financeQuery).first<FinanceRow>();
  const contractedCents = numberValue(row?.contractedCents);
  const receivedCents = numberValue(row?.receivedCents);
  return {
    contractedCents,
    receivedCents,
    outstandingCents: Math.max(0, contractedCents - receivedCents),
  };
}

export const dashboardReadQueries = {
  funnelQuery,
  followUpsQuery,
  financeQuery,
};
