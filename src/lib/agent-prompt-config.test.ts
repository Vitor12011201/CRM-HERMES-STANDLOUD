import { describe, expect, it } from "vitest";

import { buildResearcherSystemPrompt } from "@/lib/researcher/dry-run";
import { buildResearcherSystemPrompt as buildIndependentResearcherSystemPrompt } from "@/lib/researcher/system-prompt";
import {
  AgentPromptConfigError,
  createAgentPromptVersion,
  activateAgentPromptVersion,
  getAgentPromptConfiguration,
  resetAgentPromptToBuiltIn,
  resolveAgentPrompt,
  type AgentPromptConfigStore,
  type StoredAgentConfig,
  type StoredAgentPromptVersion,
} from "./agent-prompt-config";

function createInMemoryStore(): AgentPromptConfigStore & {
  configs: Map<string, StoredAgentConfig>;
  versions: Map<string, StoredAgentPromptVersion>;
  failReads: boolean;
} {
  const configs = new Map<string, StoredAgentConfig>();
  const versions = new Map<string, StoredAgentPromptVersion>();
  const versionKey = (technicalId: string, version: number) => `${technicalId}:${version}`;
  const cloneConfig = (config: StoredAgentConfig) => ({ ...config });
  const cloneVersion = (version: StoredAgentPromptVersion) => ({ ...version });
  const store = {
    configs,
    versions,
    failReads: false,
    async findConfig(technicalId: string) {
      if (store.failReads) throw new Error("raw database failure");
      const config = configs.get(technicalId);
      return config ? cloneConfig(config) : null;
    },
    async findVersion(technicalId: string, version: number) {
      if (store.failReads) throw new Error("raw database failure");
      const promptVersion = versions.get(versionKey(technicalId, version));
      return promptVersion ? cloneVersion(promptVersion) : null;
    },
    async listVersions(technicalId: string) {
      if (store.failReads) throw new Error("raw database failure");
      return [...versions.values()]
        .filter((version) => version.technicalId === technicalId)
        .sort((left, right) => right.version - left.version)
        .map(cloneVersion);
    },
    async createConfig(technicalId: string) {
      if (configs.has(technicalId)) throw { code: "P2002" };
      const now = new Date();
      const config = { technicalId, activePromptVersion: null, createdAt: now, updatedAt: now };
      configs.set(technicalId, config);
      return cloneConfig(config);
    },
    async createVersion(input: { technicalId: string; version: number; content: string }) {
      const key = versionKey(input.technicalId, input.version);
      if (versions.has(key)) throw { code: "P2002" };
      const promptVersion = { ...input, createdAt: new Date() };
      versions.set(key, promptVersion);
      return cloneVersion(promptVersion);
    },
    async compareAndSetActiveVersion(input: {
      technicalId: string;
      expectedActiveVersion: number | null;
      nextActiveVersion: number | null;
    }) {
      const config = configs.get(input.technicalId);
      if (!config || config.activePromptVersion !== input.expectedActiveVersion) return 0;
      configs.set(input.technicalId, {
        ...config,
        activePromptVersion: input.nextActiveVersion,
        updatedAt: new Date(),
      });
      return 1;
    },
  } satisfies AgentPromptConfigStore;
  return store;
}

async function expectConfigError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ name: "AgentPromptConfigError", code });
}

