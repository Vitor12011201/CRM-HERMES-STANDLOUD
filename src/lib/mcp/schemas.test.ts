import { describe, expect, it } from "vitest";
import {
  addLeadActivityInputSchema,
  listLeadsInputSchema,
  setLeadFollowUpInputSchema,
  setLeadStatusInputSchema,
  updateLeadQualificationInputSchema,
} from "./schemas";

const leadId = "claaaaaaaaaaaaaaaaaaaaaaa";

describe("MCP input schemas", () => {
  it("applies a bounded default limit and accepts a valid list filter", () => {
    expect(listLeadsInputSchema.parse({ status: "QUALIFIED", minScore: 5, maxScore: 8 })).toMatchObject({ limit: 25, status: "QUALIFIED" });
    expect(listLeadsInputSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(listLeadsInputSchema.safeParse({ minScore: 8, maxScore: 5 }).success).toBe(false);
  });

  it("rejects invalid statuses and activity payloads", () => {
    expect(setLeadStatusInputSchema.safeParse({ leadId, status: "ANYTHING" }).success).toBe(false);
    expect(addLeadActivityInputSchema.safeParse({ leadId, activityType: "SHELL", note: "x" }).success).toBe(false);
  });

  it("validates qualification score boundaries and follow-up dates", () => {
    expect(updateLeadQualificationInputSchema.safeParse({ leadId, qualificationScore: 0 }).success).toBe(true);
    expect(updateLeadQualificationInputSchema.safeParse({ leadId, qualificationScore: 10 }).success).toBe(true);
    expect(updateLeadQualificationInputSchema.safeParse({ leadId, qualificationScore: 11 }).success).toBe(false);
    expect(setLeadFollowUpInputSchema.safeParse({ leadId, nextFollowUpAt: "2026-09-21" }).success).toBe(true);
    expect(setLeadFollowUpInputSchema.safeParse({ leadId, nextFollowUpAt: "not-a-date" }).success).toBe(false);
  });
});
