import { describe, expect, it } from "vitest";
import { leadSchema, paymentSchema, projectSchema } from "./validation";

const validLead = { companyName: "Empresa Fictícia", qualificationScore: 5, status: "NEW" };

describe("validation", () => {
  it("accepts optional lead fields while enforcing score limits", () => {
    expect(leadSchema.safeParse(validLead).success).toBe(true);
    expect(leadSchema.safeParse({ ...validLead, qualificationScore: -1 }).success).toBe(false);
    expect(leadSchema.safeParse({ ...validLead, qualificationScore: 11 }).success).toBe(false);
  });

  it("rejects invalid e-mails and URLs when provided", () => {
    expect(leadSchema.safeParse({ ...validLead, email: "not-an-email" }).success).toBe(false);
    expect(leadSchema.safeParse({ ...validLead, websiteUrl: "not-a-url" }).success).toBe(false);
  });

  it("requires positive cents for projects and payments", () => {
    expect(projectSchema.safeParse({ clientName: "Cliente", projectName: "Projeto", totalAmountCents: 0, status: "ACTIVE" }).success).toBe(false);
    expect(paymentSchema.safeParse({ amountCents: 0, paidAt: "2026-01-01" }).success).toBe(false);
    expect(paymentSchema.safeParse({ amountCents: 1, paidAt: "2026-01-01" }).success).toBe(true);
  });
});
