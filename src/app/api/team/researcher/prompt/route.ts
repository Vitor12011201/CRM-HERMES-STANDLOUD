import { NextResponse } from "next/server";

import { getAgentPromptConfiguration, toAgentPromptConfigurationDto } from "@/lib/agent-prompt-config";
import { requireApiSession } from "@/lib/auth/api";
import { agentPromptErrorResponse } from "./response";

export async function GET() {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  try {
    return NextResponse.json(toAgentPromptConfigurationDto(await getAgentPromptConfiguration("researcher")), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return agentPromptErrorResponse(error);
  }
}
