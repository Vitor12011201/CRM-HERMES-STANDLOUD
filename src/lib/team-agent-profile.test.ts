import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePageSession: vi.fn(),
  getAgentProfile: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ requirePageSession: mocks.requirePageSession }));
vi.mock("@/lib/agents/registry", () => ({ getAgentProfile: mocks.getAgentProfile }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import {
  agentProfileExecutionsEmptyMessage,
  agentProfileMemoryDescription,
  agentProfileSkillsEmptyMessage,
  loadTeamAgentProfile,
  parseAgentProfileTab,
} from "./team-agent-profile";

const ana = {
  technicalId: "researcher",
  displayName: "Ana",
  role: "Research Analyst",
  department: "Inteligência de Mercado",
  description: "Registry-owned profile",
  avatar: "/agents/ana.png",
  lifecycleStatus: "ACTIVE" as const,
  lifecycleLabel: "Ativa",
  responsibilities: [],
  nonResponsibilities: [],
};

describe("Team agent profile", () => {
  beforeEach(() => {
    mocks.requirePageSession.mockReset();
    mocks.getAgentProfile.mockReset();
    mocks.notFound.mockReset();
    mocks.getAgentProfile.mockReturnValue(ana);
  });

  it("requires a session and resolves Ana exclusively from the organizational registry", async () => {
    await expect(loadTeamAgentProfile("researcher")).resolves.toEqual(ana);

    expect(mocks.requirePageSession).toHaveBeenCalledOnce();
    expect(mocks.getAgentProfile).toHaveBeenCalledWith("researcher");
  });

  it("keeps the stable researcher technical identity on the profile route", async () => {
    await expect(loadTeamAgentProfile("researcher")).resolves.toMatchObject({
      technicalId: "researcher",
      displayName: "Ana",
    });
  });

  it("turns an unknown technical identity into a notFound response", async () => {
    mocks.getAgentProfile.mockReturnValue(undefined);
    mocks.notFound.mockImplementation(() => {
      throw new Error("NOT_FOUND");
    });

    await expect(loadTeamAgentProfile("unknown-agent")).rejects.toThrow("NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("uses overview as the fail-safe tab for unknown input", () => {
    expect(parseAgentProfileTab("prompt")).toBe("prompt");
    expect(parseAgentProfileTab(["memory", "prompt"])).toBe("memory");
    expect(parseAgentProfileTab("unknown")).toBe("overview");
    expect(parseAgentProfileTab(undefined)).toBe("overview");
  });

  it("does not invent skills, business memory, or execution history", () => {
    expect(agentProfileSkillsEmptyMessage).toContain("Nenhuma skill versionada específica");
    expect(agentProfileMemoryDescription).toContain("não serão duplicados");
    expect(agentProfileExecutionsEmptyMessage).toContain("ainda não está conectado");
  });
});
