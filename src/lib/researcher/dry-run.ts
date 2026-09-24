import {
  researcherInputSchema,
  researcherResultSchema,
  researchSourceSnapshotsSchema,
  type ResearcherInput,
  type ResearcherResult,
  type ResearchSourceSnapshot,
} from "./contracts";
import {
  resolveAgentPrompt,
  type ResolvedAgentPrompt,
} from "../agent-prompt-config";
export { buildResearcherSystemPrompt } from "./system-prompt";

/** The client boundary deliberately has no tool, database, or CRM capability. */
export type ResearcherModelRequest = {
  messages: readonly [
    { role: "system"; content: string },
    { role: "user"; content: string },
  ];
  responseFormat: "json";
};

export type ResearcherModelClient = {
  complete(request: ResearcherModelRequest): Promise<string>;
};

export type ResearcherDryRunRequest = {
  input: unknown;
  snapshots: unknown;
};

/** Injectable only for controlled tests; production uses resolveAgentPrompt(). */
export type ResearcherPromptResolver = (
  technicalId: "researcher",
) => Promise<ResolvedAgentPrompt>;

export type ResearcherDryRunOptions = {
  promptResolver?: ResearcherPromptResolver;
};

export type ResearcherDryRunErrorCode =
  | "INVALID_INPUT"
  | "INVALID_SNAPSHOTS"
  | "MODEL_REQUEST_FAILED"
  | "PROMPT_CONFIGURATION_UNAVAILABLE"
  | "MODEL_OUTPUT_INVALID_JSON"
  | "MODEL_OUTPUT_INVALID_RESULT"
  | "MODEL_OUTPUT_INVALID_PROVENANCE";

/**
 * Controlled failures intentionally carry only a code, never source content,
 * model output, credentials, or other sensitive diagnostic payloads.
 */
export class ResearcherDryRunError extends Error {
  constructor(public readonly code: ResearcherDryRunErrorCode) {
    super(code);
    this.name = "ResearcherDryRunError";
  }
}

const singleJsonFencePattern = /^```json\r?\n([\s\S]*)\r?\n```$/;

/**
 * Removes only one complete outer ```json fence. This intentionally never
 * searches for, extracts, repairs, or otherwise recovers JSON from prose.
 */
export function normalizeStrictJsonEnvelope(output: string): string {
  const trimmed = output.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenceMatch = singleJsonFencePattern.exec(trimmed);
  if (!fenceMatch) {
    throw new ResearcherDryRunError("MODEL_OUTPUT_INVALID_JSON");
  }

  const fencedContent = fenceMatch[1].trim();
  if (!fencedContent.startsWith("{") || !fencedContent.endsWith("}")) {
    throw new ResearcherDryRunError("MODEL_OUTPUT_INVALID_JSON");
  }

  return fencedContent;
}

export function buildResearcherFormatRetryInstruction() {
  return [
    "Sua resposta anterior não respeitou o contrato de formato.",
    "Retorne exatamente um único objeto JSON válido.",
    "Não use Markdown, code fences ou prosa antes ou depois do objeto.",
    "O primeiro caractere deve ser { e o último deve ser }.",
  ].join(" ");
}

/** Source data is sent as data, in a separate user message, never interpolated into system instructions. */
export function buildResearcherSourceDataMessage(input: ResearcherInput, snapshots: ResearchSourceSnapshot[]) {
  return [
    "CONTEXTO NEUTRO DO LEAD (não é uma avaliação comercial):",
    JSON.stringify(input),
    "INÍCIO DOS DADOS DE FONTE NÃO CONFIÁVEIS:",
    JSON.stringify(snapshots),
    "FIM DOS DADOS DE FONTE NÃO CONFIÁVEIS.",
  ].join("\n");
}

function parseInput(input: unknown) {
  const parsed = researcherInputSchema.safeParse(input);
  if (!parsed.success) throw new ResearcherDryRunError("INVALID_INPUT");
  return parsed.data;
}

function parseSnapshots(snapshots: unknown, input: ResearcherInput) {
  const parsed = researchSourceSnapshotsSchema.safeParse(snapshots);
  if (!parsed.success) throw new ResearcherDryRunError("INVALID_SNAPSHOTS");

  if (parsed.data.some((snapshot) => !input.allowedSourceTypes.includes(snapshot.sourceType))) {
    throw new ResearcherDryRunError("INVALID_SNAPSHOTS");
  }

  return parsed.data;
}

