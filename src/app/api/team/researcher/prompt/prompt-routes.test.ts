import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  getConfiguration: vi.fn(),
  createVersion: vi.fn(),
  activateVersion: vi.fn(),
  resetToBuiltIn: vi.fn(),
  toDto: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/lib/auth/api", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/lib/agent-prompt-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-prompt-config")>();
  return {
    ...actual,
    getAgentPromptConfiguration: mocks.getConfiguration,
    createAgentPromptVersion: mocks.createVersion,
    activateAgentPromptVersion: mocks.activateVersion,
    resetAgentPromptToBuiltIn: mocks.resetToBuiltIn,
    toAgentPromptConfigurationDto: mocks.toDto,
  };
});

import { AgentPromptConfigError } from "@/lib/agent-prompt-config";
import { GET } from "./route";
import { POST as createVersion } from "./versions/route";
import { POST as activateVersion } from "./activate/route";
import { POST as resetToBuiltIn } from "./default/route";

const configuration = {
  technicalId: "researcher",
  builtInContent: "Built-in",
  active: { source: "BUILT_IN" as const, content: "Built-in", activeVersion: null, updatedAt: null },
  versions: [],
};

function request(url: string, body: unknown) {
  return new Request(`https://crm.test${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Researcher prompt configuration API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue(null);
    mocks.toDto.mockImplementation((value) => value);
    mocks.getConfiguration.mockResolvedValue(configuration);
    mocks.createVersion.mockResolvedValue(configuration);
    mocks.activateVersion.mockResolvedValue(configuration);
    mocks.resetToBuiltIn.mockResolvedValue(configuration);
  });

  it("requires session before every prompt configuration operation", async () => {
    mocks.requireApiSession.mockResolvedValue(Response.json({ error: "unauthorized" }, { status: 401 }));

    expect((await GET()).status).toBe(401);
    expect((await createVersion(request("/api/team/researcher/prompt/versions", { content: "Prompt", expectedActiveVersion: null }))).status).toBe(401);
    expect((await activateVersion(request("/api/team/researcher/prompt/activate", { version: 1, expectedActiveVersion: null }))).status).toBe(401);
    expect((await resetToBuiltIn(request("/api/team/researcher/prompt/default", { expectedActiveVersion: null }))).status).toBe(401);
    expect(mocks.getConfiguration).not.toHaveBeenCalled();
    expect(mocks.createVersion).not.toHaveBeenCalled();
  });

  it("returns the active configuration through the fixed researcher endpoint", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(configuration);
    expect(mocks.getConfiguration).toHaveBeenCalledWith("researcher");
  });

  it("accepts only strict version payloads and never accepts a browser technicalId", async () => {
    const response = await createVersion(request("/api/team/researcher/prompt/versions", {
      content: "Prompt",
      expectedActiveVersion: null,
      technicalId: "other-agent",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "AGENT_PROMPT_INPUT_INVALID" });
    expect(mocks.createVersion).not.toHaveBeenCalled();
  });

  it("creates a new version only for researcher through the authenticated route", async () => {
    const response = await createVersion(request("/api/team/researcher/prompt/versions", {
      content: "Configured prompt",
      expectedActiveVersion: 1,
    }));

    expect(response.status).toBe(201);
    expect(mocks.createVersion).toHaveBeenCalledWith({ content: "Configured prompt", expectedActiveVersion: 1 }, "researcher");
  });

  it("rejects malformed activate and reset payloads before the service", async () => {
    const activation = await activateVersion(request("/api/team/researcher/prompt/activate", {
      version: 1,
      expectedActiveVersion: null,
      databaseId: "untrusted",
    }));
    const reset = await resetToBuiltIn(request("/api/team/researcher/prompt/default", {
      expectedActiveVersion: null,
      extra: true,
    }));

    expect(activation.status).toBe(400);
    expect(reset.status).toBe(400);
    expect(mocks.activateVersion).not.toHaveBeenCalled();
    expect(mocks.resetToBuiltIn).not.toHaveBeenCalled();
  });

  it("returns a sanitized optimistic-concurrency conflict", async () => {
    mocks.createVersion.mockRejectedValue(new AgentPromptConfigError("AGENT_PROMPT_VERSION_CONFLICT"));

    const response = await createVersion(request("/api/team/researcher/prompt/versions", {
      content: "Configured prompt",
      expectedActiveVersion: null,
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "AGENT_PROMPT_VERSION_CONFLICT" });
  });

  it("does not expose raw storage errors", async () => {
    const secretLikeError = "database://credential-must-not-appear";
    mocks.getConfiguration.mockRejectedValue(new Error(secretLikeError));

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: "AGENT_PROMPT_CONFIGURATION_UNAVAILABLE" });
    expect(JSON.stringify(payload)).not.toContain(secretLikeError);
  });
});
