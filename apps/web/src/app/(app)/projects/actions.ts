"use server";

import { redirect } from "next/navigation";
import {
  approveRequest,
  audit,
  badRequest,
  closeRequest,
  createRequest,
  enqueue,
  rejectRequest,
  replyToRequest,
  syncDiscussionCategories,
} from "@hub/core";
import { prisma } from "@hub/db";
import { act, bool, num, optStr, slugify, str, withMessage } from "@/lib/form";
import { getOrgContext, requireProject } from "@/lib/session";

const AUTONOMY = ["READ_ONLY", "APPROVAL_FOR_WRITES", "AUTONOMOUS"] as const;
const ROLES = ["OWNER", "APPROVER", "CONTRIBUTOR", "VIEWER"] as const;

function parseRepo(value: string): { owner: string | null; repo: string | null } {
  const clean = value.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  if (!clean) return { owner: null, repo: null };
  const [owner, repo] = clean.split("/");
  if (!owner || !repo) throw badRequest('GitHub repository must look like "owner/repo"');
  return { owner, repo };
}

export async function createProject(fd: FormData) {
  return act("/projects/new", async () => {
    const { org, user } = await getOrgContext();
    const name = str(fd, "name");
    const slug = slugify(str(fd, "slug") || name);
    if (!name || !slug) throw badRequest("Project name is required");
    const myDepartmentId = str(fd, "myDepartmentId");
    if (!myDepartmentId) throw badRequest("Pick your own department");
    const departmentIds = new Set([...fd.getAll("departments").map(String), myDepartmentId]);
    const { owner, repo } = parseRepo(str(fd, "repo"));

    const project = await prisma.project.create({
      data: {
        orgId: org.id,
        name,
        slug,
        description: str(fd, "description"),
        githubOwner: owner,
        githubRepo: repo,
        members: { create: { userId: user.id, departmentId: myDepartmentId, role: "OWNER" } },
        agents: { create: [...departmentIds].map((departmentId) => ({ departmentId })) },
      },
    });
    await audit({ orgId: org.id, projectId: project.id, actor: { type: "HUMAN", userId: user.id }, action: "project.created", data: { slug } });
    redirect(withMessage(`/projects/${slug}/members`, "ok", "Project created. Next: add one or two people from each team."));
  });
}

async function ensureAgent(projectId: string, departmentId: string) {
  await prisma.liaisonAgent.upsert({
    where: { projectId_departmentId: { projectId, departmentId } },
    update: {},
    create: { projectId, departmentId },
  });
}

export async function addProjectMember(fd: FormData) {
  const slug = str(fd, "slug");
  return act(`/projects/${slug}/members`, async () => {
    const { project, org, user: actor } = await requireProject(slug, { manage: true });
    const login = str(fd, "login").toLowerCase().replace(/^@/, "");
    if (!/^[a-z0-9][a-z0-9-]{0,38}$/.test(login)) throw badRequest("Enter a valid GitHub login");
    const departmentId = str(fd, "departmentId");
    if (!departmentId) throw badRequest("Pick a department");
    const role = (ROLES as readonly string[]).includes(str(fd, "role")) ? (str(fd, "role") as (typeof ROLES)[number]) : "CONTRIBUTOR";
    const user = await prisma.user.upsert({ where: { login }, update: {}, create: { login } });
    await prisma.orgMember.upsert({
      where: { orgId_userId: { orgId: org.id, userId: user.id } },
      update: {},
      create: { orgId: org.id, userId: user.id, departmentId },
    });
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: user.id } },
      update: { departmentId, role },
      create: { projectId: project.id, userId: user.id, departmentId, role },
    });
    await ensureAgent(project.id, departmentId);
    await audit({ orgId: org.id, projectId: project.id, actor: { type: "HUMAN", userId: actor.id }, action: "member.added", data: { login, role } });
    return `Added ${login}`;
  });
}

