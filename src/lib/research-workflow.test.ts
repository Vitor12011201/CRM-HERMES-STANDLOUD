import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

import type { ResolvedAgentPrompt } from "@/lib/agent-prompt-config";
import type { ResearcherModelClient } from "@/lib/researcher/dry-run";
import type { LeadEvidenceInput } from "@/lib/services/lead-research";
import type { ResearchApprovalCommitInput, ResearchApprovalCommitter } from "./research-workflow-approval-commit";
import {
  approveLeadResearchRun,
  getResearcherHermesModelClientOptions,
  rejectLeadResearchRun,
  startLeadResearch,
  type ResearchWorkflowDependencies,
  type ResearchWorkflowLead,
  type ResearchWorkflowStore,
  type StoredLeadResearchRun,
} from "./research-workflow";

const lead: ResearchWorkflowLead = {
  id: "lead-1",
  companyName: "Empresa Factual",
  city: "Jacarei",
  region: "SP",
  segment: "Contabilidade",
  primaryService: "Contabilidade empresarial",
  websiteUrl: "https://empresa.example.test",
};

const snapshot = {
  sourceType: "WEBSITE" as const,
  sourceUrl: lead.websiteUrl!,
  title: "Empresa Factual",
  content: "A Empresa Factual apresenta seus serviços contábeis e canais de contato no website.",
};

function researcherResult(evidenceCount = 1) {
  return {
    evidence: Array.from({ length: evidenceCount }, (_, index) => ({
      sourceType: "WEBSITE" as const,
      sourceUrl: lead.websiteUrl!,
      observation: `Observação factual ${index + 1} no website.`,
    })),
    unresolvedQuestions: ["Não foi possível confirmar horário de atendimento."],
    confidence: "MEDIUM" as const,
  };
}

class MemoryStore implements ResearchWorkflowStore {
  readonly leads = new Map<string, ResearchWorkflowLead>([[lead.id, { ...lead }]]);
  readonly runs = new Map<string, StoredLeadResearchRun>();
  readonly createRun = vi.fn(async (input: Omit<StoredLeadResearchRun, "id" | "createdAt" | "updatedAt">) => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    const run = { ...input, id: `run-${this.runs.size + 1}`, createdAt: now, updatedAt: now };
    this.runs.set(run.id, { ...run });
    return { ...run };
  });
  readonly findLead = vi.fn(async (leadId: string) => {
    const found = this.leads.get(leadId);
    return found ? { ...found } : null;
  });
  readonly findRun = vi.fn(async (runId: string) => {
    const found = this.runs.get(runId);
    return found ? { ...found } : null;
  });
  readonly listRuns = vi.fn(async (leadId: string) => [...this.runs.values()]
    .filter((run) => run.leadId === leadId)
    .map((run) => ({ ...run })));
  readonly compareAndSetRun = vi.fn(async (input: {
    id: string;
    expectedStatus: StoredLeadResearchRun["status"];
    status: StoredLeadResearchRun["status"];
    approvedEvidenceIndexesJson?: string | null;
    reviewedAt?: Date | null;
  }) => {
    const current = this.runs.get(input.id);
    if (!current || current.status !== input.expectedStatus) return 0;
    this.runs.set(input.id, {
      ...current,
      status: input.status,
      ...(input.approvedEvidenceIndexesJson === undefined ? {} : { approvedEvidenceIndexesJson: input.approvedEvidenceIndexesJson }),
      ...(input.reviewedAt === undefined ? {} : { reviewedAt: input.reviewedAt }),
      updatedAt: new Date("2026-09-24T12:01:00.000Z"),
    });
    return 1;
  });
}

type StoredEvidence = LeadEvidenceInput & { capturedBy: "AGENT" };

function exactEvidenceKey(evidence: Pick<LeadEvidenceInput, "sourceType" | "sourceUrl" | "observation">): string {
  return JSON.stringify([evidence.sourceType, evidence.sourceUrl ?? null, evidence.observation]);
}

