import { z } from "zod";

import { getAgentProfile } from "@/lib/agents/registry";
import type { DbClient } from "@/lib/db";
import { buildResearcherSystemPrompt } from "@/lib/researcher/system-prompt";

export const maxAgentPromptLength = 20_000;

export const createAgentPromptVersionInputSchema = z.object({
  content: z.string().trim().min(1).max(maxAgentPromptLength),
  expectedActiveVersion: z.number().int().positive().nullable(),
}).strict();

export const activateAgentPromptVersionInputSchema = z.object({
  version: z.number().int().positive(),
  expectedActiveVersion: z.number().int().positive().nullable(),
}).strict();

export const resetAgentPromptInputSchema = z.object({
  expectedActiveVersion: z.number().int().positive().nullable(),
}).strict();

export type AgentPromptConfigErrorCode =
  | "AGENT_PROMPT_AGENT_NOT_FOUND"
  | "AGENT_PROMPT_INPUT_INVALID"
  | "AGENT_PROMPT_VERSION_NOT_FOUND"
  | "AGENT_PROMPT_VERSION_CONFLICT"
  | "AGENT_PROMPT_CONFIG_INVALID"
  | "AGENT_PROMPT_CONFIG_READ_FAILED"
  | "AGENT_PROMPT_CONFIG_WRITE_FAILED";

/** A stable, sanitized error boundary for prompt configuration services and APIs. */
export class AgentPromptConfigError extends Error {
  constructor(public readonly code: AgentPromptConfigErrorCode) {
    super(code);
    this.name = "AgentPromptConfigError";
  }
}

export type StoredAgentConfig = {
  technicalId: string;
  activePromptVersion: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredAgentPromptVersion = {
  technicalId: string;
  version: number;
  content: string;
  createdAt: Date;
};

export type AgentPromptConfigStore = {
  findConfig(technicalId: string): Promise<StoredAgentConfig | null>;
  findVersion(technicalId: string, version: number): Promise<StoredAgentPromptVersion | null>;
  listVersions(technicalId: string): Promise<StoredAgentPromptVersion[]>;
  createConfig(technicalId: string): Promise<StoredAgentConfig>;
  createVersion(input: { technicalId: string; version: number; content: string }): Promise<StoredAgentPromptVersion>;
  compareAndSetActiveVersion(input: {
    technicalId: string;
    expectedActiveVersion: number | null;
    nextActiveVersion: number | null;
  }): Promise<number>;
};

export type ResolvedAgentPrompt = {
  source: "BUILT_IN" | "CONFIGURED";
  content: string;
  activeVersion: number | null;
  updatedAt: Date | null;
};

export type AgentPromptConfiguration = {
  technicalId: string;
  builtInContent: string;
  active: ResolvedAgentPrompt;
  versions: readonly StoredAgentPromptVersion[];
};

export type AgentPromptConfigurationDto = {
  technicalId: string;
  builtInContent: string;
  active: Omit<ResolvedAgentPrompt, "updatedAt"> & { updatedAt: string | null };
  versions: Array<Omit<StoredAgentPromptVersion, "createdAt"> & { createdAt: string }>;
};

function builtInPromptFor(technicalId: string): string {
  if (technicalId === "researcher") return buildResearcherSystemPrompt();
  throw new AgentPromptConfigError("AGENT_PROMPT_AGENT_NOT_FOUND");
}

function requireRegisteredAgent(technicalId: string) {
  if (!getAgentProfile(technicalId)) {
    throw new AgentPromptConfigError("AGENT_PROMPT_AGENT_NOT_FOUND");
  }
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function asStoredConfig(value: {
  technicalId: string;
  activePromptVersion: number | null;
  createdAt: Date;
  updatedAt: Date;
}): StoredAgentConfig {
  return value;
}

function asStoredVersion(value: {
  technicalId: string;
  version: number;
  content: string;
  createdAt: Date;
}): StoredAgentPromptVersion {
  return value;
}

export function createAgentPromptConfigStore(db: DbClient): AgentPromptConfigStore {
  return {
    async findConfig(technicalId) {
      const config = await db.agentConfig.findUnique({ where: { technicalId } });
      return config ? asStoredConfig(config) : null;
    },
    async findVersion(technicalId, version) {
      const promptVersion = await db.agentPromptVersion.findUnique({
        where: { technicalId_version: { technicalId, version } },
      });
      return promptVersion ? asStoredVersion(promptVersion) : null;
    },
    async listVersions(technicalId) {
      const promptVersions = await db.agentPromptVersion.findMany({
        where: { technicalId },
        orderBy: { version: "desc" },
      });
      return promptVersions.map(asStoredVersion);
    },
    async createConfig(technicalId) {
      return asStoredConfig(await db.agentConfig.create({ data: { technicalId } }));
    },
    async createVersion(input) {
      return asStoredVersion(await db.agentPromptVersion.create({ data: input }));
    },
    async compareAndSetActiveVersion(input) {
      const result = await db.agentConfig.updateMany({
        where: {
          technicalId: input.technicalId,
          activePromptVersion: input.expectedActiveVersion,
        },
        data: { activePromptVersion: input.nextActiveVersion },
      });
      return result.count;
    },
  };
}

async function resolveStore(store: AgentPromptConfigStore | undefined): Promise<AgentPromptConfigStore> {
  if (store) return store;
  const { getDb } = await import("@/lib/db");
  return createAgentPromptConfigStore(getDb());
}

async function read<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AgentPromptConfigError) throw error;
    throw new AgentPromptConfigError("AGENT_PROMPT_CONFIG_READ_FAILED");
  }
}

