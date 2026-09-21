import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  leadFindUnique: vi.fn(),
  leadUpdate: vi.fn(),
  leadUpdateMany: vi.fn(),
  leadActivityCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    lead: {
      findUnique: mocks.leadFindUnique,
      update: mocks.leadUpdate,
      updateMany: mocks.leadUpdateMany,
    },
    leadActivity: { create: mocks.leadActivityCreate },
    $transaction: mocks.transaction,
  },
}));

import { addLeadActivity, setLeadStatus } from "./leads";

const leadId = "lead-1";
let current: { id: string; status: "NEW" | "CONTACTED" | "REPLIED"; lastContactAt: Date | null };
let activityNumber: number;

beforeEach(() => {
  vi.clearAllMocks();
  current = { id: leadId, status: "NEW", lastContactAt: null };
  activityNumber = 0;
  mocks.leadFindUnique.mockImplementation(async () => ({ ...current }));
  mocks.leadUpdate.mockImplementation(async ({ data }) => {
    current = { ...current, ...data };
    return { ...current };
  });
  mocks.leadUpdateMany.mockImplementation(async ({ where, data }) => {
    const candidate = data.lastContactAt as Date;
    const canAdvance = where.id === leadId
      && (!current.lastContactAt || current.lastContactAt < candidate);
    if (canAdvance) current.lastContactAt = candidate;
    return { count: canAdvance ? 1 : 0 };
  });
  mocks.leadActivityCreate.mockImplementation(async ({ data }) => ({ id: `activity-${++activityNumber}`, ...data }));
  mocks.transaction.mockImplementation(async (operations: Promise<unknown>[]) => Promise.all(operations));
});

describe("lead activity contact consistency", () => {
  it("sets lastContactAt when a CONTACT is recorded for a lead without contact history", async () => {
    const contactAt = new Date("2026-09-21T15:00:00.000Z");

    await addLeadActivity(leadId, { type: "CONTACT", note: "Contato", createdAt: contactAt });

    expect(current.lastContactAt).toEqual(contactAt);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.leadUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { lastContactAt: contactAt },
      where: expect.objectContaining({ id: leadId }),
    }));
  });

  it("advances lastContactAt when a newer CONTACT is recorded", async () => {
    const previousContactAt = new Date("2026-09-18T12:00:00.000Z");
    const contactAt = new Date("2026-09-21T15:00:00.000Z");
    current.lastContactAt = previousContactAt;

    await addLeadActivity(leadId, { type: "CONTACT", note: "Contato", createdAt: contactAt });

    expect(current.lastContactAt).toEqual(contactAt);
  });

  it("does not let an older CONTACT regress lastContactAt", async () => {
    const contactAt = new Date("2026-09-18T12:00:00.000Z");
    const latestContactAt = new Date("2026-09-21T15:00:00.000Z");
    current.lastContactAt = latestContactAt;

    await addLeadActivity(leadId, { type: "CONTACT", note: "Contato antigo", createdAt: contactAt });

    expect(current.lastContactAt).toEqual(latestContactAt);
    expect(mocks.leadActivityCreate).toHaveBeenCalledTimes(1);
  });

  it("sets lastContactAt when a REPLY is recorded", async () => {
    const replyAt = new Date("2026-09-21T16:00:00.000Z");

    await addLeadActivity(leadId, { type: "REPLY", note: "Resposta", createdAt: replyAt });

    expect(current.lastContactAt).toEqual(replyAt);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it.each(["NOTE", "STATUS_CHANGE"] as const)("does not update lastContactAt for %s activities", async (type) => {
    const latestContactAt = new Date("2026-09-21T15:00:00.000Z");
    current.lastContactAt = latestContactAt;

    await addLeadActivity(leadId, { type, note: "Registro administrativo", createdAt: new Date("2026-09-22T12:00:00.000Z") });

    expect(current.lastContactAt).toEqual(latestContactAt);
    expect(mocks.leadUpdateMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(["CONTACTED", "REPLIED"] as const)("changes status to %s without treating it as a contact event", async (status) => {
    const latestContactAt = new Date("2026-09-21T15:00:00.000Z");
    current.lastContactAt = latestContactAt;

    const outcome = await setLeadStatus(leadId, status);

    expect(outcome.result).toEqual({ status, changed: true });
    expect(current.status).toBe(status);
    expect(current.lastContactAt).toEqual(latestContactAt);
    expect(mocks.leadActivityCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "STATUS_CHANGE" }),
    }));
    expect(mocks.leadUpdateMany).not.toHaveBeenCalled();
  });
});
