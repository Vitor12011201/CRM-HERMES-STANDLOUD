import { NextResponse } from "next/server";

import {
  createAgentPromptVersion,
  createAgentPromptVersionInputSchema,
  toAgentPromptConfigurationDto,
} from "@/lib/agent-prompt-config";
import { requireApiSession } from "@/lib/auth/api";
import { agentPromptErrorResponse } from "../response";

export async function POST(request: Request) {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = createAgentPromptVersionInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "AGENT_PROMPT_INPUT_INVALID" }, { status: 400 });

  try {
    return NextResponse.json(toAgentPromptConfigurationDto(await createAgentPromptVersion(parsed.data, "researcher")), { status: 201 });
  } catch (error) {
    return agentPromptErrorResponse(error);
  }
}
