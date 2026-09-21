import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieValue: undefined as string | undefined,
  env: {
    STANDLOUD_ADMIN_PASSWORD: "test-admin-password",
    STANDLOUD_SESSION_SECRET: "test-session-secret",
  },
  redirect: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => (mocks.cookieValue ? { value: mocks.cookieValue } : undefined),
  })),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import {
  authenticateAdminPassword,
  getSessionCookieOptions,
  hasWebSession,
  requirePageSession,
} from "./server";
import { createSessionToken, sessionCookieName } from "./session";

describe("web session authentication", () => {
  beforeEach(() => {
    mocks.cookieValue = undefined;
    mocks.redirect.mockReset();
    mocks.env.STANDLOUD_ADMIN_PASSWORD = "test-admin-password";
    mocks.env.STANDLOUD_SESSION_SECRET = "test-session-secret";
  });

  it("creates a session only for the configured password", async () => {
    await expect(authenticateAdminPassword("invalid-password")).resolves.toBeNull();
    await expect(authenticateAdminPassword("test-admin-password")).resolves.toEqual(expect.any(String));
  });

  it("rejects invalid and expired cookies", async () => {
    mocks.cookieValue = "invalid";
    await expect(hasWebSession()).resolves.toBe(false);

    mocks.cookieValue = await createSessionToken("test-session-secret", {
      now: 1_000,
      durationMs: 1,
    });
    await expect(hasWebSession()).resolves.toBe(false);
  });

  it("allows a valid signed cookie and redirects unauthenticated pages", async () => {
    mocks.cookieValue = await createSessionToken("test-session-secret");
    await expect(hasWebSession()).resolves.toBe(true);

    mocks.cookieValue = undefined;
    await requirePageSession();
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });

  it("uses an HttpOnly, path-wide, twelve-hour cookie", () => {
    expect(getSessionCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 43_200,
    });
  });

  it("returns controlled login failures and a signed cookie on success", async () => {
    const invalid = await login(
      new Request("https://crm.test/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password: "wrong" }),
      }),
    );
    expect(invalid.status).toBe(401);

    const valid = await login(
      new Request("https://crm.test/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password: "test-admin-password" }),
      }),
    );
    expect(valid.status).toBe(200);
    expect(valid.headers.get("set-cookie")).toContain(`${sessionCookieName}=`);
    expect(valid.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("clears the session cookie on logout", async () => {
    const response = await logout();
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(`${sessionCookieName}=`);
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
  });
});