function createMemoryApprovalCommitter(store: MemoryStore, evidence: StoredEvidence[]): ResearchApprovalCommitter {
  return {
    commit: vi.fn(async (input: ResearchApprovalCommitInput) => {
      const run = store.runs.get(input.runId);
      if (!run || run.leadId !== input.leadId || run.status !== "APPROVING") return { committed: false };

      // The fake mirrors one D1 transaction: calculate exact misses first, then
      // apply every evidence insert plus the terminal status in one commit.
      const known = new Set(evidence.map(exactEvidenceKey));
      const staged = input.evidence.filter((item) => !known.has(exactEvidenceKey(item)));
      evidence.push(...staged.map((item) => ({ ...item, capturedBy: "AGENT" as const })));
      store.runs.set(run.id, {
        ...run,
        status: "APPROVED",
        reviewedAt: new Date("2026-09-24T12:02:00.000Z"),
        updatedAt: new Date("2026-09-24T12:02:00.000Z"),
      });
      return { committed: true };
    }),
  };
}

function createDependencies(overrides: Partial<ResearchWorkflowDependencies> = {}) {
  const store = new MemoryStore();
  const evidence: StoredEvidence[] = [];
  const approvalCommitter = createMemoryApprovalCommitter(store, evidence);
  const modelClient: ResearcherModelClient = { complete: vi.fn().mockResolvedValue(JSON.stringify(researcherResult())) };
  const prompt: ResolvedAgentPrompt = {
    source: "BUILT_IN",
    activeVersion: null,
    content: "Prompt resolved once for this run.",
  };
  const dependencies: ResearchWorkflowDependencies = {
    store,
    acquireWebsite: vi.fn().mockResolvedValue(snapshot),
    resolvePrompt: vi.fn().mockResolvedValue(prompt),
    createModelClient: vi.fn(() => modelClient),
    approvalCommitter,
    ...overrides,
  };
  return { dependencies, store, evidence, approvalCommitter, modelClient, prompt };
}