async function write<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AgentPromptConfigError) throw error;
    if (isUniqueConstraintError(error)) throw error;
    throw new AgentPromptConfigError("AGENT_PROMPT_CONFIG_WRITE_FAILED");
  }
}

function assertExpectedActiveVersion(config: StoredAgentConfig | null, expectedActiveVersion: number | null) {
  if ((config?.activePromptVersion ?? null) !== expectedActiveVersion) {
    throw new AgentPromptConfigError("AGENT_PROMPT_VERSION_CONFLICT");
  }
}

function nextVersion(versions: readonly StoredAgentPromptVersion[]) {
  return Math.max(0, ...versions.map((item) => item.version)) + 1;
}

async function ensureConfigForFirstVersion(
  technicalId: string,
  expectedActiveVersion: number | null,
  store: AgentPromptConfigStore,
) {
  const existing = await read(() => store.findConfig(technicalId));
  assertExpectedActiveVersion(existing, expectedActiveVersion);
  if (existing) return existing;

  try {
    return await write(() => store.createConfig(technicalId));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AgentPromptConfigError("AGENT_PROMPT_VERSION_CONFLICT");
    }
    throw error;
  }
}

export async function getAgentPromptConfiguration(
  technicalId: string,
  store?: AgentPromptConfigStore,
): Promise<AgentPromptConfiguration> {
  requireRegisteredAgent(technicalId);
  const resolvedStore = await resolveStore(store);
  const builtInContent = builtInPromptFor(technicalId);
  const config = await read(() => resolvedStore.findConfig(technicalId));
  const versions = await read(() => resolvedStore.listVersions(technicalId));

  if (!config || config.activePromptVersion === null) {
    return {
      technicalId,
      builtInContent,
      active: {
        source: "BUILT_IN",
        content: builtInContent,
        activeVersion: null,
        updatedAt: config?.updatedAt ?? null,
      },
      versions,
    };
  }

  const activeVersion = versions.find((version) => version.version === config.activePromptVersion)
    ?? await read(() => resolvedStore.findVersion(technicalId, config.activePromptVersion!));
  if (!activeVersion) throw new AgentPromptConfigError("AGENT_PROMPT_CONFIG_INVALID");

  return {
    technicalId,
    builtInContent,
    active: {
      source: "CONFIGURED",
      content: activeVersion.content,
      activeVersion: activeVersion.version,
      updatedAt: config.updatedAt,
    },
    versions,
  };
}

/** Runtime prompt resolver: missing configuration is normal; failed reads are not silently hidden. */
export async function resolveAgentPrompt(
  technicalId: string,
  store?: AgentPromptConfigStore,
): Promise<ResolvedAgentPrompt> {
  return (await getAgentPromptConfiguration(technicalId, store)).active;
}

