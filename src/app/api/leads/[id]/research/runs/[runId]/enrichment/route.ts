import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/auth/api";
import {
  applyLeadEnrichment,
  getLeadEnrichmentSuggestions,
  leadEnrichmentApplyInputSchema,
} from "@/lib/lead-enrichment";
import { leadEnrichmentErrorResponse } from "../../../enrichment-response";

type Context = { params: Promise<{ id: string; runId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  const { id, runId } = await params;
  try {
    const suggestions = await getLeadEnrichmentSuggestions(id, runId);
    return NextResponse.json({ suggestions });
  } catch (error) {
    return leadEnrichmentErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null);
  const parsed = leadEnrichmentApplyInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "LEAD_ENRICHMENT_INPUT_INVALID" }, { status: 400 });
  }
  const { id, runId } = await params;
  try {
    const enrichment = await applyLeadEnrichment(id, runId, parsed.data);
    return NextResponse.json({ enrichment });
  } catch (error) {
    return leadEnrichmentErrorResponse(error);
  }
}
