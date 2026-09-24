import { NextResponse } from "next/server";

import { AgentPromptConfigError } from "@/lib/agent-prompt-config";

export function agentPromptErrorResponse(error: unknown) {
  if (!(error instanceof AgentPromptConfigError)) {
    return NextResponse.json({ error: "AGENT_PROMPT_CONFIGURATION_UNAVAILABLE" }, { status: 503 });
  }

  const status = error.code === "AGENT_PROMPT_INPUT_INVALID"
    ? 400
    : error.code === "AGENT_PROMPT_AGENT_NOT_FOUND" || error.code === "AGENT_PROMPT_VERSION_NOT_FOUND"
      ? 404
      : error.code === "AGENT_PROMPT_VERSION_CONFLICT"
        ? 409
        : 503;

  return NextResponse.json({ error: error.code }, { status, headers: { "Cache-Control": "no-store" } });
}
