import { describe, expect, it } from "vitest";

import { createLeadDetailDiagnostics } from "./lead-detail-diagnostics";

describe("Lead detail diagnostics", () => {
  it("emits a stable correlation ID, stage, elapsed time, and only an optional lead ID", () => {
    const clock = [1_000, 1_004, 1_018];
    const events: unknown[] = [];
    const diagnostics = createLeadDetailDiagnostics({
      correlationId: "lead-detail-test",
      now: () => clock.shift() ?? 1_018,
      emit: (event) => events.push(event),
    });

    diagnostics.log("LEAD_DETAIL_START");
    diagnostics.log("LEAD_QUERY_START", "lead-opaque-id");

    expect(events).toEqual([
      {
        correlationId: "lead-detail-test",
        stage: "LEAD_DETAIL_START",
        elapsedMs: 4,
      },
      {
        correlationId: "lead-detail-test",
        stage: "LEAD_QUERY_START",
        elapsedMs: 18,
        leadId: "lead-opaque-id",
      },
    ]);
  });
});
