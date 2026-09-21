import { describe, expect, it } from "vitest";
import { requireMcpBearerToken } from "./auth";

const expectedToken = "test-mcp-token";

async function expectUnauthorized(request: Request, token: string | undefined) {
  const response = requireMcpBearerToken(request, token);
  expect(response).not.toBeNull();
  expect(response?.status).toBe(401);
  expect(response?.headers.get("WWW-Authenticate")).toBe('Bearer realm="standloud-mcp"');
  expect(response?.headers.get("Cache-Control")).toBe("no-store");
  await expect(response?.text()).resolves.toBe("Unauthorized");
}

describe("MCP bearer authentication", () => {
  it("rejects a request without an Authorization header", async () => {
    await expectUnauthorized(new Request("https://crm.test/mcp", { method: "POST" }), expectedToken);
  });

  it("rejects a request with an invalid bearer token", async () => {
    await expectUnauthorized(new Request("https://crm.test/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer invalid-token" },
    }), expectedToken);
  });

  it("allows a request with the configured bearer token", () => {
    const response = requireMcpBearerToken(new Request("https://crm.test/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${expectedToken}` },
    }), expectedToken);

    expect(response).toBeNull();
  });

  it("fails closed when the Worker secret is not configured", async () => {
    await expectUnauthorized(new Request("https://crm.test/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${expectedToken}` },
    }), undefined);
  });
});
