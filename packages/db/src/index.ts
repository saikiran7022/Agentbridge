import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __hubPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__hubPrisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === "query" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__hubPrisma = prisma;
}
