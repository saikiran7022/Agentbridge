"use server";

import { addTeamMember, audit, authorizeProjectSeat, badRequest, decideJoinRequest, removeTeamMember } from "@hub/core";
import { prisma } from "@hub/db";
import { act, optStr, slugify, str } from "@/lib/form";
import { requireAdmin } from "@/lib/session";

const ROLES = ["OWNER", "APPROVER", "CONTRIBUTOR", "VIEWER"] as const;
const BACK = "/manage";

export async function saveTeam(fd: FormData) {
  return act(BACK, async () => {
    const { org, user } = await requireAdmin();
    const id = str(fd, "id");
    const name = str(fd, "name");
    if (!name) throw badRequest("Give the team a name");
    const data = { name, description: str(fd, "description") };
    if (id) await prisma.department.update({ where: { id, orgId: org.id }, data });
    else await prisma.department.create({ data: { ...data, key: slugify(str(fd, "key") || name), orgId: org.id } });
    await audit({ orgId: org.id, actor: { type: "HUMAN", userId: user.id }, action: id ? "department.updated" : "department.created", data });
    return id ? `Saved ${name}` : `Created team ${name}`;
  });
}

export async function deleteTeam(fd: FormData) {
  return act(BACK, async () => {
    const { org } = await requireAdmin();
    const id = str(fd, "id");
    const used = (await prisma.projectMember.count({ where: { departmentId: id } })) + (await prisma.liaisonAgent.count({ where: { departmentId: id } }));
    if (used) throw badRequest("This team is on projects. Remove its people and agents from them first.");
    await prisma.department.delete({ where: { id, orgId: org.id } });
    return "Team deleted";
  });
}

export async function addPerson(fd: FormData) {
  return act(BACK, async () => {
    const { org, user: actor } = await requireAdmin();
    const login = str(fd, "login").toLowerCase().replace(/^@/, "");
    if (!/^[a-z0-9][a-z0-9-]{0,38}$/.test(login)) throw badRequest("Enter a valid GitHub login");
    const user = await prisma.user.upsert({ where: { login }, update: {}, create: { login, name: optStr(fd, "name") } });
    await prisma.orgMember.upsert({
      where: { orgId_userId: { orgId: org.id, userId: user.id } },
      update: {},
      create: { orgId: org.id, userId: user.id },
    });
    const departmentId = optStr(fd, "departmentId");
    if (departmentId) await addTeamMember({ orgId: org.id, departmentId, userId: user.id, actorId: actor.id });
    return `Added ${login}`;
  });
}

export async function addToTeam(fd: FormData) {
  return act(BACK, async () => {
    const { org, user: actor } = await requireAdmin();
    const departmentId = str(fd, "departmentId");
    if (!departmentId) throw badRequest("Pick a team");
    await addTeamMember({ orgId: org.id, departmentId, userId: str(fd, "userId"), actorId: actor.id });
    return "Added to team";
  });
}

export async function removeFromTeam(fd: FormData) {
  return act(BACK, async () => {
    const { org, user: actor } = await requireAdmin();
    await removeTeamMember({ orgId: org.id, departmentId: str(fd, "departmentId"), userId: str(fd, "userId"), actorId: actor.id });
    return "Removed from team";
  });
}

export async function decideJoin(fd: FormData) {
  return act(BACK, async () => {
    const { org, user: actor } = await requireAdmin();
    const approve = str(fd, "decision") === "approve";
    await decideJoinRequest({ orgId: org.id, requestId: str(fd, "requestId"), actorId: actor.id, approve, note: str(fd, "note") });
    return approve ? "Approved. They are on the team." : "Request declined";
  });
}

export async function assignToProject(fd: FormData) {
  return act(BACK, async () => {
    const { org, user: actor } = await requireAdmin();
    const project = await prisma.project.findFirstOrThrow({ where: { slug: str(fd, "slug"), orgId: org.id } });
    const departmentId = str(fd, "departmentId");
    await prisma.department.findFirstOrThrow({ where: { id: departmentId, orgId: org.id } });
    const login = str(fd, "login").toLowerCase().replace(/^@/, "");
    if (!/^[a-z0-9][a-z0-9-]{0,38}$/.test(login)) throw badRequest("Enter a valid GitHub login");
    const role = (ROLES as readonly string[]).includes(str(fd, "role")) ? (str(fd, "role") as (typeof ROLES)[number]) : "CONTRIBUTOR";
    const user = await prisma.user.upsert({ where: { login }, update: {}, create: { login } });
    await prisma.orgMember.upsert({
      where: { orgId_userId: { orgId: org.id, userId: user.id } },
      update: {},
      create: { orgId: org.id, userId: user.id },
    });
    await authorizeProjectSeat({ orgId: org.id, actorId: actor.id, userId: user.id, departmentId });
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: user.id } },
      update: { departmentId, role },
      create: { projectId: project.id, userId: user.id, departmentId, role },
    });
    await prisma.liaisonAgent.upsert({
      where: { projectId_departmentId: { projectId: project.id, departmentId } },
      update: {},
      create: { projectId: project.id, departmentId },
    });
    await audit({ orgId: org.id, projectId: project.id, actor: { type: "HUMAN", userId: actor.id }, action: "member.added", data: { login, role } });
    return `Added ${login} to ${project.name}`;
  });
}

export async function unassignFromProject(fd: FormData) {
  return act(BACK, async () => {
    const { org } = await requireAdmin();
    const target = await prisma.projectMember.findFirstOrThrow({ where: { id: str(fd, "id"), project: { orgId: org.id } }, include: { user: true } });
    if (target.role === "OWNER" && (await prisma.projectMember.count({ where: { projectId: target.projectId, role: "OWNER" } })) <= 1) {
      throw badRequest("A project needs at least one owner");
    }
    await prisma.projectMember.delete({ where: { id: target.id } });
    return `Removed ${target.user.login}`;
  });
}
