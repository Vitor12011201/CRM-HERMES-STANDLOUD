export type AmountProject = {
  totalAmountCents: number;
  payments: Array<{ amountCents: number }>;
};

export function getReceivedAmountCents(project: AmountProject): number {
  return project.payments.reduce((total, payment) => total + payment.amountCents, 0);
}

export function getOutstandingAmountCents(project: AmountProject): number {
  return Math.max(0, project.totalAmountCents - getReceivedAmountCents(project));
}

export function getFinancialTotals<TProject extends AmountProject>(
  projects: TProject[],
  shouldIncludeProject: (project: TProject) => boolean = () => true,
) {
  let contractedCents = 0;
  let receivedCents = 0;

  for (const project of projects) {
    if (!shouldIncludeProject(project)) continue;
    contractedCents += project.totalAmountCents;
    receivedCents += getReceivedAmountCents(project);
  }

  return {
    contractedCents,
    receivedCents,
    outstandingCents: Math.max(0, contractedCents - receivedCents),
  };
}
