import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import { EvidenceSourceType } from "@/generated/prisma/enums";

import {
  applyLeadEnrichment,
  deriveLeadEnrichmentSuggestions,
  getLeadEnrichmentSuggestions,
  type LeadEnrichmentDependencies,
  type LeadEnrichmentStore,
} from "./lead-enrichment";
import type { LeadEnrichmentCommitter } from "./lead-enrichment-commit";
import type { ResearcherResult } from "./researcher/contracts";

const leadId = "lead-a";
const otherLeadId = "lead-b";
const runId = "run-a";

function result(observation = "Contato: contato@example.com.br, (12) 98817-7647 e (12) 99218-1645."): ResearcherResult {
  return {
    evidence: [{ sourceType: EvidenceSourceType.WEBSITE, sourceUrl: "https://empresa.test/", observation }],
    unresolvedQuestions: ["Horário não confirmado."],
    confidence: "MEDIUM",
  };
}

function storedRun(status = "APPROVED", approvedIndexes: number[] | null = [0], value = result()) {
  return {
    id: runId,
    leadId,
    status,
    resultJson: JSON.stringify(value),
    approvedEvidenceIndexesJson: approvedIndexes === null ? null : JSON.stringify(approvedIndexes),
  };
}

function createDependencies(options: {
  lead?: { email: string | null; phone: string | null; whatsapp: string | null };
  run?: ReturnType<typeof storedRun> | null;
  mutateBeforeCommit?: () => void;
  commitResult?: { committed: boolean };
} = {}) {
  const lead = {
    id: leadId,
    email: null,
    phone: null,
    whatsapp: null,
    qualificationScore: 0,
    status: "NEW",
    mainProblem: null,
    notes: null,
    primaryService: null,
    nextFollowUpAt: null,
    lastContactAt: null,
    analysis: null,
    updatedAt: "unchanged",
    ...options.lead,
  };
  const run = options.run === undefined ? storedRun() : options.run;
  const commit = vi.fn(async (input: Parameters<LeadEnrichmentCommitter["commit"]>[0]) => {
    options.mutateBeforeCommit?.();
    const matches = input.leadId === leadId && Object.entries(input.expected).every(([field, value]) => lead[field as "email" | "phone" | "whatsapp"] === value);
    if (!matches) return { committed: false };
    if (options.commitResult) return options.commitResult;
    Object.assign(lead, input.changes);
    lead.updatedAt = "changed";
    return { committed: true };
  });
  const store: LeadEnrichmentStore = {
    findRun: vi.fn(async (id) => id === runId ? run : null),
    findLead: vi.fn(async (id) => id === leadId ? lead : null),
  };
  return { lead, run, store, dependencies: { store, committer: { commit } } satisfies LeadEnrichmentDependencies, commit };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe("Lead Enrichment V1", () => {
  it("extracts normalized emails and two readable Brazilian phones without assuming WhatsApp", () => {
    const suggestions = deriveLeadEnrichmentSuggestions(result(), [0]);
    expect(suggestions.map(({ field, value }) => ({ field, value }))).toEqual([
      { field: "EMAIL", value: "contato@example.com.br" },
      { field: "PHONE", value: "(12) 98817-7647" },
      { field: "PHONE", value: "(12) 99218-1645" },
    ]);
    expect(suggestions.some((suggestion) => suggestion.field === "WHATSAPP")).toBe(false);
  });

  it("dedupes normalized email values and derives WhatsApp only from an explicit marker", () => {
    const evidence: ResearcherResult = {
      evidence: [
        { sourceType: EvidenceSourceType.WEBSITE, observation: "Email: CONTATO@EXAMPLE.COM.BR. WhatsApp: +55 (12) 98817-7647." },
        { sourceType: EvidenceSourceType.WEBSITE, observation: "contato@example.com.br" },
      ],
      unresolvedQuestions: [],
      confidence: "HIGH",
    };
    const suggestions = deriveLeadEnrichmentSuggestions(evidence, [0, 1]);
    expect(suggestions.filter((suggestion) => suggestion.field === "EMAIL")).toHaveLength(1);
    expect(suggestions.filter((suggestion) => suggestion.field === "WHATSAPP").map((item) => item.value)).toEqual(["(12) 98817-7647"]);
  });

  it("recognizes wa.me and api.whatsapp.com as explicit WhatsApp provenance", () => {
    const evidence: ResearcherResult = {
      evidence: [
        { sourceType: EvidenceSourceType.WEBSITE, observation: "https://wa.me/5512988177647" },
        { sourceType: EvidenceSourceType.WEBSITE, observation: "https://api.whatsapp.com/send?phone=5512992181645" },
      ],
      unresolvedQuestions: [],
      confidence: "HIGH",
    };
    expect(deriveLeadEnrichmentSuggestions(evidence, [0, 1]).filter((item) => item.field === "WHATSAPP").map((item) => item.value)).toEqual([
      "(12) 98817-7647",
      "(12) 99218-1645",
    ]);
  });

  it("ignores unsupported facts and every unapproved evidence candidate", () => {
    const evidence: ResearcherResult = {
      evidence: [
        { sourceType: EvidenceSourceType.WEBSITE, observation: "Serviços, CTA e localização somente." },
        { sourceType: EvidenceSourceType.WEBSITE, observation: "E-mail oculto@example.com e WhatsApp (12) 98817-7647." },
      ],
      unresolvedQuestions: [],
      confidence: "LOW",
    };
    expect(deriveLeadEnrichmentSuggestions(evidence, [0])).toEqual([]);
  });

  it("does not treat an unlabeled short numeric fact as a phone without inventing a DDD", () => {
    const evidence: ResearcherResult = {
      evidence: [{ sourceType: EvidenceSourceType.WEBSITE, observation: "A empresa atua desde 2024-2025." }],
      unresolvedQuestions: [],
      confidence: "LOW",
    };
    expect(deriveLeadEnrichmentSuggestions(evidence, [0])).toEqual([]);
  });

  it("fills blank allowed contact fields without changing commercial fields", async () => {
    const fake = createDependencies();
    const suggestions = deriveLeadEnrichmentSuggestions(result(), [0]);
    const applied = await applyLeadEnrichment(leadId, runId, {
      suggestionIds: [
        suggestions.find((item) => item.field === "EMAIL")!.id,
        suggestions.find((item) => item.field === "PHONE")!.id,
      ],
    }, fake.dependencies);

    expect(applied.fields.map((field) => field.outcome)).toEqual(["FILLED", "FILLED"]);
    expect(fake.lead.email).toBe("contato@example.com.br");
    expect(fake.lead.phone).toBe("(12) 98817-7647");
    expect(fake.lead.whatsapp).toBeNull();
    expect(fake.lead).toMatchObject({ qualificationScore: 0, status: "NEW", mainProblem: null, notes: null, primaryService: null, nextFollowUpAt: null, lastContactAt: null, analysis: null });
    expect(fake.commit).toHaveBeenCalledWith(expect.objectContaining({
      changes: { email: "contato@example.com.br", phone: "(12) 98817-7647" },
    }));
  });

  it("fills WhatsApp only when explicitly supported by approved evidence", async () => {
    const fake = createDependencies({ run: storedRun("APPROVED", [0], result("WhatsApp: (12) 98817-7647.")) });
    const suggestion = deriveLeadEnrichmentSuggestions(result("WhatsApp: (12) 98817-7647."), [0]).find((item) => item.field === "WHATSAPP");
    expect(suggestion).toBeDefined();
    await applyLeadEnrichment(leadId, runId, { suggestionIds: [suggestion!.id] }, fake.dependencies);
    expect(fake.lead.whatsapp).toBe("(12) 98817-7647");
  });

  it("is idempotent for the same normalized value and writes nothing", async () => {
    const fake = createDependencies({ lead: { email: " CONTATO@EXAMPLE.COM.BR ", phone: null, whatsapp: null } });
    const suggestion = deriveLeadEnrichmentSuggestions(result(), [0]).find((item) => item.field === "EMAIL")!;
    const applied = await applyLeadEnrichment(leadId, runId, { suggestionIds: [suggestion.id] }, fake.dependencies);
    expect(applied.fields).toMatchObject([{ outcome: "ALREADY_PRESENT" }]);
    expect(fake.commit).not.toHaveBeenCalled();
    expect(fake.lead.updatedAt).toBe("unchanged");
  });

  it("does not create a mutation audit or touch updatedAt when every selected value is already present", async () => {
    const approvedResult = result("E-mail: contato@example.com.br. WhatsApp: (12) 98817-7647.");
    const fake = createDependencies({
      run: storedRun("APPROVED", [0], approvedResult),
      lead: { email: "CONTATO@EXAMPLE.COM.BR", phone: null, whatsapp: "(12) 98817-7647" },
    });
    const suggestions = deriveLeadEnrichmentSuggestions(approvedResult, [0]);
    const applied = await applyLeadEnrichment(leadId, runId, {
      suggestionIds: [
        suggestions.find((item) => item.field === "EMAIL")!.id,
        suggestions.find((item) => item.field === "WHATSAPP")!.id,
      ],
    }, fake.dependencies);

    expect(applied.fields.map((field) => field.outcome)).toEqual(["ALREADY_PRESENT", "ALREADY_PRESENT"]);
    expect(fake.commit).not.toHaveBeenCalled();
    expect(fake.lead.updatedAt).toBe("unchanged");
  });

  it("never overwrites a different existing CRM contact value", async () => {
    const fake = createDependencies({ lead: { email: "outro@example.com.br", phone: null, whatsapp: null } });
    const suggestion = deriveLeadEnrichmentSuggestions(result(), [0]).find((item) => item.field === "EMAIL")!;
    await expectCode(applyLeadEnrichment(leadId, runId, { suggestionIds: [suggestion.id] }, fake.dependencies), "LEAD_ENRICHMENT_FIELD_CONFLICT");
    expect(fake.commit).not.toHaveBeenCalled();
    expect(fake.lead.email).toBe("outro@example.com.br");
  });

  it("rejects multiple values for the same field before any write", async () => {
    const fake = createDependencies();
    const phones = deriveLeadEnrichmentSuggestions(result(), [0]).filter((item) => item.field === "PHONE");
    await expectCode(applyLeadEnrichment(leadId, runId, { suggestionIds: phones.map((item) => item.id) }, fake.dependencies), "ENRICHMENT_MULTIPLE_VALUES_FOR_FIELD");
    expect(fake.commit).not.toHaveBeenCalled();
  });

  it("regenerates suggestions server-side and rejects invented values, fields and source facts", async () => {
    const fake = createDependencies();
    await expectCode(applyLeadEnrichment(leadId, runId, {
      suggestionIds: ["lead-enrichment:invented"],
      email: "attacker@example.com",
      field: "EMAIL",
      sourceUrl: "https://attacker.test",
    }, fake.dependencies), "LEAD_ENRICHMENT_INPUT_INVALID");
    await expectCode(applyLeadEnrichment(leadId, runId, { suggestionIds: ["lead-enrichment:invented"] }, fake.dependencies), "LEAD_ENRICHMENT_SUGGESTION_NOT_FOUND");
  });

  it.each(["PENDING_REVIEW", "APPROVING", "REJECTED"]) ("rejects enrichment from %s runs", async (status) => {
    const fake = createDependencies({ run: storedRun(status) });
    await expectCode(getLeadEnrichmentSuggestions(leadId, runId, fake.dependencies), "LEAD_ENRICHMENT_RUN_NOT_APPROVED");
    await expectCode(applyLeadEnrichment(leadId, runId, { suggestionIds: ["any"] }, fake.dependencies), "LEAD_ENRICHMENT_RUN_NOT_APPROVED");
    expect(fake.commit).not.toHaveBeenCalled();
  });

  it("blocks cross-lead access before a contact write", async () => {
    const fake = createDependencies();
    const suggestion = deriveLeadEnrichmentSuggestions(result(), [0])[0];
    await expectCode(getLeadEnrichmentSuggestions(otherLeadId, runId, fake.dependencies), "RESEARCH_RUN_NOT_FOUND");
    await expectCode(applyLeadEnrichment(otherLeadId, runId, { suggestionIds: [suggestion.id] }, fake.dependencies), "RESEARCH_RUN_NOT_FOUND");
    expect(fake.commit).not.toHaveBeenCalled();
  });

  it("fails closed when a concurrent change defeats the conditional update", async () => {
    const fake = createDependencies({ mutateBeforeCommit: () => { fake.lead.phone = "(12) 3333-4444"; } });
    const suggestion = deriveLeadEnrichmentSuggestions(result(), [0]).find((item) => item.field === "PHONE")!;
    await expectCode(applyLeadEnrichment(leadId, runId, { suggestionIds: [suggestion.id] }, fake.dependencies), "LEAD_ENRICHMENT_FIELD_CONFLICT");
    expect(fake.lead.phone).toBe("(12) 3333-4444");
    expect(fake.commit).toHaveBeenCalledTimes(1);
  });

  it("does not partially fill a multi-field selection when one CAS guard loses", async () => {
    const fake = createDependencies({ mutateBeforeCommit: () => { fake.lead.email = "other@example.com.br"; } });
    const suggestions = deriveLeadEnrichmentSuggestions(result(), [0]);
    await expectCode(applyLeadEnrichment(leadId, runId, {
      suggestionIds: [
        suggestions.find((item) => item.field === "EMAIL")!.id,
        suggestions.find((item) => item.field === "PHONE")!.id,
      ],
    }, fake.dependencies), "LEAD_ENRICHMENT_FIELD_CONFLICT");
    expect(fake.lead.email).toBe("other@example.com.br");
    expect(fake.lead.phone).toBeNull();
    expect(fake.commit).toHaveBeenCalledTimes(1);
  });

  it("commits only missing fields and audits only their actual changes", async () => {
    const fake = createDependencies({ lead: { email: "CONTATO@EXAMPLE.COM.BR", phone: null, whatsapp: null } });
    const suggestions = deriveLeadEnrichmentSuggestions(result(), [0]);
    const email = suggestions.find((item) => item.field === "EMAIL")!;
    const phone = suggestions.find((item) => item.field === "PHONE")!;

    const applied = await applyLeadEnrichment(leadId, runId, { suggestionIds: [email.id, phone.id] }, fake.dependencies);

    expect(applied.fields.map((field) => field.outcome)).toEqual(["ALREADY_PRESENT", "FILLED"]);
    expect(fake.commit).toHaveBeenCalledWith(expect.objectContaining({
      expected: { phone: null },
      changes: { phone: "(12) 98817-7647" },
      beforeData: { phone: null },
      afterData: { phone: "(12) 98817-7647" },
    }));
  });

  it("rejects a mixed selection as a whole when any current CRM value conflicts", async () => {
    const fake = createDependencies({ lead: { email: "outro@example.com.br", phone: null, whatsapp: null } });
    const suggestions = deriveLeadEnrichmentSuggestions(result(), [0]);
    await expectCode(applyLeadEnrichment(leadId, runId, {
      suggestionIds: [
        suggestions.find((item) => item.field === "EMAIL")!.id,
        suggestions.find((item) => item.field === "PHONE")!.id,
      ],
    }, fake.dependencies), "LEAD_ENRICHMENT_FIELD_CONFLICT");
    expect(fake.lead.phone).toBeNull();
    expect(fake.commit).not.toHaveBeenCalled();
  });

  it("treats a same-value CAS loser as an idempotent success without a second mutation audit", async () => {
    const fake = createDependencies({ mutateBeforeCommit: () => { fake.lead.email = "contato@example.com.br"; } });
    const email = deriveLeadEnrichmentSuggestions(result(), [0]).find((item) => item.field === "EMAIL")!;

    const applied = await applyLeadEnrichment(leadId, runId, { suggestionIds: [email.id] }, fake.dependencies);

    expect(applied.fields).toMatchObject([{ outcome: "ALREADY_PRESENT" }]);
    expect(fake.commit).toHaveBeenCalledTimes(1);
  });
});
