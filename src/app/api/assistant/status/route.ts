import { NextResponse } from "next/server";
import { env } from "cloudflare:workers";

import { getHermesAvailability } from "@/lib/assistant";
import { requireApiSession } from "@/lib/auth/api";

type HermesEnv = {
  HERMES_BASE_URL?: string;
  HERMES_API_KEY?: string;
};

export async function GET() {
  const unauthorized = await requireApiSession();
  if (unauthorized) {
    return unauthorized;
  }

  const hermesEnv = env as typeof env & HermesEnv;
  const online = await getHermesAvailability({
    baseUrl: hermesEnv.HERMES_BASE_URL,
    apiKey: hermesEnv.HERMES_API_KEY,
  });

  return NextResponse.json(
    { online },
    { headers: { "Cache-Control": "no-store" } },
  );
}
