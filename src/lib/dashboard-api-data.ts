export type DashboardFunnelDto = {
  totalLeads: number;
  classA: number;
  classB: number;
  classC: number;
  contacted: number;
  replied: number;
  interested: number;
  proposals: number;
  won: number;
  lost: number;
  responseRate: number | null;
  interestRate: number | null;
  proposalRate: number | null;
  conversionRate: number | null;
};

export type DashboardFollowUpItemDto = {
  id: string;
  companyName: string;
  nextFollowUpAt: string;
};

export type DashboardFollowUpsDto = {
  overdue: { count: number; items: DashboardFollowUpItemDto[] };
  today: { count: number; items: DashboardFollowUpItemDto[] };
  upcoming: { count: number; items: DashboardFollowUpItemDto[] };
};

export type DashboardFinanceDto = {
  contractedCents: number;
  receivedCents: number;
  outstandingCents: number;
};
