import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { lead: { findMany: mocks.findMany } } }));

import { getDueFollowUps } from "./dashboard";

describe("due follow-up service", () => {
  it("uses the São Paulo business date when UTC is already on the following day", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "overdue", companyName: "Ontem", city: null, status: "NEW", nextFollowUpAt: new Date("2026-09-20T00:00:00.000Z") },
      { id: "today", companyName: "Hoje", city: null, status: "NEW", nextFollowUpAt: new Date("2026-09-21T00:00:00.000Z") },
      { id: "upcoming", companyName: "Amanhã", city: null, status: "NEW", nextFollowUpAt: new Date("2026-09-22T00:00:00.000Z") },
    ]);

    const result = await getDueFollowUps(
      { includeUpcoming: true, limit: 10 },
      new Date("2026-09-22T00:30:00.000Z"),
    );

    expect(result.overdue.map((lead) => lead.id)).toEqual(["overdue"]);
    expect(result.today.map((lead) => lead.id)).toEqual(["today"]);
    expect(result.upcoming.map((lead) => lead.id)).toEqual(["upcoming"]);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { nextFollowUpAt: { not: null } },
    }));
  });
});
