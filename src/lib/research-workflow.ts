import { env } from "cloudflare:workers";
import { z } from "zod";

import type { DbClient } from "@/lib/db";
import { getDb } from "@/lib/db";
import {
  type LeadResearchPromptSource,
  type LeadResearchRunStatus,
} from "@/generated/prisma/enums";
import { resolveAgentPrompt, type ResolvedAgentPrompt } from "@/lib/agent-prompt-config";
import {
  prepareApprovedResearchEvidence,
  type ApprovedResearchEvidenceBatch,
} from "@/lib/researcher/evidence-approval";
import {
  researcherInputSchema,
  researcherResultSchema,
  researchSourceSnapshotsSchema,
  type ResearcherInput,
  type ResearcherResult,
  type ResearchSourceSnapshot,
} from "@/lib/researcher/contracts";
import { runResearcherDryRun, ResearcherDryRunError, type ResearcherModelClient } from "@/lib/researcher/dry-run";
import { HermesResearcherModelClient } from "@/lib/researcher/hermes-model-client";
import { acquireWebsiteSnapshot } from "@/lib/researcher/website-acquisition";
import {
  createD1ResearchApprovalCommitter,
  type ResearchApprovalCommitter,
} from "@/lib/research-workflow-approval-commit";

export const researcherTechnicalId = "researcher";
export const researcherModel = "gpt-5.6-terra";
export const maxLeadResearchRuns = 12;

const emptyObjectSchema = z.object({}).strict();
export const leadResearchApprovalInputSchema = z.object({
  approvedEvidenceIndexes: z.array(z.number().int().nonnegative()),
}).strict();

const statusSchema = z.enum(["PENDING_REVIEW", "APPROVING", "APPROVED", "REJECTED"]);
const promptSourceSchema = z.enum(["BUILT_IN", "CONFIGURED"]);
const approvedIndexesSchema = z.array(z.number().int().nonnegative()).superRefine((indexes, context) => {
  if (new Set(indexes).size !== indexes.length) {
    context.addIssue({ code: "custom", message: "Duplicate evidence index." });
  }
});

export type ResearchWorkflowErrorCode =
  | "RESEARCH_LEAD_NOT_FOUND"
  | "RESEARCH_WEBSITE_REQUIRED"
  | "RESEARCH_WEBSITE_INVALID"
  | "RESEARCH_WEBSITE_ACQUISITION_FAILED"
  | "RESEARCHER_UNAVAILABLE"
  | "RESEARCHER_RESULT_INVALID"
  | "RESEARCH_RUN_NOT_FOUND"
  | "RESEARCH_RUN_STORAGE_INVALID"
  | "RESEARCH_RUN_WRITE_FAILED"
  | "RESEARCH_APPROVAL_COMMIT_FAILED"
  | "RESEARCH_START_INPUT_INVALID"
  | "RESEARCH_APPROVAL_INPUT_INVALID"
  | "RESEARCH_APPROVAL_INVALID_STATE"
  | "RESEARCH_APPROVAL_RECONCILIATION_REQUIRED";

/** Sanitized workflow error: never carries HTML, model output, transport details, or secrets. */
export class ResearchWorkflowError extends Error {
  constructor(public readonly code: ResearchWorkflowErrorCode) {
    super(code);
    this.name = "ResearchWorkflowError";
  }
}

export type ResearchWorkflowLead = {
  id: string;
  companyName: string;
  city: string | null;
  region: string | null;
  segment: string | null;
  primaryService: string | null;
  websiteUrl: string | null;
};

