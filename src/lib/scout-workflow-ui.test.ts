import { describe, expect, it } from "vitest";

import { requiresInitialScoutApprovalAcknowledgement } from "./scout-workflow-ui";

describe("Scout approval UI acknowledgement", () => {
  it("does not require a new acknowledgement for an APPROVING recovery", () => {
    expect(requiresInitialScoutApprovalAcknowledgement({
      status: "APPROVING",
      unresolvedQuestions: ["Confirm business contact availability."],
    })).toBe(false);
  });

  it("continues to require acknowledgement for the first PENDING approval", () => {
    expect(requiresInitialScoutApprovalAcknowledgement({
      status: "PENDING",
      unresolvedQuestions: ["Confirm business contact availability."],
    })).toBe(true);
  });
});