export async function updateProjectMember(fd: FormData) {
  const slug = str(fd, "slug");
  return act(`/projects/${slug}/members`, async () => {
    const { project } = await requireProject(slug, { manage: true });
    const role = (ROLES as readonly string[]).includes(str(fd, "role")) ? (str(fd, "role") as (typeof ROLES)[number]) : "CONTRIBUTOR";
    const departmentId = str(fd, "departmentId");
    await prisma.projectMember.update({ where: { id: str(fd, "id"), projectId: project.id }, data: { role, departmentId } });
    await ensureAgent(project.id, departmentId);
    return "Saved";
  });
}

export async function removeProjectMember(fd: FormData) {
  const slug = str(fd, "slug");
  return act(`/projects/${slug}/members`, async () => {
    const { project } = await requireProject(slug, { manage: true });
    const owners = await prisma.projectMember.count({ where: { projectId: project.id, role: "OWNER" } });
    const target = await prisma.projectMember.findFirstOrThrow({ where: { id: str(fd, "id"), projectId: project.id } });
    if (target.role === "OWNER" && owners <= 1) throw badRequest("A project needs at least one owner");
    await prisma.projectMember.delete({ where: { id: target.id } });
    return "Removed";
  });
}

export async function saveAgent(fd: FormData) {
  const slug = str(fd, "slug");
  return act(`/projects/${slug}/agents`, async () => {
    const { project, user } = await requireProject(slug, { manage: true });
    const id = str(fd, "agentId");
    const autonomy = (AUTONOMY as readonly string[]).includes(str(fd, "autonomy")) ? (str(fd, "autonomy") as (typeof AUTONOMY)[number]) : "READ_ONLY";
    const mcpServerIds = fd.getAll("mcpServerIds").map(String);
    const skillIds = fd.getAll("skillIds").map(String);
    const agent = await prisma.liaisonAgent.update({
      where: { id, projectId: project.id },
      data: {
        enabled: bool(fd, "enabled"),
        autonomy,
        confidenceThreshold: Math.min(Math.max(num(fd, "confidenceThreshold", 0.7), 0), 1),
        maxHops: Math.min(Math.max(Math.round(num(fd, "maxHops", 3)), 1), 10),
        maxTokens: Math.max(Math.round(num(fd, "maxTokens", 60000)), 1000),
        model: optStr(fd, "model"),
        systemPrompt: str(fd, "systemPrompt"),
        syncStatus: "PENDING",
        mcpServers: { deleteMany: {}, create: mcpServerIds.map((mcpServerId) => ({ mcpServerId })) },
        skills: { deleteMany: {}, create: skillIds.map((skillId) => ({ skillId })) },
      },
      include: { department: true },
    });
    await audit({ orgId: project.orgId, projectId: project.id, actor: { type: "HUMAN", userId: user.id }, action: "agent.updated", data: { department: agent.department.key, autonomy, mcpServers: mcpServerIds.length, skills: skillIds.length } });
    await enqueue("project.reconcile", { projectId: project.id });
    return `Saved the ${agent.department.name} agent; syncing to kagent`;
  });
}

export async function addAgent(fd: FormData) {
  const slug = str(fd, "slug");
  return act(`/projects/${slug}/agents`, async () => {
    const { project } = await requireProject(slug, { manage: true });
    await ensureAgent(project.id, str(fd, "departmentId"));
    return "Agent added";
  });
}

export async function syncAgents(fd: FormData) {
  const slug = str(fd, "slug");
  return act(`/projects/${slug}/agents`, async () => {
    const { project } = await requireProject(slug, { manage: true });
    await prisma.liaisonAgent.updateMany({ where: { projectId: project.id, enabled: true }, data: { syncStatus: "PENDING" } });
    await enqueue("project.reconcile", { projectId: project.id });
    return "Sync queued. Refresh in a few seconds to see the result.";
  });
}

