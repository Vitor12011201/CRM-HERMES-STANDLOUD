import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import { applyLeadEnrichment, deriveLeadEnrichmentSuggestions, type LeadEnrichmentDependencies } from "./lead-enrichment";
import type { LeadEnrichmentCommitter } from "./lead-enrichment-commit";
import type { ResearcherResult } from "./researcher/contracts";

const result: ResearcherResult = {
  evidence: [{ sourceType: "WEBSITE", sourceUrl: "https://empresa.test/", observation: "E-mail: contato@example.com.br." }],
  unresolvedQuestions: [],
  confidence: "HIGH",
};

describe("Lead Enrichment atomic audit boundary", () => {
  it("sends Ana's successful mutation audit payload through the atomic committer", async () => {
    const commit = vi.fn<LeadEnrichmentCommitter["commit"]>().mockResolvedValue({ committed: true });
    const dependencies: LeadEnrichmentDependencies = {
      store: {
        findRun: vi.fn().mockResolvedValue({
          id: "run-1",
          leadId: "lead-1",
          status: "APPROVED",
          resultJson: JSON.stringify(result),
          approvedEvidenceIndexesJson: "[0]",
        }),
        findLead: vi.fn().mockResolvedValue({ id: "lead-1", email: null, phone: null, whatsapp: null }),
      },
      committer: { commit },
    };
    const suggestion = deriveLeadEnrichmentSuggestions(result, [0])[0];

    await applyLeadEnrichment("lead-1", "run-1", { suggestionIds: [suggestion.id] }, dependencies);

    expect(commit).toHaveBeenCalledWith({
      leadId: "lead-1",
      expected: { email: null },
      changes: { email: "contato@example.com.br" },
      beforeData: { email: null },
      afterData: { email: "contato@example.com.br" },
    });
  });
});
