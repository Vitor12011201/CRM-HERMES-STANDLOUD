import { env } from "cloudflare:workers";
import { handleMcpRequest } from "@/lib/mcp/server";

type McpSecretEnv = {
  STANDLOUD_MCP_TOKEN?: string;
};

function handleAuthorizedMcpRequest(request: Request) {
  const bearerToken = (env as typeof env & McpSecretEnv).STANDLOUD_MCP_TOKEN;
  return handleMcpRequest(request, bearerToken);
}

export async function GET(request: Request) {
  return handleAuthorizedMcpRequest(request);
}

export async function POST(request: Request) {
  return handleAuthorizedMcpRequest(request);
}

export async function OPTIONS(request: Request) {
  return handleAuthorizedMcpRequest(request);
}
