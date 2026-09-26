import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/auth/api";
import { getDashboardFunnel } from "@/lib/dashboard-reads";

export async function GET() {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json(await getDashboardFunnel(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "DASHBOARD_FUNNEL_UNAVAILABLE" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
