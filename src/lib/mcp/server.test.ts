import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listLeads: vi.fn(),
  getLeadDetail: vi.fn(),
  addLeadNote: vi.fn(),
  setLeadStatus: vi.fn(),
  setLeadFollowUp: vi.fn(),
  addLeadActivity: vi.fn(),
  updateLeadQualification: vi.fn(),
  getDueFollowUps: vi.fn(),
  getPipelineSummary: vi.fn(),
  getFinancialSummary: vi.fn(),
  runAuditedAgentWrite: vi.fn(),
  auditDatabase: {},
}));

vi.mock("@/lib/services/leads", () => ({
  listLeads: mocks.listLeads,
  getLeadDetail: mocks.getLeadDetail,
  addLeadNote: mocks.addLeadNote,
  setLeadStatus: mocks.setLeadStatus,
  setLeadFollowUp: mocks.setLeadFollowUp,
  addLeadActivity: mocks.addLeadActivity,
  updateLeadQualification: mocks.updateLeadQualification,
}));
vi.mock("@/lib/services/dashboard", () => ({
  getDueFollowUps: mocks.getDueFollowUps,
  getPipelineSummary: mocks.getPipelineSummary,
}));
vi.mock("@/lib/services/finance", () => ({ getFinancialSummary: mocks.getFinancialSummary }));
vi.mock("@/lib/services/agent-audit", () => ({ runAuditedAgentWrite: mocks.runAuditedAgentWrite }));

import { createStandloudMcpServer } from "./server";

const leadId = "claaaaaaaaaaaaaaaaaaaaaaa";

async function createClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createStandloudMcpServer();
  const client = new Client({ name: "standloud-mcp-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function toolText(result: { content: Array<{ type: string; text?: string }> }) {
  const first = result.content[0];
  if (!first || first.type !== "text" || !first.text) throw new Error("Expected text content.");
  return first.text;
}

describe("STANDLOUD MCP server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runAuditedAgentWrite.mockImplementation(async (_details, operation) => (await operation(mocks.auditDatabase)).result);
    mocks.listLeads.mockResolvedValue([{ id: leadId, companyName: "Lead de teste", classification: "A" }]);
    mocks.getLeadDetail.mockResolvedValue(null);
    mocks.getDueFollowUps.mockResolvedValue({ overdue: [], today: [], upcoming: [] });
    mocks.getPipelineSummary.mockResolvedValue({ totalLeads: 0 });
    mocks.getFinancialSummary.mockResolvedValue({ contractedCents: 0, receivedCents: 0, outstandingCents: 0, activeProjectCount: 0 });
  });

  it("allows discovery and bounded lead listing", async () => {
    const { client } = await createClient();
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("list_leads");
    expect(tools.tools.map((tool) => tool.name)).not.toContain("create_payment");

    const result = await client.callTool({ name: "list_leads", arguments: { classification: "A", limit: 5 } });
    expect(JSON.parse(toolText(result))).toMatchObject({ returned: 1, limit: 5 });
    expect(mocks.listLeads).toHaveBeenCalledWith(expect.objectContaining({ classification: "A", limit: 5 }));
    await client.close();
  });

  it("returns a controlled error for a nonexistent lead", async () => {
    const { client } = await createClient();
    const result = await client.callTool({ name: "get_lead", arguments: { leadId } });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toBe("Lead nao encontrado.");
    await client.close();
  });

  it("returns bounded factual evidence and separate analysis through the read-only get_lead tool", async () => {
    mocks.getLeadDetail.mockResolvedValue({
      id: leadId,
      companyName: "Lead de teste",
      qualificationScore: 8,
      status: "CONTACTED",
      activities: [{ id: "activity-1", type: "NOTE", note: "Atividade recente" }],
      research: {
        evidences: [{
          id: "evidence-1",
          sourceType: "WEBSITE",
          sourceUrl: "https://empresa.example",
          observation: "O site apresenta formulario.",
          observedAt: "2026-09-21T15:00:00.000Z",
          capturedBy: "USER",
        }],
        analysis: {
          summary: "A oportunidade parece consistente.",
          opportunity: "Uma landing page pode reduzir atrito.",
          commercialSignals: null,
          demoConcept: null,
          confidence: "MEDIUM",
          updatedBy: "USER",
          updatedAt: "2026-09-21T16:00:00.000Z",
        },
        evidenceTotal: 1,
        evidenceReturned: 1,
        evidenceTruncated: false,
      },
    });
    const { client } = await createClient();

    const tools = await client.listTools();
    const getLeadTool = tools.tools.find((tool) => tool.name === "get_lead");
    const result = await client.callTool({ name: "get_lead", arguments: { leadId } });
    const payload = JSON.parse(toolText(result));

    expect(getLeadTool?.description).toContain("pesquisa estruturada");
    expect(getLeadTool?.description).toContain("observacoes de pesquisa registradas");
    expect(getLeadTool?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(payload.lead).toMatchObject({
      classification: "A",
      activities: [{ id: "activity-1" }],
      research: {
        evidences: [expect.objectContaining({ sourceType: "WEBSITE", observation: "O site apresenta formulario." })],
        analysis: expect.objectContaining({ confidence: "MEDIUM" }),
        evidenceTotal: 1,
        evidenceReturned: 1,
        evidenceTruncated: false,
      },
    });
    expect(mocks.getLeadDetail).toHaveBeenCalledWith(leadId);
    expect(mocks.runAuditedAgentWrite).not.toHaveBeenCalled();
    await client.close();
  });

  it("executes safe writes through auditing and permitted services", async () => {
    mocks.setLeadStatus.mockResolvedValue({ result: { status: "CONTACTED", changed: true }, beforeData: { status: "NEW" }, afterData: { status: "CONTACTED" } });
    mocks.updateLeadQualification.mockResolvedValue({ result: { qualificationScore: 10, classification: "A", mainProblem: null, changed: true }, beforeData: { qualificationScore: 5 }, afterData: { qualificationScore: 10 } });
    mocks.setLeadFollowUp.mockResolvedValue({ result: { nextFollowUpAt: new Date("2026-09-21T00:00:00.000Z"), changed: true }, beforeData: {}, afterData: {} });
    mocks.addLeadNote.mockResolvedValue({ result: { activity: { id: "activity-1" } }, beforeData: {}, afterData: { activityId: "activity-1" } });
    const { client } = await createClient();

    await client.callTool({ name: "set_lead_status", arguments: { leadId, status: "CONTACTED" } });
    await client.callTool({ name: "update_lead_qualification", arguments: { leadId, qualificationScore: 10 } });
    await client.callTool({ name: "set_lead_followup", arguments: { leadId, nextFollowUpAt: "2026-09-21" } });
    await client.callTool({ name: "add_lead_note", arguments: { leadId, note: "Nota de teste" } });

    expect(mocks.setLeadStatus).toHaveBeenCalledWith(leadId, "CONTACTED", mocks.auditDatabase);
    expect(mocks.updateLeadQualification).toHaveBeenCalledWith(leadId, { qualificationScore: 10, mainProblem: undefined }, mocks.auditDatabase);
    expect(mocks.setLeadFollowUp).toHaveBeenCalledWith(leadId, new Date("2026-09-21T00:00:00.000Z"), mocks.auditDatabase);
    expect(mocks.addLeadNote).toHaveBeenCalledWith(leadId, "Nota de teste", mocks.auditDatabase);
    expect(mocks.runAuditedAgentWrite).toHaveBeenCalledTimes(4);
    await client.close();
  });
});
