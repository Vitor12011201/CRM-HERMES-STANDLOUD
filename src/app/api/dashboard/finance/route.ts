import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/auth/api";
import { getDashboardFinance } from "@/lib/dashboard-reads";

export async function GET() {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json(await getDashboardFinance(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "DASHBOARD_FINANCE_UNAVAILABLE" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
