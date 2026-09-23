import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  leadCreate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

import { createLead, LeadCreateValidationError } from "./leads";

const database = { lead: { create: mocks.leadCreate } };
const input = {
  companyName: "Atlas Contabilidade",
  qualificationScore: 0,
  status: "NEW" as const,
};

describe("createLead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(database);
    mocks.leadCreate.mockResolvedValue({ id: "lead-1", ...input });
  });

  it("uses the request-scoped DB service boundary with scalar validated input", async () => {
    await expect(createLead(input)).resolves.toEqual({ id: "lead-1", ...input });

    expect(mocks.getDb).toHaveBeenCalledTimes(1);
    expect(mocks.leadCreate).toHaveBeenCalledWith({ data: input });
  });

  it("fails closed on invalid runtime input before any create", async () => {
    await expect(createLead({ ...input, companyName: "A".repeat(161) })).rejects.toEqual(
      new LeadCreateValidationError("LEAD_CREATE_INPUT_INVALID"),
    );

    expect(mocks.leadCreate).not.toHaveBeenCalled();
  });

  it("sends the leadSchema output, including preprocessing, to Prisma", async () => {
    await createLead({
      companyName: "  Atlas Contabilidade  ",
      qualificationScore: "0",
      status: "NEW",
    });

    expect(mocks.leadCreate).toHaveBeenCalledWith({
      data: {
        companyName: "Atlas Contabilidade",
        qualificationScore: 0,
        status: "NEW",
      },
    });
  });
});
