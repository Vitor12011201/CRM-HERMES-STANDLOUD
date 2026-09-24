import { z } from "zod";
import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/auth/api";
import { rejectScoutCandidateReviewForWorkflow } from "@/lib/scout-workflow";
import { scoutWorkflowErrorResponse } from "../../../response";

const emptyRequestSchema = z.object({}).strict();
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  if (!emptyRequestSchema.safeParse(body).success) {
    return NextResponse.json({ error: "SCOUT_APPROVAL_INPUT_INVALID" }, { status: 400 });
  }

  try {
    const { id } = await params;
    const result = await rejectScoutCandidateReviewForWorkflow(id);
    return NextResponse.json({ outcome: result.review.status, changed: result.changed });
  } catch (error) {
    return scoutWorkflowErrorResponse(error);
  }
}
