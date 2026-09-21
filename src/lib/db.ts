import { PrismaD1 } from "@prisma/adapter-d1";
import { env } from "cloudflare:workers";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({ adapter: new PrismaD1(env.DB) });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
