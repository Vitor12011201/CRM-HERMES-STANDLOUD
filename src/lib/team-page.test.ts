import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePageSession: vi.fn(),
  getAgentProfile: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ requirePageSession: mocks.requirePageSession }));
vi.mock("@/lib/agents/registry", () => ({ getAgentProfile: mocks.getAgentProfile }));

import { loadTeamPageProfile } from "./team-page";

describe("Team page data", () => {
  it("requires a page session and uses the Ana profile supplied by the registry", async () => {
    mocks.getAgentProfile.mockReturnValue({
      technicalId: "researcher",
      displayName: "Ana from registry",
      role: "Research Analyst",
      department: "Inteligência de Mercado",
      description: "Registry-owned description",
      avatar: "/agents/ana.png",
      lifecycleStatus: "ACTIVE",
      lifecycleLabel: "Ativa",
      responsibilities: [],
      nonResponsibilities: [],
    });

    await expect(loadTeamPageProfile()).resolves.toMatchObject({
      technicalId: "researcher",
      displayName: "Ana from registry",
      description: "Registry-owned description",
    });
    expect(mocks.requirePageSession).toHaveBeenCalledOnce();
    expect(mocks.getAgentProfile).toHaveBeenCalledWith("researcher");
  });
});
