import type {
  ResearcherModelClient,
  ResearcherModelRequest,
} from "./dry-run";

export const researcherChatCompletionsPath =
  "/p/researcher/v1/chat/completions";

const defaultTimeoutMs = 30_000;

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type HermesResearcherModelClientErrorCode =
  | "INVALID_CONFIGURATION"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE";

export class HermesResearcherModelClientError extends Error {
  constructor(public readonly code: HermesResearcherModelClientErrorCode) {
    super(`Researcher model request failed: ${code}.`);
    this.name = "HermesResearcherModelClientError";
  }
}

export type HermesResearcherModelClientOptions = {
  /** The Hermes gateway origin only, for example http://127.0.0.1:8642. */
  gatewayBaseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImplementation?: FetchImplementation;
};

type ChatCompletionsResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

function invalidConfiguration(): never {
  throw new HermesResearcherModelClientError("INVALID_CONFIGURATION");
}

function getResearcherEndpoint(gatewayBaseUrl: string): string {
  if (typeof gatewayBaseUrl !== "string" || gatewayBaseUrl.trim() === "") {
    return invalidConfiguration();
  }

  let parsed: URL;

  try {
    parsed = new URL(gatewayBaseUrl);
  } catch {
    return invalidConfiguration();
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !parsed.host ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    return invalidConfiguration();
  }

  return new URL(researcherChatCompletionsPath, parsed.origin).toString();
}

function requireNonEmptyConfigurationValue(value: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    invalidConfiguration();
  }
}

/**
 * OpenAI-compatible client for the dedicated, zero-tool Hermes researcher
 * profile. The endpoint is fixed here so this client can never fall back to
 * the CRM Assistant route (/v1/chat/completions). Hermes v0.21.3 does not
 * parse or forward response_format on this route, so JSON compliance remains
 * an explicit prompt contract plus strict local validation.
 */
export class HermesResearcherModelClient implements ResearcherModelClient {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: HermesResearcherModelClientOptions) {
    requireNonEmptyConfigurationValue(options.apiKey);
    requireNonEmptyConfigurationValue(options.model);

    if (
      options.timeoutMs !== undefined &&
      (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
    ) {
      invalidConfiguration();
    }

    this.apiKey = options.apiKey;
    this.endpoint = getResearcherEndpoint(options.gatewayBaseUrl);
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  }

  async complete(request: ResearcherModelRequest): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let response: Response;

      try {
        response = await this.fetchImplementation(this.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            messages: request.messages,
            stream: false,
          }),
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) {
          throw new HermesResearcherModelClientError("TIMEOUT");
        }

        throw new HermesResearcherModelClientError("NETWORK_ERROR");
      }

      if (!response.ok) {
        throw new HermesResearcherModelClientError("HTTP_ERROR");
      }

      let body: ChatCompletionsResponse;

      try {
        body = (await response.json()) as ChatCompletionsResponse;
      } catch {
        throw new HermesResearcherModelClientError("INVALID_RESPONSE");
      }

      const content = body.choices?.[0]?.message?.content;

      if (typeof content !== "string" || content.trim() === "") {
        throw new HermesResearcherModelClientError("INVALID_RESPONSE");
      }

      return content;
    } finally {
      clearTimeout(timeout);
    }
  }
}
