import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { createSessionToken, hasValidAdminPassword, hasValidSessionToken, sessionCookieName, sessionDurationMs } from "./session";

type AuthSecretEnv = {
  STANDLOUD_ADMIN_PASSWORD?: string;
  STANDLOUD_SESSION_SECRET?: string;
};

function getAuthSecrets() {
  const secretEnv = env as typeof env & AuthSecretEnv;
  return {
    adminPassword: secretEnv.STANDLOUD_ADMIN_PASSWORD,
    sessionSecret: secretEnv.STANDLOUD_SESSION_SECRET,
  };
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(sessionDurationMs / 1000),
  };
}

export async function hasWebSession() {
  const { sessionSecret } = getAuthSecrets();
  const cookieStore = await cookies();
  return hasValidSessionToken(cookieStore.get(sessionCookieName)?.value, sessionSecret);
}

export async function requirePageSession() {
  if (!(await hasWebSession())) redirect("/login");
}

export async function authenticateAdminPassword(password: string) {
  const { adminPassword, sessionSecret } = getAuthSecrets();
  if (!sessionSecret || !hasValidAdminPassword(password, adminPassword)) return null;
  return createSessionToken(sessionSecret);
}
