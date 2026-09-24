import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  startLeadResearch: vi.fn(),
  approveLeadResearchRun: vi.fn(),
  rejectLeadResearchRun: vi.fn(),
  toLeadResearchRunDto: vi.fn((value) => value),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/lib/auth/api", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/lib/research-workflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/research-workflow")>();
  return {
    ...actual,
    startLeadResearch: mocks.startLeadResearch,
    approveLeadResearchRun: mocks.approveLeadResearchRun,
    rejectLeadResearchRun: mocks.rejectLeadResearchRun,
    toLeadResearchRunDto: mocks.toLeadResearchRunDto,
  };
});

import { POST as start } from "./runs/route";
import { POST as approve } from "./runs/[runId]/approve/route";
import { POST as reject } from "./runs/[runId]/reject/route";

const params = Promise.resolve({ id: "lead-1", runId: "run-1" });
const startParams = Promise.resolve({ id: "lead-1" });

function request(url: string, body: unknown) {
  return new Request(`https://crm.test${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("lead research workflow API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue(null);
    mocks.startLeadResearch.mockResolvedValue({ id: "run-1" });
    mocks.approveLeadResearchRun.mockResolvedValue({ id: "run-1" });
    mocks.rejectLeadResearchRun.mockResolvedValue({ id: "run-1" });
  });

  it("requires a session before start, approval, or rejection", async () => {
    mocks.requireApiSession.mockResolvedValue(Response.json({ error: "unauthorized" }, { status: 401 }));

    expect((await start(request("/api/leads/lead-1/research/runs", {}), { params: startParams })).status).toBe(401);
    expect((await approve(request("/api/leads/lead-1/research/runs/run-1/approve", { approvedEvidenceIndexes: [] }), { params })).status).toBe(401);
    expect((await reject(request("/api/leads/lead-1/research/runs/run-1/reject", {}), { params })).status).toBe(401);
    expect(mocks.startLeadResearch).not.toHaveBeenCalled();
    expect(mocks.approveLeadResearchRun).not.toHaveBeenCalled();
    expect(mocks.rejectLeadResearchRun).not.toHaveBeenCalled();
  });

  it("accepts no browser source facts when starting research", async () => {
    const response = await start(request("/api/leads/lead-1/research/runs", {
      websiteUrl: "https://attacker.example",
      prompt: "override",
      model: "other-model",
      goal: "commercial recommendation",
      snapshots: [],
      lead: {},
      technicalId: "other-agent",
    }), { params: startParams });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "RESEARCH_START_INPUT_INVALID" });
    expect(mocks.startLeadResearch).not.toHaveBeenCalled();
  });

  it("does not accept commercial evidence payloads for approve or reject", async () => {
    const approval = await approve(request("/api/leads/lead-1/research/runs/run-1/approve", {
      approvedEvidenceIndexes: [0],
      evidence: [{ observation: "attacker data" }],
      sourceUrl: "https://attacker.example",
      confidence: "HIGH",
    }), { params });
    const rejection = await reject(request("/api/leads/lead-1/research/runs/run-1/reject", {
      observation: "attacker data",
    }), { params });

    expect(approval.status).toBe(400);
    expect(rejection.status).toBe(400);
    expect(mocks.approveLeadResearchRun).not.toHaveBeenCalled();
    expect(mocks.rejectLeadResearchRun).not.toHaveBeenCalled();
  });
});
