import { describe, expect, it, vi } from "vitest";

import type { ResearcherModelRequest } from "./dry-run";
import {
  HermesResearcherModelClient,
  HermesResearcherModelClientError,
  researcherChatCompletionsPath,
} from "./hermes-model-client";

const request: ResearcherModelRequest = {
  messages: [
    { role: "system", content: "Researcher system prompt" },
    { role: "user", content: "Synthetic source data" },
  ],
  responseFormat: "json",
};

function createClient(
  fetchImplementation: typeof fetch,
  options?: Partial<ConstructorParameters<typeof HermesResearcherModelClient>[0]>,
) {
  return new HermesResearcherModelClient({
    gatewayBaseUrl: "https://researcher-gateway.example",
    apiKey: "test-researcher-key",
    model: "test-model",
    fetchImplementation,
    ...options,
  });
}

describe("HermesResearcherModelClient", () => {
  it("uses only the researcher profile chat-completions endpoint", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
        { status: 200 },
      ),
    );
    const client = createClient(fetchImplementation);

    await expect(client.complete(request)).resolves.toBe('{"ok":true}');

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      `https://researcher-gateway.example${researcherChatCompletionsPath}`,
    );
  });

  it("rejects a base URL that could point at a CRM or profile route", () => {
    const fetchImplementation = vi.fn<typeof fetch>();

    expect(
      () =>
        createClient(fetchImplementation, {
          gatewayBaseUrl: "https://researcher-gateway.example/v1",
        }),
    ).toThrow(HermesResearcherModelClientError);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("sends authentication and omits tools and unsupported response_format fields", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
        { status: 200 },
      ),
    );
    const client = createClient(fetchImplementation);

    await client.complete(request);

    const init = fetchImplementation.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer test-researcher-key",
      "Content-Type": "application/json",
    });
    expect(init?.body).toBeTypeOf("string");

    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "test-model",
      messages: request.messages,
      stream: false,
    });
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body).not.toHaveProperty("response_format");
  });

  it("fails with a sanitized timeout error", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const client = createClient(fetchImplementation, { timeoutMs: 1 });

    await expect(client.complete(request)).rejects.toMatchObject({
      code: "TIMEOUT",
      message: "Researcher model request failed: TIMEOUT.",
    });
  });

  it("fails with a sanitized HTTP error without reading the response body", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("sensitive upstream detail", { status: 502 }),
    );
    const client = createClient(fetchImplementation);

    await expect(client.complete(request)).rejects.toMatchObject({
      code: "HTTP_ERROR",
      message: "Researcher model request failed: HTTP_ERROR.",
    });
  });

  it("rejects a successful response without model content", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: {} }] }), {
        status: 200,
      }),
    );
    const client = createClient(fetchImplementation);

    await expect(client.complete(request)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});
