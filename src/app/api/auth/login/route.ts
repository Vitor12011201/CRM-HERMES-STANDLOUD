import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminPassword, getSessionCookieOptions } from "@/lib/auth/server";
import { sessionCookieName } from "@/lib/auth/session";

const loginSchema = z.object({ password: z.string().min(1).max(1024) }).strict();

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Informe a senha." }, { status: 400 });

  const sessionToken = await authenticateAdminPassword(parsed.data.password);
  if (!sessionToken) return NextResponse.json({ error: "Senha invÃ¡lida." }, { status: 401 });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieName, sessionToken, getSessionCookieOptions());
  return response;
}
