import { describe, expect, it } from "vitest";
import { createSessionToken, hasValidAdminPassword, hasValidSessionToken, sessionDurationMs } from "./session";

const sessionSecret = "test-session-secret-with-enough-length";

describe("single-user session security", () => {
  it("accepts only the configured administrator password", () => {
    expect(hasValidAdminPassword("senha-correta", "senha-correta")).toBe(true);
    expect(hasValidAdminPassword("senha-incorreta", "senha-correta")).toBe(false);
    expect(hasValidAdminPassword("senha-correta", undefined)).toBe(false);
  });

  it("creates a signed session that can be verified", async () => {
    const now = 1_800_000_000_000;
    const token = await createSessionToken(sessionSecret, { now });
    await expect(hasValidSessionToken(token, sessionSecret, now + sessionDurationMs - 1)).resolves.toBe(true);
  });

  it("rejects invalid or tampered session cookies", async () => {
    const token = await createSessionToken(sessionSecret, { now: 1_800_000_000_000 });
    await expect(hasValidSessionToken(`${token}x`, sessionSecret)).resolves.toBe(false);
    await expect(hasValidSessionToken(token, "different-session-secret")).resolves.toBe(false);
  });

  it("rejects expired session cookies", async () => {
    const token = await createSessionToken(sessionSecret, { now: 1_800_000_000_000, durationMs: 1 });
    await expect(hasValidSessionToken(token, sessionSecret, 1_800_000_000_002)).resolves.toBe(false);
  });
});
