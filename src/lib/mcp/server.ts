import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { getLeadClassification } from "@/lib/lead";
import { requireMcpBearerToken } from "./auth";
import { getSafeServiceErrorMessage, ServiceNotFoundError } from "@/lib/services/errors";
import { getDueFollowUps, getPipelineSummary } from "@/lib/services/dashboard";
import { getFinancialSummary } from "@/lib/services/finance";
import {
  addLeadActivity,
  addLeadNote,
  getLeadDetail,
  listLeads,
  setLeadFollowUp,
  setLeadStatus,
  updateLeadQualification,
} from "@/lib/services/leads";
import { runAuditedAgentWrite } from "@/lib/services/agent-audit";
import { assertMcpToolAllowed, type McpToolName } from "./policy";
import {
  addLeadActivityInputSchema,
  addLeadNoteInputSchema,
  dueFollowUpsInputSchema,
  emptyInputSchema,
  getLeadInputSchema,
  listLeadsInputSchema,
  parseMcpFollowUpDate,
  setLeadFollowUpInputSchema,
  setLeadStatusInputSchema,
  updateLeadQualificationInputSchema,
} from "./schemas";

function response(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

function errorResponse(error: unknown) {
  return {
    content: [{ type: "text" as const, text: getSafeServiceErrorMessage(error) }],
    isError: true,
  };
}

async function runReadTool<T extends Record<string, unknown>>(operation: () => Promise<T>) {
  try {
    return response(await operation());
  } catch (error) {
    return errorResponse(error);
  }
}

async function runWriteTool<T extends Record<string, unknown>>(
  toolName: McpToolName,
  operation: () => Promise<T>,
) {
  try {
    assertMcpToolAllowed(toolName);
    return response(await operation());
  } catch (error) {
    return errorResponse(error);
  }
}

export function createStandloudMcpServer() {
  const server = new McpServer({ name: "standloud-crm", version: "1.0.0" });

  server.registerTool("list_leads", {
    title: "Listar leads",
    description: "Consulta leads com filtros opcionais e limite obrigatoriamente limitado.",
    inputSchema: listLeadsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (input) => runReadTool(async () => {
    assertMcpToolAllowed("list_leads");
    const leads = await listLeads(input);
    return { leads, returned: leads.length, limit: input.limit };
  }));

  server.registerTool("get_lead", {
    title: "Consultar lead",
    description: "Retorna dados comerciais e as 20 atividades mais recentes de um unico lead.",
    inputSchema: getLeadInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ leadId }) => runReadTool(async () => {
    assertMcpToolAllowed("get_lead");
    const lead = await getLeadDetail(leadId);
    if (!lead) throw new ServiceNotFoundError("Lead");
    return { lead: { ...lead, classification: getLeadClassification(lead.qualificationScore) } };
  }));

  server.registerTool("get_due_followups", {
    title: "Consultar follow-ups",
    description: "Retorna follow-ups atrasados, de hoje e, opcionalmente, os proximos agendados.",
    inputSchema: dueFollowUpsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (input) => runReadTool(async () => {
    assertMcpToolAllowed("get_due_followups");
    return getDueFollowUps(input);
  }));

  server.registerTool("get_pipeline_summary", {
    title: "Resumo do funil",
    description: "Retorna contagens e taxas reais do funil comercial usando as regras do CRM.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => runReadTool(async () => {
    assertMcpToolAllowed("get_pipeline_summary");
    return getPipelineSummary();
  }));

  server.registerTool("get_financial_summary", {
    title: "Resumo financeiro agregado",
    description: "Retorna apenas totais financeiros agregados e a quantidade de projetos ativos.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => runReadTool(async () => {
    assertMcpToolAllowed("get_financial_summary");
    return getFinancialSummary();
  }));

  server.registerTool("add_lead_note", {
    title: "Adicionar nota ao lead",
    description: "Registra uma nota no historico de um lead.",
    inputSchema: addLeadNoteInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ leadId, note }) => runWriteTool("add_lead_note", async () => {
    const result = await runAuditedAgentWrite(
      { toolName: "add_lead_note", entityType: "Lead", entityId: leadId, action: "CREATE_NOTE" },
      () => addLeadNote(leadId, note),
    );
    return { ...result, leadId };
  }));

  server.registerTool("set_lead_status", {
    title: "Definir status do lead",
    description: "Atualiza o status comercial de um lead usando somente os status permitidos.",
    inputSchema: setLeadStatusInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ leadId, status }) => runWriteTool("set_lead_status", async () => {
    const result = await runAuditedAgentWrite(
      { toolName: "set_lead_status", entityType: "Lead", entityId: leadId, action: "SET_STATUS" },
      () => setLeadStatus(leadId, status),
    );
    return { ...result, leadId };
  }));

  server.registerTool("set_lead_followup", {
    title: "Agendar follow-up",
    description: "Define a proxima data de follow-up de um lead.",
    inputSchema: setLeadFollowUpInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ leadId, nextFollowUpAt }) => runWriteTool("set_lead_followup", async () => {
    const result = await runAuditedAgentWrite(
      { toolName: "set_lead_followup", entityType: "Lead", entityId: leadId, action: "SET_FOLLOW_UP" },
      () => setLeadFollowUp(leadId, parseMcpFollowUpDate(nextFollowUpAt)),
    );
    return { ...result, leadId };
  }));

  server.registerTool("add_lead_activity", {
    title: "Registrar atividade",
    description: "Registra uma atividade permitida no historico de um lead.",
    inputSchema: addLeadActivityInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ leadId, activityType, channel, note }) => runWriteTool("add_lead_activity", async () => {
    const result = await runAuditedAgentWrite(
      { toolName: "add_lead_activity", entityType: "Lead", entityId: leadId, action: "CREATE_ACTIVITY" },
      () => addLeadActivity(leadId, { type: activityType, channel, note }),
    );
    return { ...result, leadId };
  }));

  server.registerTool("update_lead_qualification", {
    title: "Atualizar qualificacao",
    description: "Atualiza somente a pontuacao de 0 a 10 e, opcionalmente, o principal problema. A classificacao e derivada pelo CRM.",
    inputSchema: updateLeadQualificationInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ leadId, qualificationScore, mainProblem }) => runWriteTool("update_lead_qualification", async () => {
    const result = await runAuditedAgentWrite(
      { toolName: "update_lead_qualification", entityType: "Lead", entityId: leadId, action: "UPDATE_QUALIFICATION" },
      () => updateLeadQualification(leadId, { qualificationScore, mainProblem }),
    );
    return { ...result, leadId };
  }));

  return server;
}

const mcpHandler = createMcpHandler(createStandloudMcpServer, {
  route: "/mcp",
  legacy: "stateless",
});

export function handleMcpRequest(request: Request, bearerToken: string | undefined) {
  const unauthorizedResponse = requireMcpBearerToken(request, bearerToken);
  if (unauthorizedResponse) return unauthorizedResponse;
  return mcpHandler.fetch(request);
}
