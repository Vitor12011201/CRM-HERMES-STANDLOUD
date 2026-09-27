import { describe, expect, it, vi } from "vitest";

import {
  getResearcherRuntimeStatus,
  isResearcherRuntimeDefinitelyUnavailable,
} from "./agent-runtime-status";

describe("researcher runtime status", () => {
  it("uses the non-generative researcher profile models endpoint with only its dedicated key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const result = await getResearcherRuntimeStatus({
      baseUrl: "https://hermes.example",
      researcherApiKey: "researcher-only-key",
    }, fetchMock);

    expect(result.technicalId).toBe("researcher");
    expect(result.status).toBe("ONLINE");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hermes.example/p/researcher/v1/models",
      expect.objectContaining({ headers: { Authorization: "Bearer researcher-only-key" } }),
    );
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty("body");
  });

  it("treats HTTP 204 as unknown because only HTTP 200 proves the researcher profile online", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    const result = await getResearcherRuntimeStatus({
      baseUrl: "https://hermes.example/",
      researcherApiKey: "researcher-only-key",
    }, fetchMock);

    expect(result.status).toBe("UNKNOWN");
  });

  it.each([
    "https://hermes.example/some-path",
    "https://hermes.example/?x=1",
    "https://hermes.example/#x",
    "not a URL",
  ])("matches the model client's gateway-origin contract for invalid base URL %s", async (baseUrl) => {
    const fetchMock = vi.fn();

    const result = await getResearcherRuntimeStatus({
      baseUrl,
      researcherApiKey: "researcher-only-key",
    }, fetchMock);

    expect(result.status).toBe("CONFIGURATION_ERROR");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([502, 503, 530])("classifies HTTP %i as operationally unavailable without reading an error body", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("edge HTML is intentionally ignored", { status }));

    const result = await getResearcherRuntimeStatus({
      baseUrl: "https://hermes.example",
      researcherApiKey: "researcher-only-key",
    }, fetchMock);

    expect(result.status).toBe("UNAVAILABLE");
    expect(isResearcherRuntimeDefinitelyUnavailable(result.status)).toBe(true);
  });

  it("classifies HTTP 429 as operationally unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ignored", { status: 429 }));

    const result = await getResearcherRuntimeStatus({
      baseUrl: "https://hermes.example",
      researcherApiKey: "researcher-only-key",
    }, fetchMock);

    expect(result.status).toBe("UNAVAILABLE");
  });

  it("returns a sanitized configuration error without making an upstream call when dedicated configuration is absent", async () => {
    const fetchMock = vi.fn();

    const result = await getResearcherRuntimeStatus({ baseUrl: "https://hermes.example" }, fetchMock);

    expect(result.status).toBe("CONFIGURATION_ERROR");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isResearcherRuntimeDefinitelyUnavailable(result.status)).toBe(true);
  });

  it("treats a network failure as operationally offline without exposing the upstream error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("socket details must not reach the browser"));

    const result = await getResearcherRuntimeStatus({
      baseUrl: "https://hermes.example",
      researcherApiKey: "researcher-only-key",
    }, fetchMock);

    expect(result.status).toBe("OFFLINE");
    expect(result).toEqual(expect.objectContaining({ technicalId: "researcher", checkedAt: expect.any(String) }));
  });

  it("treats an aborted probe as operationally offline", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("timeout", "AbortError"));

    const result = await getResearcherRuntimeStatus({
      baseUrl: "https://hermes.example",
      researcherApiKey: "researcher-only-key",
    }, fetchMock);

    expect(result.status).toBe("OFFLINE");
  });

  it.each([401, 403])("classifies HTTP %i as a dedicated researcher configuration error", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ignored", { status }));

    const result = await getResearcherRuntimeStatus({
      baseUrl: "https://hermes.example",
      researcherApiKey: "researcher-only-key",
    }, fetchMock);

    expect(result.status).toBe("CONFIGURATION_ERROR");
  });

  it("keeps non-auth 4xx responses unknown instead of claiming the runtime is offline", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ignored", { status: 404 }));

    const result = await getResearcherRuntimeStatus({
      baseUrl: "https://hermes.example",
      researcherApiKey: "researcher-only-key",
    }, fetchMock);

    expect(result.status).toBe("UNKNOWN");
    expect(isResearcherRuntimeDefinitelyUnavailable(result.status)).toBe(false);
  });
});
