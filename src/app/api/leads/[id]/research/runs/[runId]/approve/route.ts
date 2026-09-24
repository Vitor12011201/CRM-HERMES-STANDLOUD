import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/auth/api";
import { approveLeadResearchRun, leadResearchApprovalInputSchema, toLeadResearchRunDto } from "@/lib/research-workflow";
import { researchWorkflowErrorResponse } from "../../../response";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  const { id, runId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = leadResearchApprovalInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "RESEARCH_APPROVAL_INPUT_INVALID" }, { status: 400 });
  try {
    const run = await approveLeadResearchRun(id, runId, parsed.data);
    return NextResponse.json({ run: toLeadResearchRunDto(run) });
  } catch (error) {
    return researchWorkflowErrorResponse(error);
  }
}
