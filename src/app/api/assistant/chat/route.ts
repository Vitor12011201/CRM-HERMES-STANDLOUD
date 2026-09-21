import { NextResponse } from "next/server";
import { env } from "cloudflare:workers";

import { assistantChatSchema, sendHermesChat } from "@/lib/assistant";
import { requireApiSession } from "@/lib/auth/api";

type HermesEnv = {
  HERMES_BASE_URL?: string;
  HERMES_API_KEY?: string;
};

export async function POST(request: Request) {
  const unauthorized = await requireApiSession();
  if (unauthorized) {
    return unauthorized;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Envie uma mensagem válida." }, { status: 400 });
  }

  const parsed = assistantChatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Envie uma mensagem válida." },
      { status: 400 },
    );
  }

  const hermesEnv = env as typeof env & HermesEnv;
  const result = await sendHermesChat(parsed.data, {
    baseUrl: hermesEnv.HERMES_BASE_URL,
    apiKey: hermesEnv.HERMES_API_KEY,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }

  return NextResponse.json({ message: result.content }, { headers: { "Cache-Control": "no-store" } });
}
