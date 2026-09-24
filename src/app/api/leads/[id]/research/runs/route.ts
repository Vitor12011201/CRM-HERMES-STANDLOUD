import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/auth/api";
import {
  parseEmptyResearchStartBody,
  startLeadResearch,
  toLeadResearchRunDto,
} from "@/lib/research-workflow";
import { researchWorkflowErrorResponse } from "../response";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  try {
    parseEmptyResearchStartBody(body);
    const run = await startLeadResearch(id);
    return NextResponse.json({ run: toLeadResearchRunDto(run) }, { status: 201 });
  } catch (error) {
    return researchWorkflowErrorResponse(error);
  }
}
