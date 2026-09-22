import { describe, expect, it } from "vitest";
import {
  maxLeadResearchEvidences,
  maxResearcherUnresolvedQuestions,
  researcherEvidenceSchema,
  researcherInputSchema,
  researcherResultSchema,
  toLeadEvidenceInputs,
} from "./contracts";

const minimalInput = {
  lead: { id: "lead-123", companyName: "Empresa de teste" },
  knownSources: {},
  goal: "Registrar observações factuais da presença digital.",
  allowedSourceTypes: ["WEBSITE"],
};

const factualEvidence = {
  sourceType: "WEBSITE",
  sourceUrl: "https://empresa.example",
  observation: "A página inicial não apresenta CTA de orçamento visível na primeira seção.",
};

describe("Researcher V0 contracts", () => {
  it("accepts minimal and complete researcher inputs without commercial bias", () => {
    expect(researcherInputSchema.safeParse(minimalInput).success).toBe(true);
    expect(researcherInputSchema.safeParse({
      lead: {
        id: "lead-456",
        companyName: "Empresa completa",
        city: "Jacareí",
        region: "SP",
        segment: "Climatização",
        primaryService: "Instalação de ar-condicionado",
      },
      knownSources: {
        websiteUrl: "https://empresa.example",
        googleMapsUrl: "https://maps.example/empresa",
        instagramUrl: "https://instagram.example/empresa",
        facebookUrl: "https://facebook.example/empresa",
        linkedinUrl: "https://linkedin.example/company/empresa",
      },
      goal: "Coletar observações verificáveis sobre os canais digitais.",
      allowedSourceTypes: ["WEBSITE", "GOOGLE_MAPS", "INSTAGRAM", "FACEBOOK", "LINKEDIN", "OTHER"],
    }).success).toBe(true);
    expect(researcherInputSchema.safeParse({ ...minimalInput, qualificationScore: 9 }).success).toBe(false);
  });

  it("rejects invalid known-source URLs", () => {
    expect(researcherInputSchema.safeParse({
      ...minimalInput,
      knownSources: { websiteUrl: "javascript:alert(1)" },
    }).success).toBe(false);
  });

  it("accepts an empty result with unresolved questions and low research confidence", () => {
    expect(researcherResultSchema.parse({
      evidence: [],
      unresolvedQuestions: ["Não foi possível confirmar se existe website oficial."],
      confidence: "LOW",
    })).toMatchObject({ evidence: [], confidence: "LOW" });
  });

  it("accepts factual evidence and rejects commercial inference fields", () => {
    expect(researcherEvidenceSchema.safeParse(factualEvidence).success).toBe(true);
    expect(researcherEvidenceSchema.safeParse({ ...factualEvidence, opportunity: "Criar uma landing page." }).success).toBe(false);
  });

  it("rejects excessive, empty, and duplicate evidence", () => {
    expect(researcherResultSchema.safeParse({
      evidence: Array.from({ length: maxLeadResearchEvidences + 1 }, (_, index) => ({
        ...factualEvidence,
        observation: `Observação factual ${index}.`,
      })),
      unresolvedQuestions: [],
      confidence: "MEDIUM",
    }).success).toBe(false);
    expect(researcherResultSchema.safeParse({
      evidence: [{ ...factualEvidence, observation: "   " }],
      unresolvedQuestions: [],
      confidence: "MEDIUM",
    }).success).toBe(false);
    expect(researcherResultSchema.safeParse({
      evidence: [factualEvidence, factualEvidence],
      unresolvedQuestions: [],
      confidence: "MEDIUM",
    }).success).toBe(false);
  });

  it("rejects excessive unresolved questions and invalid research confidence", () => {
    expect(researcherResultSchema.safeParse({
      evidence: [],
      unresolvedQuestions: Array.from({ length: maxResearcherUnresolvedQuestions + 1 }, (_, index) => `Questão ${index}`),
      confidence: "LOW",
    }).success).toBe(false);
    expect(researcherResultSchema.safeParse({ evidence: [], unresolvedQuestions: [], confidence: "COMMERCIAL_HIGH" }).success).toBe(false);
    expect(researcherResultSchema.safeParse({ evidence: [], unresolvedQuestions: [], confidence: "LOW" }).success).toBe(true);
    expect(researcherResultSchema.safeParse({ evidence: [], unresolvedQuestions: [], confidence: "MEDIUM" }).success).toBe(true);
    expect(researcherResultSchema.safeParse({ evidence: [], unresolvedQuestions: [], confidence: "HIGH" }).success).toBe(true);
  });

  it("converts evidence structurally without creating analysis or commercial fields", () => {
    const result = researcherResultSchema.parse({
      evidence: [
        factualEvidence,
        { sourceType: "GOOGLE_MAPS", observation: "O perfil registra 86 avaliações." },
      ],
      unresolvedQuestions: [],
      confidence: "HIGH",
    });

    const inputs = toLeadEvidenceInputs(result);

    expect(inputs).toEqual([
      factualEvidence,
      { sourceType: "GOOGLE_MAPS", observation: "O perfil registra 86 avaliações." },
    ]);
    expect(inputs[0]).not.toHaveProperty("confidence");
    expect(inputs[0]).not.toHaveProperty("status");
    expect(inputs[0]).not.toHaveProperty("qualificationScore");
    expect(inputs[0]).not.toHaveProperty("opportunity");
  });
});
