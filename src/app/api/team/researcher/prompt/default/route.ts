import { NextResponse } from "next/server";

import {
  resetAgentPromptInputSchema,
  resetAgentPromptToBuiltIn,
  toAgentPromptConfigurationDto,
} from "@/lib/agent-prompt-config";
import { requireApiSession } from "@/lib/auth/api";
import { agentPromptErrorResponse } from "../response";

export async function POST(request: Request) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = resetAgentPromptInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "AGENT_PROMPT_INPUT_INVALID" }, { status: 400 });

  try {
    return NextResponse.json(toAgentPromptConfigurationDto(await resetAgentPromptToBuiltIn(parsed.data, "researcher")));
  } catch (error) {
    return agentPromptErrorResponse(error);
  }
}