async function expectWorkflowError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe("Lead research workflow", () => {
  it("uses only the dedicated researcher Hermes key when assembling the live client configuration", () => {
    const options = getResearcherHermesModelClientOptions({
      HERMES_BASE_URL: "http://127.0.0.1:8642",
      HERMES_RESEARCHER_API_KEY: "researcher-test-key",
      // Deliberately present at runtime but outside the Researcher environment contract.
      HERMES_API_KEY: "assistant-default-key",
    } as unknown as Parameters<typeof getResearcherHermesModelClientOptions>[0]);

    expect(options).toEqual({
      gatewayBaseUrl: "http://127.0.0.1:8642",
      apiKey: "researcher-test-key",
      model: "gpt-5.6-terra",
    });
  });

  it("does not fall back to the Assistant key when the dedicated researcher key is absent", async () => {
    const options = getResearcherHermesModelClientOptions({
      HERMES_BASE_URL: "http://127.0.0.1:8642",
    });
    expect(options.apiKey).toBe("");

    const { dependencies, store } = createDependencies({
      createModelClient: () => {
        throw new Error("missing dedicated researcher credential");
      },
    });
    await expectWorkflowError(startLeadResearch(lead.id, dependencies), "RESEARCHER_UNAVAILABLE");
    expect(store.createRun).not.toHaveBeenCalled();
  });

  it("fails before the model and before a run when the persisted lead has no website", async () => {
    const { dependencies, store } = createDependencies();
    store.leads.set(lead.id, { ...lead, websiteUrl: null });

    await expectWorkflowError(startLeadResearch(lead.id, dependencies), "RESEARCH_WEBSITE_REQUIRED");
    expect(dependencies.acquireWebsite).not.toHaveBeenCalled();
    expect(dependencies.createModelClient).not.toHaveBeenCalled();
    expect(store.createRun).not.toHaveBeenCalled();
  });

  it("fails closed for an invalid persisted website before acquisition or model execution", async () => {
    const { dependencies, store } = createDependencies();
    store.leads.set(lead.id, { ...lead, websiteUrl: "javascript:alert(1)" });

    await expectWorkflowError(startLeadResearch(lead.id, dependencies), "RESEARCH_WEBSITE_INVALID");
    expect(dependencies.acquireWebsite).not.toHaveBeenCalled();
    expect(dependencies.createModelClient).not.toHaveBeenCalled();
    expect(store.createRun).not.toHaveBeenCalled();
  });

  it("does not persist a partial run for acquisition, prompt, model, or invalid-result failures", async () => {
    const cases: Array<[Partial<ResearchWorkflowDependencies>, string]> = [
      [{ acquireWebsite: vi.fn().mockRejectedValue(new Error("network")) }, "RESEARCH_WEBSITE_ACQUISITION_FAILED"],
      [{ resolvePrompt: vi.fn().mockRejectedValue(new Error("database")) }, "RESEARCHER_UNAVAILABLE"],
      [{ createModelClient: () => ({ complete: vi.fn().mockRejectedValue(new Error("transport")) }) }, "RESEARCHER_UNAVAILABLE"],
      [{ createModelClient: () => ({ complete: vi.fn().mockResolvedValue("not json") }) }, "RESEARCHER_RESULT_INVALID"],
    ];
    for (const [overrides, code] of cases) {
      const { dependencies, store } = createDependencies(overrides);
      await expectWorkflowError(startLeadResearch(lead.id, dependencies), code);
      expect(store.createRun).not.toHaveBeenCalled();
    }
  });

  it("builds input only from the persisted lead, resolves one prompt, and persists one PENDING_REVIEW run", async () => {
    const { dependencies, modelClient, approvalCommitter, prompt } = createDependencies();
    const run = await startLeadResearch(lead.id, dependencies);

    expect(run.status).toBe("PENDING_REVIEW");
    expect(run.technicalId).toBe("researcher");
    expect(run.input.lead).toMatchObject({ id: lead.id, companyName: lead.companyName, city: lead.city, region: lead.region, segment: lead.segment, primaryService: lead.primaryService });
    expect(run.input.knownSources).toEqual({ websiteUrl: lead.websiteUrl });
    expect(run.input.allowedSourceTypes).toEqual(["WEBSITE"]);
    expect(run.input.goal).toContain("Não faça qualificação");
    expect(run.snapshots).toEqual([snapshot]);
    expect(run.promptSource).toBe("BUILT_IN");
    expect(run.promptVersion).toBeNull();
    expect(dependencies.resolvePrompt).toHaveBeenCalledTimes(1);
    expect(modelClient.complete).toHaveBeenCalledTimes(1);
    expect(vi.mocked(modelClient.complete).mock.calls[0][0].messages[0]).toEqual({ role: "system", content: prompt.content });
    expect(approvalCommitter.commit).not.toHaveBeenCalled();
  });

  it("records configured prompt metadata from the same prompt injected into the model request", async () => {
    const configured: ResolvedAgentPrompt = { source: "CONFIGURED", activeVersion: 7, content: "Configured researcher prompt v7." };
    const { dependencies, modelClient } = createDependencies({ resolvePrompt: vi.fn().mockResolvedValue(configured) });
    const run = await startLeadResearch(lead.id, dependencies);

    expect(run.promptSource).toBe("CONFIGURED");
    expect(run.promptVersion).toBe(7);
    expect(vi.mocked(modelClient.complete).mock.calls[0][0].messages[0].content).toBe(configured.content);
  });

  it("accepts only explicit indexes, atomically stores AGENT evidence, and stores no commercial fields", async () => {
    const { dependencies, evidence, approvalCommitter } = createDependencies();
    const run = await startLeadResearch(lead.id, dependencies);

    await expectWorkflowError(approveLeadResearchRun(lead.id, run.id, { approvedEvidenceIndexes: [0, 0] }, dependencies), "RESEARCH_APPROVAL_INPUT_INVALID");
    await expectWorkflowError(approveLeadResearchRun(lead.id, run.id, {
      approvedEvidenceIndexes: [0], evidence: [{ observation: "browser-supplied evidence" }],
    }, dependencies), "RESEARCH_APPROVAL_INPUT_INVALID");
    const approved = await approveLeadResearchRun(lead.id, run.id, { approvedEvidenceIndexes: [0] }, dependencies);

    expect(approved.status).toBe("APPROVED");
    expect(approved.reviewedAt).toBeInstanceOf(Date);
    expect(approvalCommitter.commit).toHaveBeenCalledWith(expect.objectContaining({
      runId: run.id, leadId: lead.id,
      evidence: [expect.objectContaining({ sourceType: "WEBSITE", observation: "Observação factual 1 no website." })],
    }));
    expect(evidence).toEqual([expect.objectContaining({ capturedBy: "AGENT" })]);
    expect(JSON.stringify(evidence[0])).not.toContain("confidence");
    expect(JSON.stringify(evidence[0])).not.toContain("unresolvedQuestions");
  });

  it("atomically recovers APPROVING using the persisted selection and ignores browser retry indexes", async () => {
    const { dependencies, store, evidence, approvalCommitter } = createDependencies({
      createModelClient: () => ({ complete: vi.fn().mockResolvedValue(JSON.stringify(researcherResult(3))) }),
    });
    const run = await startLeadResearch(lead.id, dependencies);
    const stored = store.runs.get(run.id)!;
    store.runs.set(run.id, { ...stored, status: "APPROVING", approvedEvidenceIndexesJson: "[0]", reviewedAt: null });

    const approved = await approveLeadResearchRun(lead.id, run.id, { approvedEvidenceIndexes: [1, 2] }, dependencies);

    expect(approved.status).toBe("APPROVED");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.observation).toBe("Observação factual 1 no website.");
    expect(vi.mocked(approvalCommitter.commit).mock.calls[0]?.[0].evidence).toHaveLength(1);
  });

  it("allows one PENDING_REVIEW claim winner and makes concurrent retries exact-dedupe safe", async () => {
    const { dependencies, evidence, approvalCommitter } = createDependencies({
      createModelClient: () => ({ complete: vi.fn().mockResolvedValue(JSON.stringify(researcherResult(2))) }),
    });
    const run = await startLeadResearch(lead.id, dependencies);
    const [first, second] = await Promise.all([
      approveLeadResearchRun(lead.id, run.id, { approvedEvidenceIndexes: [0, 1] }, dependencies),
      approveLeadResearchRun(lead.id, run.id, { approvedEvidenceIndexes: [0, 1] }, dependencies),
    ]);

    expect(first.status).toBe("APPROVED");
    expect(second.status).toBe("APPROVED");
    expect(evidence).toHaveLength(2);
    expect(new Set(evidence.map(exactEvidenceKey)).size).toBe(2);
    expect(approvalCommitter.commit).toHaveBeenCalledTimes(1);
  });

  it("completes concurrent APPROVING retries without duplicate exact evidence", async () => {
    const { dependencies, store, evidence, approvalCommitter } = createDependencies({
      createModelClient: () => ({ complete: vi.fn().mockResolvedValue(JSON.stringify(researcherResult(2))) }),
    });
    const run = await startLeadResearch(lead.id, dependencies);
    const stored = store.runs.get(run.id)!;
    store.runs.set(run.id, { ...stored, status: "APPROVING", approvedEvidenceIndexesJson: "[0,1]", reviewedAt: null });

    const originalCommit = vi.mocked(approvalCommitter.commit).getMockImplementation()!;
    let releaseFirst: (() => void) | undefined;
    let firstStarted: (() => void) | undefined;
    let secondStarted: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstStartedPromise = new Promise<void>((resolve) => { firstStarted = resolve; });
    const secondStartedPromise = new Promise<void>((resolve) => { secondStarted = resolve; });
    let calls = 0;
    vi.mocked(approvalCommitter.commit).mockImplementation(async (input) => {
      calls += 1;
      if (calls === 1) {
        firstStarted?.();
        await firstGate;
      }
      if (calls === 2) secondStarted?.();
      return originalCommit(input);
    });

    const retryA = approveLeadResearchRun(lead.id, run.id, { approvedEvidenceIndexes: [] }, dependencies);
    await firstStartedPromise;
    const retryB = approveLeadResearchRun(lead.id, run.id, { approvedEvidenceIndexes: [0] }, dependencies);
    await secondStartedPromise;
    releaseFirst?.();
    const [first, second] = await Promise.all([retryA, retryB]);

    expect(first.status).toBe("APPROVED");
    expect(second.status).toBe("APPROVED");
    expect(approvalCommitter.commit).toHaveBeenCalledTimes(2);
    expect(evidence).toHaveLength(2);
    expect(new Set(evidence.map(exactEvidenceKey)).size).toBe(2);
  });

  it("fails closed for storage-invalid approval state", async () => {
    const { dependencies, store } = createDependencies();
    const run = await startLeadResearch(lead.id, dependencies);
    const stored = store.runs.get(run.id)!;
    store.runs.set(run.id, { ...stored, status: "APPROVING", approvedEvidenceIndexesJson: null, reviewedAt: null });
    await expectWorkflowError(approveLeadResearchRun(lead.id, run.id, { approvedEvidenceIndexes: [] }, dependencies), "RESEARCH_RUN_STORAGE_INVALID");
  });

  it("rolls back all new evidence on an atomic batch failure and retries the full persisted batch", async () => {
    const { dependencies, store, evidence, approvalCommitter } = createDependencies({
      createModelClient: () => ({ complete: vi.fn().mockResolvedValue(JSON.stringify(researcherResult(3))) }),
    });
    vi.mocked(approvalCommitter.commit).mockRejectedValueOnce(new Error("third statement failure"));
    const run = await startLeadResearch(lead.id, dependencies);

    await expectWorkflowError(approveLeadResearchRun(lead.id, run.id, { approvedEvidenceIndexes: [0, 1, 2] }, dependencies), "RESEARCH_APPROVAL_COMMIT_FAILED");
    expect(store.runs.get(run.id)?.status).toBe("APPROVING");
    expect(evidence).toHaveLength(0);

    const recovered = await approveLeadResearchRun(lead.id, run.id, { approvedEvidenceIndexes: [] }, dependencies);
    expect(recovered.status).toBe("APPROVED");
    expect(evidence).toHaveLength(3);
    expect(new Set(evidence.map(exactEvidenceKey)).size).toBe(3);
  });

  it("fills only exact missing evidence in a legacy partial APPROVING state and then completes", async () => {
    const { dependencies, store, evidence } = createDependencies({
      createModelClient: () => ({ complete: vi.fn().mockResolvedValue(JSON.stringify(researcherResult(3))) }),
    });
    const run = await startLeadResearch(lead.id, dependencies);
    const stored = store.runs.get(run.id)!;
    evidence.push({ ...researcherResult(3).evidence[0], capturedBy: "AGENT" }, { ...researcherResult(3).evidence[1], capturedBy: "AGENT" });
    store.runs.set(run.id, { ...stored, status: "APPROVING", approvedEvidenceIndexesJson: "[0,1,2]", reviewedAt: null });

    const recovered = await approveLeadResearchRun(lead.id, run.id, { approvedEvidenceIndexes: [] }, dependencies);
    expect(recovered.status).toBe("APPROVED");
    expect(evidence).toHaveLength(3);
    expect(new Set(evidence.map(exactEvidenceKey)).size).toBe(3);
  });

  it("keeps pre-existing exact evidence singular while completing the atomic approval", async () => {
    const { dependencies, evidence } = createDependencies({
      createModelClient: () => ({ complete: vi.fn().mockResolvedValue(JSON.stringify(researcherResult(3))) }),
    });
    evidence.push({ ...researcherResult(3).evidence[0], capturedBy: "AGENT" });
    const run = await startLeadResearch(lead.id, dependencies);
    const approved = await approveLeadResearchRun(lead.id, run.id, { approvedEvidenceIndexes: [0, 1, 2] }, dependencies);

    expect(approved.status).toBe("APPROVED");
    expect(evidence).toHaveLength(3);
    expect(new Set(evidence.map(exactEvidenceKey)).size).toBe(3);
  });

  it("does not permit a run to cross the lead boundary for approval or rejection", async () => {
    const { dependencies, store, evidence, approvalCommitter } = createDependencies();
    store.leads.set("lead-2", { ...lead, id: "lead-2", companyName: "Outra Empresa" });
    const run = await startLeadResearch(lead.id, dependencies);

    await expectWorkflowError(approveLeadResearchRun("lead-2", run.id, { approvedEvidenceIndexes: [0] }, dependencies), "RESEARCH_RUN_NOT_FOUND");
    await expectWorkflowError(rejectLeadResearchRun("lead-2", run.id, dependencies), "RESEARCH_RUN_NOT_FOUND");
    expect(store.runs.get(run.id)?.status).toBe("PENDING_REVIEW");
    expect(approvalCommitter.commit).not.toHaveBeenCalled();
    expect(evidence).toHaveLength(0);
  });

  it("rejects only PENDING_REVIEW and never writes evidence or commercial lead fields", async () => {
    const { dependencies, store, evidence, approvalCommitter } = createDependencies();
    const beforeLead = { ...store.leads.get(lead.id)! };
    const run = await startLeadResearch(lead.id, dependencies);
    const rejected = await rejectLeadResearchRun(lead.id, run.id, dependencies);

    expect(rejected.status).toBe("REJECTED");
    expect(rejected.reviewedAt).toBeInstanceOf(Date);
    expect(approvalCommitter.commit).not.toHaveBeenCalled();
    expect(evidence).toHaveLength(0);
    expect(store.leads.get(lead.id)).toEqual(beforeLead);
    expect((await rejectLeadResearchRun(lead.id, run.id, dependencies)).status).toBe("REJECTED");
  });

  it("rejects missing leads and never permits browser-provided source facts through the start boundary", async () => {
    const { dependencies, store } = createDependencies();
    await expectWorkflowError(startLeadResearch("missing", dependencies), "RESEARCH_LEAD_NOT_FOUND");
    expect(store.createRun).not.toHaveBeenCalled();
    expect(startLeadResearch.length).toBe(1);
  });
});
