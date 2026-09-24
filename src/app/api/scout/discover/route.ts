import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/auth/api";
import {
  discoverScoutCandidateForReview,
  scoutWorkflowDiscoveryInputSchema,
} from "@/lib/scout-workflow";
import { scoutWorkflowErrorResponse } from "../response";

export async function POST(request: Request) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = scoutWorkflowDiscoveryInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "SCOUT_WORKFLOW_DISCOVERY_INPUT_INVALID" }, { status: 400 });
  }

  try {
    const result = await discoverScoutCandidateForReview(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return scoutWorkflowErrorResponse(error);
  }
}
