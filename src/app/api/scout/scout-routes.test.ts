import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  discover: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/api", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/lib/scout-workflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scout-workflow")>();
  return {
    ...actual,
    discoverScoutCandidateForReview: mocks.discover,
    approveScoutCandidateReview: mocks.approve,
    rejectScoutCandidateReviewForWorkflow: mocks.reject,
  };
});

import { ScoutWorkflowError } from "@/lib/scout-workflow";
import { POST as discover } from "./discover/route";
import { POST as approve } from "./reviews/[id]/approve/route";
import { POST as reject } from "./reviews/[id]/reject/route";

const discoveryInput = {
  city: "Jacarei",
  region: "SP",
  segment: "Contabilidade",
  requirePublicWebsite: true,
  limit: 20,
};

function request(url: string, body: unknown) {
  return new Request(`https://crm.test${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "review-1" }) };

describe("Scout operational API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue(null);
  });

  it("requires session before discovery or approval services", async () => {
    mocks.requireApiSession.mockResolvedValue(Response.json({ error: "unauthorized" }, { status: 401 }));

    expect((await discover(request("/api/scout/discover", discoveryInput))).status).toBe(401);
    expect((await approve(request("/api/scout/reviews/review-1/approve", {}), params)).status).toBe(401);
    expect((await reject(request("/api/scout/reviews/review-1/reject", {}), params)).status).toBe(401);
    expect(mocks.discover).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.reject).not.toHaveBeenCalled();
  });

  it("rejects invalid discovery controls without calling the workflow", async () => {
    const response = await discover(request("/api/scout/discover", { ...discoveryInput, limit: 51 }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "SCOUT_WORKFLOW_DISCOVERY_INPUT_INVALID" });
    expect(mocks.discover).not.toHaveBeenCalled();
  });

  it("does not accept browser candidate data on approval or rejection", async () => {
    const approveResponse = await approve(request("/api/scout/reviews/review-1/approve", {
      candidate: { companyName: "untrusted" },
    }), params);
    const rejectResponse = await reject(request("/api/scout/reviews/review-1/reject", {
      candidate: { companyName: "untrusted" },
    }), params);

    expect(approveResponse.status).toBe(400);
    expect(rejectResponse.status).toBe(400);
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.reject).not.toHaveBeenCalled();
  });

  it("returns a sanitized provider failure without raw external text", async () => {
    const secretLikeText = "Authorization: Bearer should-not-appear";
    mocks.discover.mockRejectedValue(new Error(secretLikeText));

    const response = await discover(request("/api/scout/discover", discoveryInput));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Não foi possível concluir a operação Scout." });
    expect(JSON.stringify(payload)).not.toContain(secretLikeText);
  });

  it("returns a typed discovery failure without provider details", async () => {
    mocks.discover.mockRejectedValue(new ScoutWorkflowError("SCOUT_WORKFLOW_DISCOVERY_FAILED"));

    const response = await discover(request("/api/scout/discover", discoveryInput));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "SCOUT_WORKFLOW_DISCOVERY_FAILED" });
  });

  it("maps a retryable pre-create approval failure to a sanitized 503", async () => {
    mocks.approve.mockRejectedValue(new ScoutWorkflowError("SCOUT_APPROVAL_RETRYABLE"));

    const response = await approve(request("/api/scout/reviews/review-1/approve", {}), params);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "SCOUT_APPROVAL_RETRYABLE" });
  });

  it("returns converted approval outcomes without accepting Lead payload input", async () => {
    mocks.approve.mockResolvedValue({ outcome: "CONVERTED", leadId: "lead-1" });

    const response = await approve(request("/api/scout/reviews/review-1/approve", {}), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "CONVERTED", leadId: "lead-1" });
    expect(mocks.approve).toHaveBeenCalledWith("review-1", {});
  });

  it("rejects through the server-side persisted transition using only the route id", async () => {
    mocks.reject.mockResolvedValue({ changed: true, review: { status: "REJECTED" } });

    const response = await reject(request("/api/scout/reviews/review-1/reject", {}), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "REJECTED", changed: true });
    expect(mocks.reject).toHaveBeenCalledWith("review-1");
  });
});
