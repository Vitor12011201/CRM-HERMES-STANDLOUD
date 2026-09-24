import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/auth/api";
import {
  approveScoutCandidateReview,
  scoutWorkflowApprovalInputSchema,
} from "@/lib/scout-workflow";
import { scoutWorkflowErrorResponse } from "../../../response";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = scoutWorkflowApprovalInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "SCOUT_APPROVAL_INPUT_INVALID" }, { status: 400 });
  }

  try {
    const { id } = await params;
    const result = await approveScoutCandidateReview(id, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return scoutWorkflowErrorResponse(error);
  }
}
