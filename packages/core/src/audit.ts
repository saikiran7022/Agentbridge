import { prisma, type Prisma } from "@hub/db";

export interface AuditInput {
  orgId: string;
  projectId?: string | null;
  requestId?: string | null;
  actor: { type: "HUMAN"; userId: string } | { type: "AGENT"; agent: string } | { type: "SYSTEM" };
  action: string;
  data?: Record<string, unknown>;
}

export async function audit(input: AuditInput): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      orgId: input.orgId,
      projectId: input.projectId ?? null,
      requestId: input.requestId ?? null,
      actorType: input.actor.type,
      actorUserId: input.actor.type === "HUMAN" ? input.actor.userId : null,
      actorAgent: input.actor.type === "AGENT" ? input.actor.agent : null,
      action: input.action,
      data: (input.data ?? {}) as Prisma.InputJsonValue,
    },
  });
}
