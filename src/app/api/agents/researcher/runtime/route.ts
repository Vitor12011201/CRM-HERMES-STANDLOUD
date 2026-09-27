import { NextResponse } from "next/server";
import { env } from "cloudflare:workers";

import { getResearcherRuntimeStatus } from "@/lib/agent-runtime-status";
import { requireApiSession } from "@/lib/auth/api";

type HermesResearcherEnv = {
  HERMES_BASE_URL?: string;
  HERMES_RESEARCHER_API_KEY?: string;
};

/** Read-only operational status; organization lifecycle remains in the agent registry. */
export async function GET() {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  const researcherEnv = env as typeof env & HermesResearcherEnv;
  const runtime = await getResearcherRuntimeStatus({
    baseUrl: researcherEnv.HERMES_BASE_URL,
    researcherApiKey: researcherEnv.HERMES_RESEARCHER_API_KEY,
  });

  return NextResponse.json(runtime, { headers: { "Cache-Control": "no-store" } });
}
