import { createHash, randomBytes } from "node:crypto";
import { prisma, type User } from "@hub/db";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createApiToken(userId: string, name: string): Promise<{ token: string; id: string }> {
  const token = `hub_${randomBytes(32).toString("base64url")}`;
  const row = await prisma.apiToken.create({
    data: { userId, name: name.slice(0, 100) || "token", prefix: token.slice(0, 12), tokenHash: hashToken(token) },
  });
  return { token, id: row.id };
}

export async function verifyApiToken(token: string | null | undefined): Promise<User | null> {
  if (!token || !token.startsWith("hub_")) return null;
  const row = await prisma.apiToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!row || row.revokedAt) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  }
  return row.user;
}

export async function revokeApiToken(userId: string, tokenId: string): Promise<void> {
  await prisma.apiToken.updateMany({ where: { id: tokenId, userId }, data: { revokedAt: new Date() } });
}
