export const mcpPermissionLevels = ["READ", "SAFE_WRITE", "SENSITIVE"] as const;
export type McpPermissionLevel = (typeof mcpPermissionLevels)[number];

export const mcpToolPermissions = {
  list_leads: "READ",
  get_lead: "READ",
  get_due_followups: "READ",
  get_pipeline_summary: "READ",
  get_financial_summary: "READ",
  add_lead_note: "SAFE_WRITE",
  set_lead_status: "SAFE_WRITE",
  set_lead_followup: "SAFE_WRITE",
  add_lead_activity: "SAFE_WRITE",
  update_lead_qualification: "SAFE_WRITE",
} as const satisfies Record<string, Exclude<McpPermissionLevel, "SENSITIVE">>;

export type McpToolName = keyof typeof mcpToolPermissions;
export const exposedMcpToolNames = Object.keys(mcpToolPermissions) as McpToolName[];

export function getMcpToolPermission(toolName: McpToolName): McpPermissionLevel {
  return mcpToolPermissions[toolName];
}

export function assertMcpToolAllowed(toolName: McpToolName) {
  const permission = getMcpToolPermission(toolName);
  if (permission === "SENSITIVE") {
    throw new Error("Esta operacao nao esta disponivel para agentes.");
  }
  return permission;
}

export const prohibitedMcpOperations = [
  "delete_lead",
  "delete_project",
  "create_project",
  "cancel_project",
  "create_payment",
  "update_payment",
  "send_email",
  "send_whatsapp",
  "raw_sql",
  "shell",
] as const;
