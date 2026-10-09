import { prisma, type JoinStatus } from "@hub/db";
import { audit } from "./audit.js";
import { badRequest, forbidden, notFound } from "./errors.js";

/*
 * Access model
 *  - Org admin: the only role that creates, edits or deletes teams, decides join requests and
 *    puts people on teams directly.
 *  - Team member: anyone an admin approved (or added) to a team. They may be added to projects
 *    on behalf of that team, and only for teams they belong to.
 *  - Project roles (OWNER / APPROVER / CONTRIBUTOR / VIEWER) decide what they can do inside a project.
 */

export async function isOrgAdmin(orgId: string, userId: string): Promise<boolean> {
  const m = await prisma.orgMember.findUnique({ where: { orgId_userId: { orgId, userId } } });
  return m?.role === "ADMIN";
}

export async function assertOrgAdmin(orgId: string, userId: string): Promise<void> {
  if (!(await isOrgAdmin(orgId, userId))) throw forbidden("Only organization admins can do that");
}

export async function isTeamMember(userId: string, departmentId: string): Promise<boolean> {
  return (await prisma.teamMember.count({ where: { userId, departmentId } })) > 0;
}

export async function userTeamIds(userId: string): Promise<string[]> {
  return (await prisma.teamMember.findMany({ where: { userId }, select: { departmentId: true } })).map((t) => t.departmentId);
}

/** Puts a person on a team (admin action). Resolves any pending request they had for it. */
export async function addTeamMember(input: { orgId: string; departmentId: string; userId: string; actorId: string }): Promise<void> {
  await assertOrgAdmin(input.orgId, input.actorId);
  await attachToTeam(input.orgId, input.departmentId, input.userId, input.actorId, "Added by an admin");
}

async function attachToTeam(orgId: string, departmentId: string, userId: string, actorId: string, note: string): Promise<void> {
  const dept = await prisma.department.findFirst({ where: { id: departmentId, orgId } });
  if (!dept) throw notFound("Team");
  await prisma.$transaction([
    prisma.teamMember.upsert({ where: { departmentId_userId: { departmentId, userId } }, update: {}, create: { departmentId, userId } }),
    prisma.orgMember.updateMany({ where: { orgId, userId, departmentId: null }, data: { departmentId } }),
    prisma.teamJoinRequest.updateMany({
      where: { orgId, departmentId, userId, status: "PENDING" },
      data: { status: "APPROVED", decidedById: actorId, decidedAt: new Date(), decisionNote: note },
    }),
  ]);
}

/** Removes a person from a team unless they still hold project seats for it. */
export async function removeTeamMember(input: { orgId: string; departmentId: string; userId: string; actorId: string }): Promise<void> {
  await assertOrgAdmin(input.orgId, input.actorId);
  const seats = await prisma.projectMember.count({ where: { userId: input.userId, departmentId: input.departmentId } });
  if (seats) throw badRequest("They hold seats on projects for this team. Remove them from those projects first.");
  await prisma.teamMember.deleteMany({ where: { userId: input.userId, departmentId: input.departmentId } });
  const home = await prisma.orgMember.findUnique({ where: { orgId_userId: { orgId: input.orgId, userId: input.userId } } });
  if (home?.departmentId === input.departmentId) {
    const next = await prisma.teamMember.findFirst({ where: { userId: input.userId }, orderBy: { createdAt: "asc" } });
    await prisma.orgMember.update({ where: { id: home.id }, data: { departmentId: next?.departmentId ?? null } });
  }
  await audit({ orgId: input.orgId, actor: { type: "HUMAN", userId: input.actorId }, action: "team.member_removed", data: { departmentId: input.departmentId, userId: input.userId } });
}

export async function requestToJoin(input: { orgId: string; userId: string; departmentId: string; message?: string }) {
  const dept = await prisma.department.findFirst({ where: { id: input.departmentId, orgId: input.orgId } });
  if (!dept) throw notFound("Team");
  if (await isTeamMember(input.userId, input.departmentId)) throw badRequest(`You are already in ${dept.name}`);
  const pending = await prisma.teamJoinRequest.findFirst({ where: { userId: input.userId, departmentId: input.departmentId, status: "PENDING" } });
  if (pending) throw badRequest(`You already asked to join ${dept.name}. An admin will review it.`);
  const req = await prisma.teamJoinRequest.create({
    data: { orgId: input.orgId, userId: input.userId, departmentId: input.departmentId, message: (input.message ?? "").trim().slice(0, 500) },
  });
  await audit({ orgId: input.orgId, actor: { type: "HUMAN", userId: input.userId }, action: "team.join_requested", data: { departmentId: input.departmentId, requestId: req.id } });
  return req;
}

export async function cancelJoinRequest(input: { userId: string; requestId: string }): Promise<void> {
  const res = await prisma.teamJoinRequest.updateMany({
    where: { id: input.requestId, userId: input.userId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date() },
  });
  if (!res.count) throw notFound("Pending request");
}

/** Approve or reject a join request. Only org admins may decide. */
export async function decideJoinRequest(input: { orgId: string; requestId: string; actorId: string; approve: boolean; note?: string }) {
  await assertOrgAdmin(input.orgId, input.actorId);
  const req = await prisma.teamJoinRequest.findFirst({ where: { id: input.requestId, orgId: input.orgId } });
  if (!req) throw notFound("Join request");
  if (req.status !== "PENDING") throw badRequest("That request was already decided");
  const note = (input.note ?? "").trim().slice(0, 500);
  if (input.approve) {
    await attachToTeam(input.orgId, req.departmentId, req.userId, input.actorId, note);
    if (note) await prisma.teamJoinRequest.update({ where: { id: req.id }, data: { decisionNote: note } });
  } else {
    await prisma.teamJoinRequest.update({
      where: { id: req.id },
      data: { status: "REJECTED" satisfies JoinStatus, decidedById: input.actorId, decidedAt: new Date(), decisionNote: note },
    });
  }
  await audit({
    orgId: input.orgId,
    actor: { type: "HUMAN", userId: input.actorId },
    action: input.approve ? "team.join_approved" : "team.join_rejected",
    data: { requestId: req.id, userId: req.userId, departmentId: req.departmentId },
  });
}

/**
 * Project owners may only seat people on behalf of teams those people belong to. Org admins can
 * seat anyone, which also puts the person on that team.
 */
export async function authorizeProjectSeat(input: { orgId: string; actorId: string; userId: string; departmentId: string }): Promise<void> {
  if (await isOrgAdmin(input.orgId, input.actorId)) {
    await attachToTeam(input.orgId, input.departmentId, input.userId, input.actorId, "Added with a project seat");
    return;
  }
  if (!(await isTeamMember(input.userId, input.departmentId))) {
    const [user, dept] = await Promise.all([
      prisma.user.findUnique({ where: { id: input.userId } }),
      prisma.department.findUnique({ where: { id: input.departmentId } }),
    ]);
    throw forbidden(`${user?.login ?? "That person"} isn't on the ${dept?.name ?? "selected"} team yet. They can request to join it, and an org admin approves.`);
  }
}

export async function pendingJoinRequestCount(orgId: string): Promise<number> {
  return prisma.teamJoinRequest.count({ where: { orgId, status: "PENDING" } });
}
