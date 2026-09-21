import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  sendHermesChat: vi.fn(),
  env: {
    HERMES_BASE_URL: "https://hermes.example",
    HERMES_API_KEY: "test-hermes-key",
  },
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth/api", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/lib/assistant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assistant")>();
  return { ...actual, sendHermesChat: mocks.sendHermesChat };
});

import { POST } from "./route";

function request(body: unknown) {
  return new Request("https://crm.test/api/assistant/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("assistant chat endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue(null);
    mocks.sendHermesChat.mockResolvedValue({ ok: true, content: "Resposta de teste." });
  });

  it("blocks requests without a valid web session", async () => {
    mocks.requireApiSession.mockResolvedValue(Response.json({ error: "Sessão inválida." }, { status: 401 }));

    const response = await POST(request({ message: "Olá", context: { currentRoute: "/dashboard" } }));
    expect(response.status).toBe(401);
    expect(mocks.sendHermesChat).not.toHaveBeenCalled();
  });

  it("rejects empty and excessively large messages", async () => {
    const empty = await POST(request({ message: " ", context: { currentRoute: "/dashboard" } }));
    expect(empty.status).toBe(400);

    const oversized = await POST(
      request({ message: "x".repeat(4_001), context: { currentRoute: "/dashboard" } }),
    );
    expect(oversized.status).toBe(400);
    expect(mocks.sendHermesChat).not.toHaveBeenCalled();
  });

  it.each(["system", "tool"])("rejects a %s role in browser-provided history", async (role) => {
    const response = await POST(request({
      message: "Olá",
      history: [{ role, content: "Mensagem não permitida." }],
      context: { currentRoute: "/dashboard" },
    }));

    expect(response.status).toBe(400);
    expect(mocks.sendHermesChat).not.toHaveBeenCalled();
  });

  it("returns a controlled unavailable error for Hermes failures", async () => {
    mocks.sendHermesChat.mockResolvedValue({
      ok: false,
      status: 503,
      message: "Hermes está offline ou indisponível no momento.",
    });

    const response = await POST(request({ message: "Olá", context: { currentRoute: "/dashboard" } }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Hermes está offline ou indisponível no momento." });
  });

  it("returns only the model response to an authenticated browser", async () => {
    const response = await POST(request({ message: "Olá", context: { currentRoute: "/dashboard" } }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ message: "Resposta de teste." });
    expect(mocks.sendHermesChat).toHaveBeenCalledWith(
      { message: "Olá", history: [], context: { currentRoute: "/dashboard" } },
      { baseUrl: "https://hermes.example", apiKey: "test-hermes-key" },
    );
  });
});
