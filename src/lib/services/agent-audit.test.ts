import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: mocks.getDb,
}));

const database = {
  agentAuditLog: {
    create: mocks.create,
    update: mocks.update,
  },
};

import { ServiceNotFoundError } from "./errors";
import { runAuditedAgentWrite } from "./agent-audit";

describe("agent audit service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: "audit-1" });
    mocks.update.mockResolvedValue({});
    mocks.getDb.mockReturnValue(database);
  });

  it("records a minimal successful write without raw tool input or secrets", async () => {
    const hiddenToken = "token-that-must-not-be-logged";
    const result = await runAuditedAgentWrite(
      { toolName: "set_lead_status", entityType: "Lead", entityId: "lead-1", action: "SET_STATUS" },
      async () => ({
        result: { status: "CONTACTED" },
        beforeData: { status: "NEW" },
        afterData: { status: "CONTACTED" },
      }),
    );

    expect(result).toEqual({ status: "CONTACTED" });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actor: "AGENT", success: false, toolName: "set_lead_status" }),
    }));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ success: true, beforeData: '{"status":"NEW"}', afterData: '{"status":"CONTACTED"}', errorMessage: null }),
    }));
    expect(JSON.stringify({ create: mocks.create.mock.calls, update: mocks.update.mock.calls })).not.toContain(hiddenToken);
  });

  it("keeps a failed write as a safe audit attempt", async () => {
    await expect(runAuditedAgentWrite(
      { toolName: "set_lead_status", entityType: "Lead", entityId: "missing", action: "SET_STATUS" },
      async () => { throw new ServiceNotFoundError("Lead"); },
    )).rejects.toThrow("Lead nao encontrado.");
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: { errorMessage: "Lead nao encontrado." },
    }));
  });

  it("passes one request-scoped client through the audited operation", async () => {
    await runAuditedAgentWrite(
      { toolName: "set_lead_status", entityType: "Lead", entityId: "lead-1", action: "SET_STATUS" },
      async (db) => {
        expect(db).toBe(database);
        return { result: {}, beforeData: {}, afterData: {} };
      },
    );

    expect(mocks.getDb).toHaveBeenCalledTimes(1);
  });
});
