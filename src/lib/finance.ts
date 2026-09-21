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

export function getFinancialTotals(projects: AmountProject[]) {
  const contractedCents = projects.reduce((total, project) => total + project.totalAmountCents, 0);
  const receivedCents = projects.reduce(
    (total, project) => total + getReceivedAmountCents(project),
    0,
  );
  return {
    contractedCents,
    receivedCents,
    outstandingCents: Math.max(0, contractedCents - receivedCents),
  };
}
