import { describe, expect, it } from "vitest";

import { fetchDashboardData } from "./dashboard-client-data";

describe("dashboard client data loading", () => {
  it("keeps an individual API failure isolated from another successful section", async () => {
    const successful = await fetchDashboardData<{ totalLeads: number }>("/api/dashboard/funnel", async () => Response.json({ totalLeads: 2 }));
    const failed = await fetchDashboardData("/api/dashboard/finance", async () => new Response(null, { status: 500 }));
    expect(successful).toEqual({ kind: "success", data: { totalLeads: 2 } });
    expect(failed).toEqual({ kind: "error" });
  });

  it("reports an expired session separately so the client can redirect to login", async () => {
    await expect(fetchDashboardData("/api/dashboard/funnel", async () => new Response(null, { status: 401 }))).resolves.toEqual({ kind: "unauthorized" });
  });
});
