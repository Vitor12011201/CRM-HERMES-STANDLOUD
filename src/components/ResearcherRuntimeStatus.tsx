"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  startResearcherRuntimeRefresh,
  type BrowserResearcherRuntimeStatus,
  type ResearcherRuntimeRefreshController,
  type ResearcherRuntimeRefreshEnvironment,
} from "@/lib/researcher-runtime-refresh";

export type ResearcherRuntimeStatusValue = BrowserResearcherRuntimeStatus;

type RuntimeResponse = {
  technicalId?: string;
  status?: ResearcherRuntimeStatusValue;
};

export function isResearcherRuntimeOffline(status: ResearcherRuntimeStatusValue) {
  return status === "OFFLINE" || status === "UNAVAILABLE" || status === "CONFIGURATION_ERROR";
}

export function researcherRuntimeMessage(status: ResearcherRuntimeStatusValue) {
  switch (status) {
    case "ONLINE":
      return "Ana está online.";
    case "OFFLINE":
      return "O runtime local da Ana está offline. Seus dados existentes do CRM permanecem intactos.";
    case "UNAVAILABLE":
      return "O runtime da Ana está temporariamente indisponível. Seus dados existentes do CRM permanecem intactos.";
    case "CONFIGURATION_ERROR":
      return "O runtime da Ana não está configurado corretamente. Seus dados existentes do CRM permanecem intactos.";
    default:
      return "Não foi possível confirmar o estado da Ana.";
  }
}

export function useResearcherRuntimeStatus() {
  const router = useRouter();
  const [status, setStatus] = useState<ResearcherRuntimeStatusValue>("UNKNOWN");
  const controllerRef = useRef<ResearcherRuntimeRefreshController | null>(null);

  const refresh = useCallback(async () => {
    await controllerRef.current?.refresh();
  }, []);

  useEffect(() => {
    const environment: ResearcherRuntimeRefreshEnvironment = {
      isDocumentVisible: () => document.visibilityState === "visible",
      addWindowFocusListener: (listener) => window.addEventListener("focus", listener),
      removeWindowFocusListener: (listener) => window.removeEventListener("focus", listener),
      addDocumentVisibilityListener: (listener) => document.addEventListener("visibilitychange", listener),
      removeDocumentVisibilityListener: (listener) => document.removeEventListener("visibilitychange", listener),
      setInterval: (listener, milliseconds) => setInterval(listener, milliseconds),
      clearInterval: (handle) => clearInterval(handle),
    };
    const controller = startResearcherRuntimeRefresh({
      environment,
      probe: async (signal) => {
        try {
          const response = await fetch("/api/agents/researcher/runtime", { cache: "no-store", signal });
          if (response.status === 401) return { kind: "UNAUTHENTICATED" } as const;
          const payload = await response.json().catch(() => null) as RuntimeResponse | null;
          if (!response.ok || payload?.technicalId !== "researcher" || !isRuntimeStatus(payload.status)) {
            return { kind: "STATUS", status: "UNKNOWN" } as const;
          }
          return { kind: "STATUS", status: payload.status } as const;
        } catch {
          // A browser-to-CRM failure is not proof that Hermes is offline.
          return { kind: "STATUS", status: "UNKNOWN" } as const;
        }
      },
      onStatus: setStatus,
      onUnauthenticated: () => router.replace("/login"),
      onProbeFailure: () => setStatus("UNKNOWN"),
    });
    controllerRef.current = controller;

    return () => {
      controller.stop();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [router]);

  return { status, refresh };
}

export function ResearcherRuntimeStatus() {
  const { status } = useResearcherRuntimeStatus();
  const tone = status === "ONLINE"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : isResearcherRuntimeOffline(status)
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-slate-200 bg-slate-50 text-slate-700";

  return <p aria-live="polite" className={`mt-4 rounded-lg border px-3 py-2 text-sm ${tone}`}>Runtime: {researcherRuntimeMessage(status)}</p>;
}

function isRuntimeStatus(value: unknown): value is ResearcherRuntimeStatusValue {
  return value === "ONLINE" || value === "OFFLINE" || value === "UNAVAILABLE" || value === "UNKNOWN" || value === "CONFIGURATION_ERROR";
}