export async function createAgentPromptVersion(
  input: unknown,
  technicalId: string,
  store?: AgentPromptConfigStore,
): Promise<AgentPromptConfiguration> {
  requireRegisteredAgent(technicalId);
  const resolvedStore = await resolveStore(store);
  const parsed = createAgentPromptVersionInputSchema.safeParse(input);
  if (!parsed.success) throw new AgentPromptConfigError("AGENT_PROMPT_INPUT_INVALID");

  const config = await ensureConfigForFirstVersion(technicalId, parsed.data.expectedActiveVersion, resolvedStore);
  const versions = await read(() => resolvedStore.listVersions(technicalId));
  const version = nextVersion(versions);

  try {
    await write(() => resolvedStore.createVersion({ technicalId, version, content: parsed.data.content }));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AgentPromptConfigError("AGENT_PROMPT_VERSION_CONFLICT");
    }
    throw error;
  }

  const activated = await write(() => resolvedStore.compareAndSetActiveVersion({
    technicalId,
    expectedActiveVersion: config.activePromptVersion,
    nextActiveVersion: version,
  }));
  if (activated === 1) return getAgentPromptConfiguration(technicalId, resolvedStore);

  // Versions are append-only. A lost activation CAS leaves this inactive
  // historical version intact; it must never be deleted by compensation.
  throw new AgentPromptConfigError("AGENT_PROMPT_VERSION_CONFLICT");
}

export async function activateAgentPromptVersion(
  input: unknown,
  technicalId: string,
  store?: AgentPromptConfigStore,
): Promise<AgentPromptConfiguration> {
  requireRegisteredAgent(technicalId);
  const resolvedStore = await resolveStore(store);
  const parsed = activateAgentPromptVersionInputSchema.safeParse(input);
  if (!parsed.success) throw new AgentPromptConfigError("AGENT_PROMPT_INPUT_INVALID");

  const config = await read(() => resolvedStore.findConfig(technicalId));
  assertExpectedActiveVersion(config, parsed.data.expectedActiveVersion);
  if (!config) throw new AgentPromptConfigError("AGENT_PROMPT_VERSION_NOT_FOUND");
  if (config.activePromptVersion === parsed.data.version) return getAgentPromptConfiguration(technicalId, resolvedStore);

  const version = await read(() => resolvedStore.findVersion(technicalId, parsed.data.version));
  if (!version) throw new AgentPromptConfigError("AGENT_PROMPT_VERSION_NOT_FOUND");

  const activated = await write(() => resolvedStore.compareAndSetActiveVersion({
    technicalId,
    expectedActiveVersion: config.activePromptVersion,
    nextActiveVersion: version.version,
  }));
  if (activated !== 1) throw new AgentPromptConfigError("AGENT_PROMPT_VERSION_CONFLICT");

  return getAgentPromptConfiguration(technicalId, resolvedStore);
}

export async function resetAgentPromptToBuiltIn(
  input: unknown,
  technicalId: string,
  store?: AgentPromptConfigStore,
): Promise<AgentPromptConfiguration> {
  requireRegisteredAgent(technicalId);
  const resolvedStore = await resolveStore(store);
  const parsed = resetAgentPromptInputSchema.safeParse(input);
  if (!parsed.success) throw new AgentPromptConfigError("AGENT_PROMPT_INPUT_INVALID");

  const config = await read(() => resolvedStore.findConfig(technicalId));
  assertExpectedActiveVersion(config, parsed.data.expectedActiveVersion);
  if (!config || config.activePromptVersion === null) return getAgentPromptConfiguration(technicalId, resolvedStore);

  const reset = await write(() => resolvedStore.compareAndSetActiveVersion({
    technicalId,
    expectedActiveVersion: config.activePromptVersion,
    nextActiveVersion: null,
  }));
  if (reset !== 1) throw new AgentPromptConfigError("AGENT_PROMPT_VERSION_CONFLICT");

  return getAgentPromptConfiguration(technicalId, resolvedStore);
}

export function toAgentPromptConfigurationDto(
  configuration: AgentPromptConfiguration,
): AgentPromptConfigurationDto {
  return {
    technicalId: configuration.technicalId,
    builtInContent: configuration.builtInContent,
    active: {
      ...configuration.active,
      updatedAt: configuration.active.updatedAt?.toISOString() ?? null,
    },
    versions: configuration.versions.map((version) => ({
      ...version,
      createdAt: version.createdAt.toISOString(),
    })),
  };
}
