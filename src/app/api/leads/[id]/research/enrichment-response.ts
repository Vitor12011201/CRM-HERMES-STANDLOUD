import { NextResponse } from "next/server";

import { LeadEnrichmentError } from "@/lib/lead-enrichment";

/** Stable HTTP boundary; no database, evidence, or browser payload diagnostics escape. */
export function leadEnrichmentErrorResponse(error: unknown) {
  if (!(error instanceof LeadEnrichmentError)) {
    return NextResponse.json({ error: "LEAD_ENRICHMENT_FAILED" }, { status: 503 });
  }
  const status = error.code === "RESEARCH_RUN_NOT_FOUND"
    ? 404
    : error.code === "LEAD_ENRICHMENT_RUN_NOT_APPROVED" || error.code === "LEAD_ENRICHMENT_FIELD_CONFLICT"
      ? 409
      : error.code === "LEAD_ENRICHMENT_INPUT_INVALID" || error.code === "LEAD_ENRICHMENT_SUGGESTION_NOT_FOUND" || error.code === "ENRICHMENT_MULTIPLE_VALUES_FOR_FIELD"
        ? 400
        : 503;
  return NextResponse.json({ error: error.code }, { status });
}
