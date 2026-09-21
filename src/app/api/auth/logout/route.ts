import { NextResponse } from "next/server";
import { getSessionCookieOptions } from "@/lib/auth/server";
import { sessionCookieName } from "@/lib/auth/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieName, "", { ...getSessionCookieOptions(), maxAge: 0 });
  return response;
}
