import { NextResponse } from "next/server";
import { hasWebSession } from "./server";

export async function requireApiSession() {
  if (await hasWebSession()) return null;
  return NextResponse.json(
    { error: "SessÃ£o invÃ¡lida ou expirada." },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}
