export const researcherRuntimeStatuses = [
  "ONLINE",
  "OFFLINE",
  "UNAVAILABLE",
  "UNKNOWN",
  "CONFIGURATION_ERROR",
] as const;

export type ResearcherRuntimeStatus = (typeof researcherRuntimeStatuses)[number];

export type ResearcherRuntimeAvailability = {
  technicalId: "researcher";
  status: ResearcherRuntimeStatus;
  checkedAt: string;
};

export type ResearcherRuntimeConfiguration = {
  baseUrl?: string;
  researcherApiKey?: string;
};

type FetchLike = typeof fetch;

const availabilityTimeoutMs = 3_000;

function createAbortSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function runtimeResult(status: ResearcherRuntimeStatus): ResearcherRuntimeAvailability {
  return {
    technicalId: "researcher",
    status,
    checkedAt: new Date().toISOString(),
  };
}

/** Logs only a sanitized operational category; neither endpoint nor credentials are included. */
function logRuntimeDiagnostic(
  code: "UNCONFIGURED" | "CONFIG_INVALID" | "UNREACHABLE" | "TIMEOUT" | "AUTH_FAILED" | "UNAVAILABLE" | "PROFILE_UNVERIFIED",
  details: { durationMs?: number; status?: number; baseUrlPresent?: boolean; researcherKeyPresent?: boolean } = {},
) {
  const duration = details.durationMs === undefined ? "" : ` duration_ms=${details.durationMs}`;
  const status = details.status === undefined ? "" : ` status=${details.status}`;
  const baseUrl = details.baseUrlPresent === undefined ? "" : ` base_url_present=${details.baseUrlPresent}`;
  const researcherKey = details.researcherKeyPresent === undefined ? "" : ` researcher_key_present=${details.researcherKeyPresent}`;
  console.warn(`researcher.runtime code=${code}${status}${duration}${baseUrl}${researcherKey}`);
}

/**
 * Hermes v0.21.3 exposes the non-generative profile-scoped models endpoint.
 * A 200 from this endpoint proves that the configured researcher profile is
 * reachable and accepts its dedicated credential without making a model call.
 */
function researcherModelsEndpoint(baseUrl: string) {
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new Error("invalid Hermes protocol");
  }

  const parsed = new URL(baseUrl);
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !parsed.host ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("invalid Hermes gateway origin");
  }

  return new URL("/p/researcher/v1/models", parsed.origin).toString();
}

export function isResearcherRuntimeDefinitelyUnavailable(status: ResearcherRuntimeStatus) {
  return status === "OFFLINE" || status === "UNAVAILABLE" || status === "CONFIGURATION_ERROR";
}

export async function getResearcherRuntimeStatus(
  configuration: ResearcherRuntimeConfiguration,
  fetchImpl: FetchLike = fetch,
): Promise<ResearcherRuntimeAvailability> {
  if (!configuration.baseUrl || !configuration.researcherApiKey) {
    logRuntimeDiagnostic("UNCONFIGURED", {
      baseUrlPresent: Boolean(configuration.baseUrl),
      researcherKeyPresent: Boolean(configuration.researcherApiKey),
    });
    return runtimeResult("CONFIGURATION_ERROR");
  }

  let endpoint: string;
  try {
    endpoint = researcherModelsEndpoint(configuration.baseUrl);
  } catch {
    logRuntimeDiagnostic("CONFIG_INVALID", {
      baseUrlPresent: true,
      researcherKeyPresent: true,
    });
    return runtimeResult("CONFIGURATION_ERROR");
  }

  const abort = createAbortSignal(availabilityTimeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetchImpl(endpoint, {
      headers: { Authorization: `Bearer ${configuration.researcherApiKey}` },
      signal: abort.signal,
    });
    if (response.status === 200) return runtimeResult("ONLINE");

    const durationMs = Date.now() - startedAt;
    if (response.status === 401 || response.status === 403) {
      logRuntimeDiagnostic("AUTH_FAILED", { status: response.status, durationMs });
      return runtimeResult("CONFIGURATION_ERROR");
    }

    // An edge, Named Tunnel, or origin failure can still arrive as HTTP. These
    // statuses are operationally unavailable even though fetch resolved.
    if (response.status === 429 || response.status >= 500) {
      logRuntimeDiagnostic("UNAVAILABLE", { status: response.status, durationMs });
      return runtimeResult("UNAVAILABLE");
    }

    // The gateway answered, but this non-generative profile probe could not
    // prove the profile operational or unavailable. Do not present it as offline.
    logRuntimeDiagnostic("PROFILE_UNVERIFIED", { status: response.status, durationMs });
    return runtimeResult("UNKNOWN");
  } catch (error) {
    logRuntimeDiagnostic(isAbortError(error) ? "TIMEOUT" : "UNREACHABLE", {
      durationMs: Date.now() - startedAt,
    });
    return runtimeResult("OFFLINE");
  } finally {
    abort.clear();
  }
}
