export type BrowserResearcherRuntimeStatus = "ONLINE" | "OFFLINE" | "UNAVAILABLE" | "UNKNOWN" | "CONFIGURATION_ERROR";

export type ResearcherRuntimeProbeResult =
  | { kind: "STATUS"; status: BrowserResearcherRuntimeStatus }
  | { kind: "UNAUTHENTICATED" };

export type ResearcherRuntimeRefreshEnvironment = {
  isDocumentVisible(): boolean;
  addWindowFocusListener(listener: () => void): void;
  removeWindowFocusListener(listener: () => void): void;
  addDocumentVisibilityListener(listener: () => void): void;
  removeDocumentVisibilityListener(listener: () => void): void;
  setInterval(listener: () => void, milliseconds: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
};

export type ResearcherRuntimeRefreshController = {
  refresh(): Promise<void>;
  stop(): void;
};

export const researcherRuntimeRefreshIntervalMs = 20_000;

/** This maps the start-route's sanitized error to an immediate client-side recheck. */
export function shouldRefreshResearcherRuntimeAfterResearchError(errorCode: string) {
  return errorCode === "RESEARCHER_UNAVAILABLE";
}

/**
 * Starts an initial runtime probe, then performs moderate visible-page rechecks.
 * A single in-flight promise is shared by interval, focus, visibility, and manual refresh.
 */
export function startResearcherRuntimeRefresh(
  options: {
    probe(signal: AbortSignal): Promise<ResearcherRuntimeProbeResult>;
    onStatus(status: BrowserResearcherRuntimeStatus): void;
    onUnauthenticated(): void;
    onProbeFailure(): void;
    environment: ResearcherRuntimeRefreshEnvironment;
    intervalMs?: number;
  },
): ResearcherRuntimeRefreshController {
  let stopped = false;
  let activeProbe: Promise<void> | null = null;
  let abortController: AbortController | null = null;

  const refresh = async () => {
    if (stopped) return;
    if (activeProbe) return activeProbe;

    abortController = new AbortController();
    activeProbe = (async () => {
      try {
        const result = await options.probe(abortController?.signal ?? new AbortController().signal);
        if (stopped) return;
        if (result.kind === "UNAUTHENTICATED") {
          options.onUnauthenticated();
          return;
        }
        options.onStatus(result.status);
      } catch {
        if (!stopped) options.onProbeFailure();
      } finally {
        activeProbe = null;
        abortController = null;
      }
    })();

    return activeProbe;
  };

  const refreshWhenVisible = () => {
    if (options.environment.isDocumentVisible()) void refresh();
  };

  const interval = options.environment.setInterval(
    refreshWhenVisible,
    options.intervalMs ?? researcherRuntimeRefreshIntervalMs,
  );
  options.environment.addWindowFocusListener(refreshWhenVisible);
  options.environment.addDocumentVisibilityListener(refreshWhenVisible);
  void refresh();

  return {
    refresh,
    stop() {
      if (stopped) return;
      stopped = true;
      abortController?.abort();
      options.environment.clearInterval(interval);
      options.environment.removeWindowFocusListener(refreshWhenVisible);
      options.environment.removeDocumentVisibilityListener(refreshWhenVisible);
    },
  };
}
