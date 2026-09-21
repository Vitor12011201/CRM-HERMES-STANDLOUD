import { describe, expect, it } from "vitest";
import { getFunnelMetrics } from "./dashboard";

describe("funnel metrics", () => {
  it("counts leads that advanced in the funnel as having reached prior stages", () => {
    const metrics = getFunnelMetrics([
      { status: "CONTACTED", lastContactAt: new Date() },
      { status: "PROPOSAL_SENT", lastContactAt: new Date() },
      { status: "WON", lastContactAt: new Date() },
      { status: "LOST", lastContactAt: new Date() },
    ]);
    expect(metrics.contacted).toBe(4);
    expect(metrics.replied).toBe(2);
    expect(metrics.interested).toBe(2);
    expect(metrics.proposals).toBe(2);
    expect(metrics.won).toBe(1);
    expect(metrics.conversionRate).toBe(25);
  });

  it("returns no rate when there are no contacted leads", () => {
    expect(getFunnelMetrics([{ status: "NEW", lastContactAt: null }]).responseRate).toBeNull();
  });
});
