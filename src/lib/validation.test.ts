import { describe, expect, it } from "vitest";
import { leadAnalysisSchema, leadEvidenceSchema, leadSchema, paymentSchema, projectSchema } from "./validation";

const validLead = { companyName: "Empresa Fictícia", qualificationScore: 5, status: "NEW" };

const validEvidence = {
  sourceType: "WEBSITE",
  sourceUrl: "https://empresa.example/orcamento",
  observation: "O site apresenta um formulário de contato com nome, telefone e mensagem.",
};

describe("existing CRM validation", () => {
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

describe("lead research validation", () => {
  it.each([
    ["WEBSITE", "http://empresa.example"],
    ["GOOGLE_MAPS", "https://maps.example/empresa"],
  ])("accepts a valid %s evidence with an http(s) source URL", (sourceType, sourceUrl) => {
    expect(leadEvidenceSchema.safeParse({ ...validEvidence, sourceType, sourceUrl }).success).toBe(true);
  });

  it("rejects empty or overly long evidence observations", () => {
    expect(leadEvidenceSchema.safeParse({ ...validEvidence, observation: "   " }).success).toBe(false);
    expect(leadEvidenceSchema.safeParse({ ...validEvidence, observation: "x".repeat(2001) }).success).toBe(false);
  });

  it("rejects non-http(s) source URLs and invalid source types", () => {
    expect(leadEvidenceSchema.safeParse({ ...validEvidence, sourceUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(leadEvidenceSchema.safeParse({ ...validEvidence, sourceUrl: "data:text/plain,test" }).success).toBe(false);
    expect(leadEvidenceSchema.safeParse({ ...validEvidence, sourceType: "SEARCH_ENGINE" }).success).toBe(false);
  });

  it("accepts an analysis with at least one textual interpretation", () => {
    const result = leadAnalysisSchema.safeParse({
      summary: "A presença digital parece incompleta para pedidos rápidos.",
      confidence: "MEDIUM",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty analyses, invalid confidence, and overlong analysis text", () => {
    expect(leadAnalysisSchema.safeParse({ confidence: "MEDIUM" }).success).toBe(false);
    expect(leadAnalysisSchema.safeParse({ summary: "Há uma oportunidade.", confidence: "CERTAIN" }).success).toBe(false);
    expect(leadAnalysisSchema.safeParse({ summary: "x".repeat(2001), confidence: "HIGH" }).success).toBe(false);
    expect(leadAnalysisSchema.safeParse({ opportunity: "x".repeat(4001), confidence: "HIGH" }).success).toBe(false);
    expect(leadAnalysisSchema.safeParse({ commercialSignals: "x".repeat(4001), confidence: "HIGH" }).success).toBe(false);
    expect(leadAnalysisSchema.safeParse({ demoConcept: "x".repeat(4001), confidence: "HIGH" }).success).toBe(false);
  });
});