export async function saveProjectSettings(fd: FormData) {
  const slug = str(fd, "slug");
  return act(`/projects/${slug}/settings`, async () => {
    const { project, user } = await requireProject(slug, { manage: true });
    const { owner, repo } = parseRepo(str(fd, "repo"));
    const repoChanged = owner !== project.githubOwner || repo !== project.githubRepo;
    const skillIds = fd.getAll("skillIds").map(String);
    await prisma.project.update({
      where: { id: project.id },
      data: {
        name: str(fd, "name") || project.name,
        description: str(fd, "description"),
        githubOwner: owner,
        githubRepo: repo,
        ...(repoChanged ? { githubInstallationId: null, githubRepositoryId: null } : {}),
        fallbackCategory: str(fd, "fallbackCategory") || "General",
        routerEnabled: bool(fd, "routerEnabled"),
        slackWebhookUrl: optStr(fd, "slackWebhookUrl"),
        skills: { deleteMany: {}, create: skillIds.map((skillId) => ({ skillId })) },
      },
    });
    if (repoChanged) await prisma.liaisonAgent.updateMany({ where: { projectId: project.id }, data: { discussionCategoryId: null, discussionCategoryName: null } });
    await audit({ orgId: project.orgId, projectId: project.id, actor: { type: "HUMAN", userId: user.id }, action: "project.updated", data: { repo: owner ? `${owner}/${repo}` : null } });
    await enqueue("project.reconcile", { projectId: project.id });
    return "Settings saved";
  });
}

export async function checkDiscussions(fd: FormData) {
  const slug = str(fd, "slug");
  return act(`/projects/${slug}/settings`, async () => {
    const { project } = await requireProject(slug, { manage: true });
    const result = await syncDiscussionCategories(project.id);
    if (!result.ok) throw badRequest(result.error);
    if (!result.discussionsEnabled) throw badRequest("Discussions are disabled on this repository. Enable them in the repository settings.");
    const missing = result.departments.filter((d) => !d.category).map((d) => d.name);
    return missing.length
      ? `Connected. Missing categories (threads go to "${project.fallbackCategory}" instead): ${missing.join(", ")}`
      : "Connected. Every department has its own Discussions category.";
  });
}

export async function setArchived(fd: FormData) {
  const slug = str(fd, "slug");
  return act(`/projects/${slug}/settings`, async () => {
    const { project, user } = await requireProject(slug, { manage: true });
    const archived = bool(fd, "archived");
    await prisma.project.update({ where: { id: project.id }, data: { archived } });
    await audit({ orgId: project.orgId, projectId: project.id, actor: { type: "HUMAN", userId: user.id }, action: archived ? "project.archived" : "project.restored" });
    await enqueue("project.reconcile", { projectId: project.id });
    return archived ? "Project archived; its agents will be removed from kagent" : "Project restored";
  });
}

export async function askQuestion(fd: FormData) {
  const slug = str(fd, "slug");
  const { user } = await getOrgContext();
  let target = `/projects/${slug}`;
  await act(target, async () => {
    const r = await createRequest({
      user,
      projectSlug: slug,
      team: optStr(fd, "team"),
      question: str(fd, "question"),
      context: str(fd, "context"),
      client: "web",
    });
    target = `/projects/${slug}/requests/${r.id}`;
    redirect(withMessage(target, "ok", `Request #${r.number} created`));
  });
}

function requestPath(fd: FormData) {
  return `/projects/${str(fd, "slug")}/requests/${str(fd, "requestId")}`;
}

export async function replyAction(fd: FormData) {
  return act(requestPath(fd), async () => {
    const { user } = await getOrgContext();
    await replyToRequest(user, str(fd, "requestId"), str(fd, "body"), { via: "web" });
    return "Reply posted";
  });
}

export async function approveAction(fd: FormData) {
  return act(requestPath(fd), async () => {
    const { user } = await getOrgContext();
    await approveRequest(user, str(fd, "requestId"), optStr(fd, "note") ?? undefined, { via: "web" });
    return "Approved";
  });
}

export async function rejectAction(fd: FormData) {
  return act(requestPath(fd), async () => {
    const { user } = await getOrgContext();
    await rejectRequest(user, str(fd, "requestId"), str(fd, "reason"), { via: "web" });
    return "Rejected";
  });
}

export async function closeAction(fd: FormData) {
  return act(requestPath(fd), async () => {
    const { user } = await getOrgContext();
    await closeRequest(user, str(fd, "requestId"), { via: "web" });
    return "Closed";
  });
}
