import { describe, expect, it } from "vitest";
import { getFinancialTotals, getOutstandingAmountCents, getReceivedAmountCents } from "./finance";

describe("financial calculations", () => {
  it("sums multiple payments and calculates the outstanding balance in cents", () => {
    const project = { totalAmountCents: 129000, payments: [{ amountCents: 64500 }, { amountCents: 64500 }] };
    expect(project.totalAmountCents).toBe(129000);
    expect(getReceivedAmountCents(project)).toBe(129000);
    expect(getOutstandingAmountCents(project)).toBe(0);
  });

  it("keeps the remaining amount for a partial payment", () => {
    const project = { totalAmountCents: 129000, payments: [{ amountCents: 64500 }] };
    expect(getReceivedAmountCents(project)).toBe(64500);
    expect(getOutstandingAmountCents(project)).toBe(64500);
    expect(getFinancialTotals([project])).toEqual({ contractedCents: 129000, receivedCents: 64500, outstandingCents: 64500 });
  });
});
