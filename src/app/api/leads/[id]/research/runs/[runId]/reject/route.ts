import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/auth/api";
import { rejectLeadResearchRun, toLeadResearchRunDto } from "@/lib/research-workflow";
import { researchWorkflowErrorResponse } from "../../../response";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  const { id, runId } = await params;
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) {
    return NextResponse.json({ error: "RESEARCH_APPROVAL_INPUT_INVALID" }, { status: 400 });
  }
  try {
    const run = await rejectLeadResearchRun(id, runId);
    return NextResponse.json({ run: toLeadResearchRunDto(run) });
  } catch (error) {
    return researchWorkflowErrorResponse(error);
  }
}