describe("Agent prompt configuration", () => {
  it("preserves the built-in prompt exactly through the independent prompt module", () => {
    expect(buildResearcherSystemPrompt()).toBe(buildIndependentResearcherSystemPrompt());
  });

  it("uses the exact built-in Researcher prompt when no configuration exists", async () => {
    const resolved = await resolveAgentPrompt("researcher", createInMemoryStore());

    expect(resolved).toEqual({
      source: "BUILT_IN",
      content: buildResearcherSystemPrompt(),
      activeVersion: null,
      updatedAt: null,
    });
  });

  it("creates immutable version 1 and resolves it as the configured active prompt", async () => {
    const store = createInMemoryStore();
    const created = await createAgentPromptVersion({
      content: "  Researcher version one.  ",
      expectedActiveVersion: null,
    }, "researcher", store);

    expect(created.active).toMatchObject({ source: "CONFIGURED", content: "Researcher version one.", activeVersion: 1 });
    expect(created.versions).toHaveLength(1);
    expect(await resolveAgentPrompt("researcher", store)).toMatchObject({
      source: "CONFIGURED",
      content: "Researcher version one.",
      activeVersion: 1,
    });
  });

  it("creates version 2 without overwriting version 1", async () => {
    const store = createInMemoryStore();
    await createAgentPromptVersion({ content: "Version one", expectedActiveVersion: null }, "researcher", store);
    const second = await createAgentPromptVersion({ content: "Version two", expectedActiveVersion: 1 }, "researcher", store);

    expect(second.active).toMatchObject({ content: "Version two", activeVersion: 2 });
    expect(second.versions).toEqual(expect.arrayContaining([
      expect.objectContaining({ version: 1, content: "Version one" }),
      expect.objectContaining({ version: 2, content: "Version two" }),
    ]));
  });

  it("activates an earlier immutable version and can reset fully to built-in", async () => {
    const store = createInMemoryStore();
    await createAgentPromptVersion({ content: "Version one", expectedActiveVersion: null }, "researcher", store);
    await createAgentPromptVersion({ content: "Version two", expectedActiveVersion: 1 }, "researcher", store);

    const rolledBack = await activateAgentPromptVersion({ version: 1, expectedActiveVersion: 2 }, "researcher", store);
    expect(rolledBack.active).toMatchObject({ source: "CONFIGURED", activeVersion: 1, content: "Version one" });

    const reset = await resetAgentPromptToBuiltIn({ expectedActiveVersion: 1 }, "researcher", store);
    expect(reset.active).toEqual(expect.objectContaining({
      source: "BUILT_IN",
      activeVersion: null,
      content: buildResearcherSystemPrompt(),
    }));
    expect(reset.versions).toHaveLength(2);
  });

  it("fails closed on stale optimistic concurrency expectations", async () => {
    const store = createInMemoryStore();
    await createAgentPromptVersion({ content: "Version one", expectedActiveVersion: null }, "researcher", store);
    await createAgentPromptVersion({ content: "Version two", expectedActiveVersion: 1 }, "researcher", store);

    await expectConfigError(
      createAgentPromptVersion({ content: "Stale version", expectedActiveVersion: 1 }, "researcher", store),
      "AGENT_PROMPT_VERSION_CONFLICT",
    );
    await expectConfigError(
      activateAgentPromptVersion({ version: 1, expectedActiveVersion: 1 }, "researcher", store),
      "AGENT_PROMPT_VERSION_CONFLICT",
    );
    expect((await getAgentPromptConfiguration("researcher", store)).active.activeVersion).toBe(2);
  });

  it("keeps a version append-only when its activation CAS loses", async () => {
    const store = createInMemoryStore();
    await createAgentPromptVersion({ content: "Version one", expectedActiveVersion: null }, "researcher", store);

    const createVersion = store.createVersion;
    store.createVersion = async (input) => {
      const created = await createVersion(input);
      if (input.version === 2) {
        const config = store.configs.get("researcher")!;
        // Simulate another request observing and activating the newly-created
        // version before this request performs its original CAS.
        store.configs.set("researcher", {
          ...config,
          activePromptVersion: 2,
          updatedAt: new Date(),
        });
      }
      return created;
    };

    await expectConfigError(
      createAgentPromptVersion({ content: "Version two", expectedActiveVersion: 1 }, "researcher", store),
      "AGENT_PROMPT_VERSION_CONFLICT",
    );

    expect("deleteVersion" in store).toBe(false);
    expect(store.versions.get("researcher:2")).toMatchObject({ content: "Version two", version: 2 });
    expect(await resolveAgentPrompt("researcher", store)).toMatchObject({
      source: "CONFIGURED",
      activeVersion: 2,
      content: "Version two",
    });

    const third = await createAgentPromptVersion(
      { content: "Version three", expectedActiveVersion: 2 },
      "researcher",
      store,
    );
    expect(third.active).toMatchObject({ activeVersion: 3, content: "Version three" });
    expect(third.versions.map((version) => version.version)).toEqual([3, 2, 1]);
  });

  it("fails closed when an active pointer has no version for its technical identity", async () => {
    const store = createInMemoryStore();
    const now = new Date();
    store.configs.set("researcher", {
      technicalId: "researcher",
      activePromptVersion: 7,
      createdAt: now,
      updatedAt: now,
    });

    await expectConfigError(
      resolveAgentPrompt("researcher", store),
      "AGENT_PROMPT_CONFIG_INVALID",
    );
  });

  it("validates strict payloads before writing", async () => {
    const store = createInMemoryStore();
    await expectConfigError(createAgentPromptVersion({ content: "", expectedActiveVersion: null }, "researcher", store), "AGENT_PROMPT_INPUT_INVALID");
    await expectConfigError(createAgentPromptVersion({ content: "valid", expectedActiveVersion: null, unexpected: true }, "researcher", store), "AGENT_PROMPT_INPUT_INVALID");
    await expectConfigError(activateAgentPromptVersion({ version: 0, expectedActiveVersion: null }, "researcher", store), "AGENT_PROMPT_INPUT_INVALID");
    expect(store.configs.size).toBe(0);
  });

  it("uses technical identity rather than organizational display identity", async () => {
    const store = createInMemoryStore();
    await createAgentPromptVersion({ content: "Researcher only", expectedActiveVersion: null }, "researcher", store);

    await expectConfigError(resolveAgentPrompt("Ana", store), "AGENT_PROMPT_AGENT_NOT_FOUND");
    expect((await resolveAgentPrompt("researcher", store)).content).toBe("Researcher only");
  });

  it("keeps database read failure distinct from a normal missing configuration", async () => {
    const store = createInMemoryStore();
    store.failReads = true;

    await expectConfigError(resolveAgentPrompt("researcher", store), "AGENT_PROMPT_CONFIG_READ_FAILED");
    expect(() => new AgentPromptConfigError("AGENT_PROMPT_CONFIG_READ_FAILED")).not.toThrow();
  });
});
