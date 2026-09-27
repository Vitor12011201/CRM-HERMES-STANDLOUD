import { NextResponse } from "next/server";
import { env } from "cloudflare:workers";

import { getResearcherRuntimeStatus, isResearcherRuntimeDefinitelyUnavailable } from "@/lib/agent-runtime-status";
import { requireApiSession } from "@/lib/auth/api";
import {
  parseEmptyResearchStartBody,
  ResearchWorkflowError,
  startLeadResearch,
  toLeadResearchRunDto,
} from "@/lib/research-workflow";
import { researchWorkflowErrorResponse } from "../response";

type HermesResearcherEnv = {
  HERMES_BASE_URL?: string;
  HERMES_RESEARCHER_API_KEY?: string;
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  try {
    parseEmptyResearchStartBody(body);

    // This preflight is deliberately before startLeadResearch: a definitely
    // unavailable researcher must not trigger acquisition, rendering, model
    // calls, or a LeadResearchRun write.
    const researcherEnv = env as typeof env & HermesResearcherEnv;
    const runtime = await getResearcherRuntimeStatus({
      baseUrl: researcherEnv.HERMES_BASE_URL,
      researcherApiKey: researcherEnv.HERMES_RESEARCHER_API_KEY,
    });
    if (isResearcherRuntimeDefinitelyUnavailable(runtime.status)) {
      throw new ResearchWorkflowError("RESEARCHER_UNAVAILABLE");
    }

    const run = await startLeadResearch(id);
    return NextResponse.json({ run: toLeadResearchRunDto(run) }, { status: 201 });
  } catch (error) {
    return researchWorkflowErrorResponse(error);
  }
}