export type StoredLeadResearchRun = {
  id: string;
  leadId: string;
  technicalId: string;
  status: LeadResearchRunStatus;
  inputJson: string;
  snapshotsJson: string;
  resultJson: string;
  promptSource: LeadResearchPromptSource;
  promptVersion: number | null;
  model: string;
  approvedEvidenceIndexesJson: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LeadResearchRun = Omit<StoredLeadResearchRun, "inputJson" | "snapshotsJson" | "resultJson" | "approvedEvidenceIndexesJson"> & {
  input: ResearcherInput;
  snapshots: readonly ResearchSourceSnapshot[];
  result: ResearcherResult;
  approvedEvidenceIndexes: readonly number[] | null;
};

/** Browser-safe run view: snapshots remain an audit record in CRM storage, not API payload. */
export type LeadResearchRunDto = {
  id: string;
  leadId: string;
  technicalId: string;
  status: LeadResearchRunStatus;
  promptSource: LeadResearchPromptSource;
  promptVersion: number | null;
  model: string;
  result: ResearcherResult;
  approvedEvidenceIndexes: readonly number[] | null;
  reviewedAt: string | null;
  createdAt: string;
};

export function toLeadResearchRunDto(run: LeadResearchRun): LeadResearchRunDto {
  return {
    id: run.id,
    leadId: run.leadId,
    technicalId: run.technicalId,
    status: run.status,
    promptSource: run.promptSource,
    promptVersion: run.promptVersion,
    model: run.model,
    result: run.result,
    approvedEvidenceIndexes: run.approvedEvidenceIndexes,
    reviewedAt: run.reviewedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
  };
}

export type ResearchWorkflowStore = {
  findLead(leadId: string): Promise<ResearchWorkflowLead | null>;
  createRun(input: Omit<StoredLeadResearchRun, "id" | "createdAt" | "updatedAt">): Promise<StoredLeadResearchRun>;
  findRun(runId: string): Promise<StoredLeadResearchRun | null>;
  listRuns(leadId: string, limit: number): Promise<StoredLeadResearchRun[]>;
  compareAndSetRun(input: {
    id: string;
    expectedStatus: LeadResearchRunStatus;
    status: LeadResearchRunStatus;
    approvedEvidenceIndexesJson?: string | null;
    reviewedAt?: Date | null;
  }): Promise<number>;
};

export type ResearchWorkflowDependencies = {
  store: ResearchWorkflowStore;
  acquireWebsite(url: string): Promise<ResearchSourceSnapshot>;
  resolvePrompt(technicalId: string): Promise<ResolvedAgentPrompt>;
  createModelClient(): ResearcherModelClient;
  approvalCommitter: ResearchApprovalCommitter;
};

/**
 * The Researcher is deliberately authenticated against its named Hermes
 * profile. The Assistant keeps using HERMES_API_KEY in its own route wiring.
 */
export type ResearcherHermesEnvironment = {
  HERMES_BASE_URL?: unknown;
  HERMES_RESEARCHER_API_KEY?: unknown;
};

const leadSelection = {
  id: true,
  companyName: true,
  city: true,
  region: true,
  segment: true,
  primaryService: true,
  websiteUrl: true,
} as const;

function toStoredRun(run: StoredLeadResearchRun): StoredLeadResearchRun {
  return run;
}

export function createResearchWorkflowStore(db: DbClient): ResearchWorkflowStore {
  return {
    async findLead(leadId) {
      return db.lead.findUnique({ where: { id: leadId }, select: leadSelection });
    },
    async createRun(input) {
      return toStoredRun(await db.leadResearchRun.create({ data: input }));
    },
    async findRun(runId) {
      const run = await db.leadResearchRun.findUnique({ where: { id: runId } });
      return run ? toStoredRun(run) : null;
    },
    async listRuns(leadId, limit) {
      return (await db.leadResearchRun.findMany({
        where: { leadId },
        orderBy: { createdAt: "desc" },
        take: limit,
      })).map(toStoredRun);
    },
    async compareAndSetRun(input) {
      const result = await db.leadResearchRun.updateMany({
        where: { id: input.id, status: input.expectedStatus },
        data: {
          status: input.status,
          ...(input.approvedEvidenceIndexesJson === undefined
            ? {}
            : { approvedEvidenceIndexesJson: input.approvedEvidenceIndexesJson }),
          ...(input.reviewedAt === undefined ? {} : { reviewedAt: input.reviewedAt }),
        },
      });
      return result.count;
    },
  };
}

export function getResearcherHermesModelClientOptions(
  hermes: ResearcherHermesEnvironment,
) {
  return {
    gatewayBaseUrl: typeof hermes.HERMES_BASE_URL === "string" ? hermes.HERMES_BASE_URL : "",
    // No fallback to HERMES_API_KEY: a missing dedicated credential must make
    // the Research Workflow unavailable instead of crossing profile boundaries.
    apiKey: typeof hermes.HERMES_RESEARCHER_API_KEY === "string"
      ? hermes.HERMES_RESEARCHER_API_KEY
      : "",
    model: researcherModel,
  };
}

function createLiveDependencies(): ResearchWorkflowDependencies {
  const db = getDb();
  const hermes = env as unknown as ResearcherHermesEnvironment;
  return {
    store: createResearchWorkflowStore(db),
    acquireWebsite: async (url) => acquireWebsiteSnapshot({ url }),
    resolvePrompt: resolveAgentPrompt,
    createModelClient: () => new HermesResearcherModelClient(
      getResearcherHermesModelClientOptions(hermes),
    ),
    approvalCommitter: createD1ResearchApprovalCommitter(env.DB),
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new ResearchWorkflowError("RESEARCH_RUN_STORAGE_INVALID");
  }
}

function parseStoredRun(run: StoredLeadResearchRun): LeadResearchRun {
  const status = statusSchema.safeParse(run.status);
  const promptSource = promptSourceSchema.safeParse(run.promptSource);
  const input = researcherInputSchema.safeParse(parseJson(run.inputJson));
  const snapshots = researchSourceSnapshotsSchema.safeParse(parseJson(run.snapshotsJson));
  const result = researcherResultSchema.safeParse(parseJson(run.resultJson));
  const indexes = run.approvedEvidenceIndexesJson === null
    ? null
    : approvedIndexesSchema.safeParse(parseJson(run.approvedEvidenceIndexesJson));

  if (!status.success || !promptSource.success || !input.success || !snapshots.success || !result.success
    || (indexes !== null && !indexes.success)) {
    throw new ResearchWorkflowError("RESEARCH_RUN_STORAGE_INVALID");
  }

  const approvedEvidenceIndexes = indexes === null ? null : indexes.data;
  const validPrompt = (promptSource.data === "BUILT_IN" && run.promptVersion === null)
    || (promptSource.data === "CONFIGURED" && Number.isInteger(run.promptVersion) && run.promptVersion! > 0);
  const validState = (status.data === "PENDING_REVIEW" && approvedEvidenceIndexes === null && run.reviewedAt === null)
    || (status.data === "APPROVING" && approvedEvidenceIndexes !== null && run.reviewedAt === null)
    || (status.data === "APPROVED" && approvedEvidenceIndexes !== null && run.reviewedAt !== null)
    || (status.data === "REJECTED" && approvedEvidenceIndexes === null && run.reviewedAt !== null);
  if (!validPrompt || !validState || run.technicalId !== researcherTechnicalId) {
    throw new ResearchWorkflowError("RESEARCH_RUN_STORAGE_INVALID");
  }

  return {
    ...run,
    status: status.data,
    promptSource: promptSource.data,
    input: input.data,
    snapshots: snapshots.data,
    result: result.data,
    approvedEvidenceIndexes,
  };
}

function buildServerInput(lead: ResearchWorkflowLead): ResearcherInput {
  return researcherInputSchema.parse({
    lead: {
      id: lead.id,
      companyName: lead.companyName,
      ...(lead.city === null ? {} : { city: lead.city }),
      ...(lead.region === null ? {} : { region: lead.region }),
      ...(lead.segment === null ? {} : { segment: lead.segment }),
      ...(lead.primaryService === null ? {} : { primaryService: lead.primaryService }),
    },
    knownSources: { websiteUrl: lead.websiteUrl },
    goal: "Observe somente informações factuais e verificáveis sobre a empresa a partir das fontes fornecidas. Registre lacunas em unresolvedQuestions. Não faça qualificação, scoring, interpretação comercial, recomendação ou estratégia.",
    allowedSourceTypes: ["WEBSITE"],
  });
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

async function requireRun(runId: string, dependencies: ResearchWorkflowDependencies): Promise<LeadResearchRun> {
  let stored: StoredLeadResearchRun | null;
  try {
    stored = await dependencies.store.findRun(runId);
  } catch {
    throw new ResearchWorkflowError("RESEARCH_RUN_WRITE_FAILED");
  }
  if (!stored) throw new ResearchWorkflowError("RESEARCH_RUN_NOT_FOUND");
  return parseStoredRun(stored);
}

function approvedBatch(run: LeadResearchRun, indexes: readonly number[]): ApprovedResearchEvidenceBatch {
  try {
    return prepareApprovedResearchEvidence(run.result, {
      leadId: run.leadId,
      approvedEvidenceIndexes: indexes,
    });
  } catch {
    throw new ResearchWorkflowError("RESEARCH_APPROVAL_INPUT_INVALID");
  }
}

/**
 * Rebuilds the persisted human selection and commits it through native D1
 * batch. Unlike the frozen sequential persistence helper, this cannot leave a
 * subset of this attempt's new LeadEvidence rows committed.
 */
async function commitApprovedResearchRun(runId: string, dependencies: ResearchWorkflowDependencies): Promise<LeadResearchRun> {
  const run = await requireRun(runId, dependencies);
  if (run.status === "APPROVED") return run;
  if (run.status !== "APPROVING" || run.approvedEvidenceIndexes === null) {
    throw new ResearchWorkflowError("RESEARCH_APPROVAL_INVALID_STATE");
  }

  const batch = approvedBatch(run, run.approvedEvidenceIndexes);
  try {
    await dependencies.approvalCommitter.commit({
      runId: run.id,
      leadId: run.leadId,
      evidence: batch.evidence,
    });
  } catch {
    throw new ResearchWorkflowError("RESEARCH_APPROVAL_COMMIT_FAILED");
  }

  const current = await requireRun(run.id, dependencies);
  if (current.status === "APPROVED") return current;
  // A concurrent successful D1 batch may have completed first; any other
  // result stays fail-closed rather than assuming an evidence write occurred.
  if (current.status === "APPROVING") {
    throw new ResearchWorkflowError("RESEARCH_APPROVAL_RECONCILIATION_REQUIRED");
  }
  throw new ResearchWorkflowError("RESEARCH_APPROVAL_INVALID_STATE");
}

/** Starts one server-built, WEBSITE-only research run. It writes only a valid PENDING_REVIEW result. */
export async function startLeadResearch(
  leadId: string,
  dependencies: ResearchWorkflowDependencies = createLiveDependencies(),
): Promise<LeadResearchRun> {
  let lead: ResearchWorkflowLead | null;
  try {
    lead = await dependencies.store.findLead(leadId);
  } catch {
    throw new ResearchWorkflowError("RESEARCH_RUN_WRITE_FAILED");
  }
  if (!lead) throw new ResearchWorkflowError("RESEARCH_LEAD_NOT_FOUND");
  if (!lead.websiteUrl) throw new ResearchWorkflowError("RESEARCH_WEBSITE_REQUIRED");

  let input: ResearcherInput;
  try {
    input = buildServerInput(lead);
  } catch {
    throw new ResearchWorkflowError("RESEARCH_WEBSITE_INVALID");
  }
  if (!input.knownSources.websiteUrl) {
    throw new ResearchWorkflowError("RESEARCH_WEBSITE_INVALID");
  }
  let snapshot: ResearchSourceSnapshot;
  try {
    snapshot = await dependencies.acquireWebsite(input.knownSources.websiteUrl);
  } catch {
    throw new ResearchWorkflowError("RESEARCH_WEBSITE_ACQUISITION_FAILED");
  }

  let prompt: ResolvedAgentPrompt;
  try {
    prompt = await dependencies.resolvePrompt(researcherTechnicalId);
  } catch {
    throw new ResearchWorkflowError("RESEARCHER_UNAVAILABLE");
  }
  if ((prompt.source === "BUILT_IN" && prompt.activeVersion !== null)
    || (prompt.source === "CONFIGURED" && (!Number.isInteger(prompt.activeVersion) || prompt.activeVersion! <= 0))) {
    throw new ResearchWorkflowError("RESEARCHER_UNAVAILABLE");
  }

  let result: ResearcherResult;
  try {
    result = await runResearcherDryRun(
      { input, snapshots: [snapshot] },
      dependencies.createModelClient(),
      { promptResolver: async () => prompt },
    );
  } catch (error) {
    if (error instanceof ResearcherDryRunError && error.code.startsWith("MODEL_OUTPUT")) {
      throw new ResearchWorkflowError("RESEARCHER_RESULT_INVALID");
    }
    throw new ResearchWorkflowError("RESEARCHER_UNAVAILABLE");
  }

  let created: StoredLeadResearchRun;
  try {
    created = await dependencies.store.createRun({
      leadId: lead.id,
      technicalId: researcherTechnicalId,
      status: "PENDING_REVIEW",
      inputJson: serialize(input),
      snapshotsJson: serialize([snapshot]),
      resultJson: serialize(result),
      promptSource: prompt.source,
      promptVersion: prompt.activeVersion,
      model: researcherModel,
      approvedEvidenceIndexesJson: null,
      reviewedAt: null,
    });
  } catch {
    throw new ResearchWorkflowError("RESEARCH_RUN_WRITE_FAILED");
  }
  return parseStoredRun(created);
}

export async function listLeadResearchRuns(
  leadId: string,
  dependencies: ResearchWorkflowDependencies = createLiveDependencies(),
): Promise<LeadResearchRun[]> {
  try {
    return (await dependencies.store.listRuns(leadId, maxLeadResearchRuns)).map(parseStoredRun);
  } catch (error) {
    if (error instanceof ResearchWorkflowError) throw error;
    throw new ResearchWorkflowError("RESEARCH_RUN_WRITE_FAILED");
  }
}

/**
 * Claims a pending run, stores the human selection, then atomically commits it.
 * An APPROVING retry is deliberately allowed to re-run the guarded D1 batch,
 * but only with the selection stored by the original winning claim.
 */
export async function approveLeadResearchRun(
  leadId: string,
  runId: string,
  input: unknown,
  dependencies: ResearchWorkflowDependencies = createLiveDependencies(),
): Promise<LeadResearchRun> {
  const parsedInput = leadResearchApprovalInputSchema.safeParse(input);
  if (!parsedInput.success) throw new ResearchWorkflowError("RESEARCH_APPROVAL_INPUT_INVALID");
  const initial = await requireRun(runId, dependencies);
  if (initial.leadId !== leadId) throw new ResearchWorkflowError("RESEARCH_RUN_NOT_FOUND");
  if (initial.status === "APPROVED") return initial;
  if (initial.status === "REJECTED") throw new ResearchWorkflowError("RESEARCH_APPROVAL_INVALID_STATE");
  if (initial.status === "APPROVING") return commitApprovedResearchRun(initial.id, dependencies);

  const batch = approvedBatch(initial, parsedInput.data.approvedEvidenceIndexes);
  let claimed: number;
  try {
    claimed = await dependencies.store.compareAndSetRun({
      id: initial.id,
      expectedStatus: "PENDING_REVIEW",
      status: "APPROVING",
      approvedEvidenceIndexesJson: serialize(batch.approvedEvidenceIndexes),
      reviewedAt: null,
    });
  } catch {
    throw new ResearchWorkflowError("RESEARCH_RUN_WRITE_FAILED");
  }
  if (claimed !== 1) {
    const current = await requireRun(initial.id, dependencies);
    if (current.status === "APPROVED") return current;
    if (current.status === "APPROVING") return commitApprovedResearchRun(current.id, dependencies);
    throw new ResearchWorkflowError("RESEARCH_APPROVAL_INVALID_STATE");
  }
  return commitApprovedResearchRun(initial.id, dependencies);
}

/** Rejecting only changes PENDING_REVIEW and never touches LeadEvidence. */
export async function rejectLeadResearchRun(
  leadId: string,
  runId: string,
  dependencies: ResearchWorkflowDependencies = createLiveDependencies(),
): Promise<LeadResearchRun> {
  const initial = await requireRun(runId, dependencies);
  if (initial.leadId !== leadId) throw new ResearchWorkflowError("RESEARCH_RUN_NOT_FOUND");
  if (initial.status === "REJECTED" || initial.status === "APPROVED") return initial;
  if (initial.status !== "PENDING_REVIEW") throw new ResearchWorkflowError("RESEARCH_APPROVAL_INVALID_STATE");

  const changed = await dependencies.store.compareAndSetRun({
    id: initial.id,
    expectedStatus: "PENDING_REVIEW",
    status: "REJECTED",
    approvedEvidenceIndexesJson: null,
    reviewedAt: new Date(),
  });
  if (changed === 1) return requireRun(initial.id, dependencies);
  const current = await requireRun(initial.id, dependencies);
  if (current.status === "REJECTED" || current.status === "APPROVED") return current;
  throw new ResearchWorkflowError("RESEARCH_APPROVAL_INVALID_STATE");
}

export function parseEmptyResearchStartBody(input: unknown) {
  if (!emptyObjectSchema.safeParse(input).success) {
    throw new ResearchWorkflowError("RESEARCH_START_INPUT_INVALID");
  }
}
