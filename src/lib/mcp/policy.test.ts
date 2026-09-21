import { describe, expect, it } from "vitest";
import { exposedMcpToolNames, mcpToolPermissions, prohibitedMcpOperations } from "./policy";

describe("MCP permission policy", () => {
  it("only exposes READ and SAFE_WRITE tools", () => {
    expect(Object.values(mcpToolPermissions)).not.toContain("SENSITIVE");
    expect(exposedMcpToolNames).toHaveLength(10);
  });

  it("does not expose destructive, financial, outbound, or raw-access operations", () => {
    for (const operation of prohibitedMcpOperations) {
      expect(exposedMcpToolNames).not.toContain(operation);
    }
  });
});
