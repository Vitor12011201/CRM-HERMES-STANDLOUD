import { NextResponse } from "next/server";

import { ScoutWorkflowError } from "@/lib/scout-workflow";

/** Converts workflow failures into a small, stable HTTP contract without raw upstream details. */
export function scoutWorkflowErrorResponse(error: unknown) {
  if (!(error instanceof ScoutWorkflowError)) {
    return NextResponse.json({ error: "Não foi possível concluir a operação Scout." }, { status: 500 });
  }

  const status = error.code === "SCOUT_WORKFLOW_DISCOVERY_INPUT_INVALID"
    || error.code === "SCOUT_APPROVAL_INPUT_INVALID"
    ? 400
    : error.code === "SCOUT_WORKFLOW_DISCOVERY_FAILED" || error.code === "SCOUT_APPROVAL_RETRYABLE"
      ? 503
      : 409;

  return NextResponse.json({ error: error.code }, { status });
}
