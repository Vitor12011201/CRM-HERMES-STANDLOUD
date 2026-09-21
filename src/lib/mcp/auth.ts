const encoder = new TextEncoder();

function hasMatchingToken(candidate: string, expected: string) {
  const candidateBytes = encoder.encode(candidate);
  const expectedBytes = encoder.encode(expected);
  const length = Math.max(candidateBytes.length, expectedBytes.length);
  let difference = candidateBytes.length ^ expectedBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (candidateBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }

  return difference === 0;
}

function getBearerToken(request: Request) {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
  return match?.[1];
}

export function unauthorizedMcpResponse() {
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "WWW-Authenticate": 'Bearer realm="standloud-mcp"',
    },
  });
}

/**
 * Returns a safe 401 response unless this request carries the configured
 * bearer token. The caller must return the response before invoking MCP.
 */
export function requireMcpBearerToken(request: Request, expectedToken: string | undefined) {
  const bearerToken = getBearerToken(request);
  if (!expectedToken || !bearerToken || !hasMatchingToken(bearerToken, expectedToken)) {
    return unauthorizedMcpResponse();
  }

  return null;
}
