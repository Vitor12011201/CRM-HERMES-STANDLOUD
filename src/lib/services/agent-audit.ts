import { AgentActor } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { getSafeServiceErrorMessage } from "./errors";

type AuditDetails = {
  toolName: string;
  entityType: string;
  entityId: string;
  action: string;
  actorName?: string;
};

type AuditedOutcome<T> = {
  result: T;
  beforeData: Record<string, unknown>;
  afterData: Record<string, unknown>;
};

function toAuditJson(value: Record<string, unknown>) {
  return Object.keys(value).length === 0 ? null : JSON.stringify(value);
}

/**
 * Every MCP write first records an auditable attempt. D1 has no cross-query
 * transaction guarantees, so the audit record is finalized after the write.
 */
export async function runAuditedAgentWrite<T>(
  details: AuditDetails,
  operation: () => Promise<AuditedOutcome<T>>,
) {
  const audit = await db.agentAuditLog.create({
    data: {
      actor: AgentActor.AGENT,
      actorName: details.actorName ?? "MCP",
      toolName: details.toolName,
      entityType: details.entityType,
      entityId: details.entityId,
      action: details.action,
      success: false,
      errorMessage: "Operacao ainda nao concluida.",
    },
  });

  try {
    const outcome = await operation();
    await db.agentAuditLog.update({
      where: { id: audit.id },
      data: {
        beforeData: toAuditJson(outcome.beforeData),
        afterData: toAuditJson(outcome.afterData),
        success: true,
        errorMessage: null,
      },
    });
    return outcome.result;
  } catch (error) {
    await db.agentAuditLog.update({
      where: { id: audit.id },
      data: { errorMessage: getSafeServiceErrorMessage(error) },
    }).catch(() => undefined);
    throw error;
  }
}
