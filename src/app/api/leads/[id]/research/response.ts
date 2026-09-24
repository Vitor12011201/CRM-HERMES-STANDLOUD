import { NextResponse } from "next/server";

import { ResearchWorkflowError } from "@/lib/research-workflow";

/** Stable HTTP boundary for operational research without upstream diagnostics. */
export function researchWorkflowErrorResponse(error: unknown) {
  if (!(error instanceof ResearchWorkflowError)) {
    return NextResponse.json({ error: "RESEARCH_WORKFLOW_FAILED" }, { status: 503 });
  }
  const status = error.code === "RESEARCH_LEAD_NOT_FOUND" || error.code === "RESEARCH_RUN_NOT_FOUND"
    ? 404
    : error.code === "RESEARCH_WEBSITE_REQUIRED" || error.code === "RESEARCH_WEBSITE_INVALID" || error.code === "RESEARCH_START_INPUT_INVALID" || error.code === "RESEARCH_APPROVAL_INPUT_INVALID"
      ? 400
      : error.code === "RESEARCH_APPROVAL_INVALID_STATE" || error.code === "RESEARCH_APPROVAL_RECONCILIATION_REQUIRED"
        ? 409
        : 503;
  return NextResponse.json({ error: error.code }, { status });
}