function parseModelResult(output: string) {
  let json: unknown;
  try {
    json = JSON.parse(normalizeStrictJsonEnvelope(output));
  } catch {
    throw new ResearcherDryRunError("MODEL_OUTPUT_INVALID_JSON");
  }

  const parsed = researcherResultSchema.safeParse(json);
  if (!parsed.success) throw new ResearcherDryRunError("MODEL_OUTPUT_INVALID_RESULT");
  return parsed.data;
}

function buildModelRequest(
  input: ResearcherInput,
  snapshots: ResearchSourceSnapshot[],
  configuredSystemPrompt: string,
  retryForFormat: boolean,
): ResearcherModelRequest {
  const systemPrompt = retryForFormat
    ? `${configuredSystemPrompt}\n${buildResearcherFormatRetryInstruction()}`
    : configuredSystemPrompt;

  return {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildResearcherSourceDataMessage(input, snapshots) },
    ],
    responseFormat: "json",
  };
}

async function resolveResearcherRuntimePrompt(
  promptResolver: ResearcherPromptResolver | undefined,
): Promise<string> {
  try {
    const resolved = await (promptResolver ?? resolveAgentPrompt)("researcher");
    return resolved.content;
  } catch {
    throw new ResearcherDryRunError("PROMPT_CONFIGURATION_UNAVAILABLE");
  }
}

async function requestModelOutput(
  modelClient: ResearcherModelClient,
  request: ResearcherModelRequest,
): Promise<string> {
  try {
    return await modelClient.complete(request);
  } catch {
    throw new ResearcherDryRunError("MODEL_REQUEST_FAILED");
  }
}

function validateModelOutput(
  output: string,
  input: ResearcherInput,
  snapshots: ResearchSourceSnapshot[],
): ResearcherResult {
  if (typeof output !== "string") {
    throw new ResearcherDryRunError("MODEL_OUTPUT_INVALID_RESULT");
  }

  const result = parseModelResult(output);
  validateResearcherResultProvenance(result, input, snapshots);
  return result;
}

/**
 * A result can cite only source types the caller allowed and only a source URL
 * that occurred in a supplied snapshot of that same type. This prevents the
 * model from inventing a provenance URL or evidence source.
 */
export function validateResearcherResultProvenance(
  result: ResearcherResult,
  input: ResearcherInput,
  snapshots: ResearchSourceSnapshot[],
) {
  for (const evidence of result.evidence) {
    if (!input.allowedSourceTypes.includes(evidence.sourceType)) {
      throw new ResearcherDryRunError("MODEL_OUTPUT_INVALID_PROVENANCE");
    }

    const matchingSnapshots = snapshots.filter((snapshot) => snapshot.sourceType === evidence.sourceType);
    if (matchingSnapshots.length === 0) {
      throw new ResearcherDryRunError("MODEL_OUTPUT_INVALID_PROVENANCE");
    }

    if (evidence.sourceUrl && !matchingSnapshots.some((snapshot) => snapshot.sourceUrl === evidence.sourceUrl)) {
      throw new ResearcherDryRunError("MODEL_OUTPUT_INVALID_PROVENANCE");
    }
  }
}

/**
 * Executes a dry-run only: validates caller-provided source snapshots, calls
 * the injected model client, validates its JSON, and returns no side effects.
 */
export async function runResearcherDryRun(
  request: ResearcherDryRunRequest,
  modelClient: ResearcherModelClient,
  options: ResearcherDryRunOptions = {},
): Promise<ResearcherResult> {
  const input = parseInput(request.input);
  const snapshots = parseSnapshots(request.snapshots, input);
  const systemPrompt = await resolveResearcherRuntimePrompt(options.promptResolver);

  const initialOutput = await requestModelOutput(
    modelClient,
    buildModelRequest(input, snapshots, systemPrompt, false),
  );

  try {
    return validateModelOutput(initialOutput, input, snapshots);
  } catch (error) {
    if (!(error instanceof ResearcherDryRunError) || error.code !== "MODEL_OUTPUT_INVALID_JSON") {
      throw error;
    }
  }

  const retryOutput = await requestModelOutput(
    modelClient,
    buildModelRequest(input, snapshots, systemPrompt, true),
  );
  return validateModelOutput(retryOutput, input, snapshots);
}
