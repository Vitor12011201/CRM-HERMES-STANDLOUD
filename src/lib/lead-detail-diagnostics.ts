export const leadDetailDiagnosticStages = [
  "LEAD_DETAIL_START",
  "SESSION_START",
  "SESSION_OK",
  "PARAMS_START",
  "PARAMS_OK",
  "LEAD_QUERY_START",
  "LEAD_QUERY_OK",
  "CLASSIFICATION_START",
  "CLASSIFICATION_OK",
  "RENDER_READY",
] as const;

export type LeadDetailDiagnosticStage = typeof leadDetailDiagnosticStages[number];

export type LeadDetailDiagnosticEvent = {
  correlationId: string;
  stage: LeadDetailDiagnosticStage;
  elapsedMs: number;
  leadId?: string;
};

type LeadDetailDiagnosticOptions = {
  correlationId?: string;
  now?: () => number;
  emit?: (event: LeadDetailDiagnosticEvent) => void;
};

/**
 * Temporary, payload-free observability for isolating a Lead detail request
 * that the Workers runtime reports as hung. It never logs session or Lead data.
 */
export function createLeadDetailDiagnostics(options: LeadDetailDiagnosticOptions = {}) {
  const now = options.now ?? Date.now;
  const correlationId = options.correlationId ?? crypto.randomUUID();
  const startedAt = now();
  const emit = options.emit ?? ((event: LeadDetailDiagnosticEvent) => {
    console.warn(JSON.stringify(event));
  });

  return {
    correlationId,
    log(stage: LeadDetailDiagnosticStage, leadId?: string) {
      emit({
        correlationId,
        stage,
        elapsedMs: Math.max(0, now() - startedAt),
        ...(leadId === undefined ? {} : { leadId }),
      });
    },
  };
}
