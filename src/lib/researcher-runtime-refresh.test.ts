import { describe, expect, it, vi } from "vitest";

import {
  shouldRefreshResearcherRuntimeAfterResearchError,
  startResearcherRuntimeRefresh,
  type BrowserResearcherRuntimeStatus,
  type ResearcherRuntimeRefreshEnvironment,
} from "./researcher-runtime-refresh";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function createEnvironment(visible = true) {
  let focusListener: (() => void) | undefined;
  let visibilityListener: (() => void) | undefined;
  let intervalListener: (() => void) | undefined;
  const clearInterval = vi.fn();
  const environment: ResearcherRuntimeRefreshEnvironment = {
    isDocumentVisible: vi.fn(() => visible),
    addWindowFocusListener: vi.fn((listener) => { focusListener = listener; }),
    removeWindowFocusListener: vi.fn(),
    addDocumentVisibilityListener: vi.fn((listener) => { visibilityListener = listener; }),
    removeDocumentVisibilityListener: vi.fn(),
    setInterval: vi.fn((listener) => {
      intervalListener = listener;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }),
    clearInterval,
  };
  return {
    environment,
    focus: () => focusListener?.(),
    visibility: () => visibilityListener?.(),
    interval: () => intervalListener?.(),
    setVisible: (next: boolean) => { visible = next; },
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("researcher runtime refresh", () => {
  it("moves OFFLINE to ONLINE without a page reload through a visible-page refresh", async () => {
    const environment = createEnvironment();
    const statuses: BrowserResearcherRuntimeStatus[] = [];
    const probe = vi.fn()
      .mockResolvedValueOnce({ kind: "STATUS", status: "OFFLINE" } as const)
      .mockResolvedValueOnce({ kind: "STATUS", status: "ONLINE" } as const);
    const controller = startResearcherRuntimeRefresh({
      probe,
      onStatus: (status) => statuses.push(status),
      onUnauthenticated: vi.fn(),
      onProbeFailure: vi.fn(),
      environment: environment.environment,
    });

    await controller.refresh();
    environment.focus();
    await flush();

    expect(statuses).toEqual(["OFFLINE", "ONLINE"]);
    controller.stop();
  });

  it("moves ONLINE to UNAVAILABLE through a periodic visible-page refresh", async () => {
    const environment = createEnvironment();
    const statuses: BrowserResearcherRuntimeStatus[] = [];
    const probe = vi.fn()
      .mockResolvedValueOnce({ kind: "STATUS", status: "ONLINE" } as const)
      .mockResolvedValueOnce({ kind: "STATUS", status: "UNAVAILABLE" } as const);
    const controller = startResearcherRuntimeRefresh({
      probe,
      onStatus: (status) => statuses.push(status),
      onUnauthenticated: vi.fn(),
      onProbeFailure: vi.fn(),
      environment: environment.environment,
    });

    await controller.refresh();
    environment.interval();
    await flush();

    expect(statuses).toEqual(["ONLINE", "UNAVAILABLE"]);
    controller.stop();
  });

  it("does not probe while hidden and removes timers and listeners on stop", async () => {
    const environment = createEnvironment(false);
    const probe = vi.fn().mockResolvedValue({ kind: "STATUS", status: "ONLINE" } as const);
    const controller = startResearcherRuntimeRefresh({
      probe,
      onStatus: vi.fn(),
      onUnauthenticated: vi.fn(),
      onProbeFailure: vi.fn(),
      environment: environment.environment,
    });

    await controller.refresh();
    environment.focus();
    environment.visibility();
    environment.interval();
    await flush();
    expect(probe).toHaveBeenCalledTimes(1);

    controller.stop();
    environment.setVisible(true);
    environment.focus();
    environment.visibility();
    environment.interval();
    await flush();

    expect(probe).toHaveBeenCalledTimes(1);
    expect(environment.environment.clearInterval).toHaveBeenCalledTimes(1);
    expect(environment.environment.removeWindowFocusListener).toHaveBeenCalledTimes(1);
    expect(environment.environment.removeDocumentVisibilityListener).toHaveBeenCalledTimes(1);
  });

  it("coalesces overlapping focus, visibility, interval, and manual refresh probes", async () => {
    const environment = createEnvironment();
    const pending = deferred<{ kind: "STATUS"; status: BrowserResearcherRuntimeStatus }>();
    const probe = vi.fn().mockReturnValue(pending.promise);
    const controller = startResearcherRuntimeRefresh({
      probe,
      onStatus: vi.fn(),
      onUnauthenticated: vi.fn(),
      onProbeFailure: vi.fn(),
      environment: environment.environment,
    });

    const first = controller.refresh();
    environment.focus();
    environment.visibility();
    environment.interval();
    const second = controller.refresh();
    expect(probe).toHaveBeenCalledTimes(1);

    pending.resolve({ kind: "STATUS", status: "ONLINE" });
    await Promise.all([first, second]);
    controller.stop();
  });

  it("marks a RESEARCHER_UNAVAILABLE response for an immediate recheck", () => {
    expect(shouldRefreshResearcherRuntimeAfterResearchError("RESEARCHER_UNAVAILABLE")).toBe(true);
    expect(shouldRefreshResearcherRuntimeAfterResearchError("RESEARCH_WORKFLOW_FAILED")).toBe(false);
  });
});
