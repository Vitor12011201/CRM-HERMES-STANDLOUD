import { PrismaD1 } from "@prisma/adapter-d1";
import { env } from "cloudflare:workers";
import { PrismaClient } from "@/generated/prisma/client";

export type DbClient = PrismaClient;

/**
 * Creates a Prisma/D1 client for the current request or operation invocation.
 * Cloudflare Workers can reuse an isolate after its request context has ended,
 * so this module must not cache a PrismaClient or PrismaD1 in module/global
 * scope. Callers that make multiple related queries pass this instance through
 * their internal helpers rather than constructing another client mid-operation.
 */
export function getDb(): DbClient {
  return new PrismaClient({ adapter: new PrismaD1(env.DB) });
}
