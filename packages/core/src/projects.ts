import { prisma, type Organization, type ProjectMember, type ProjectRole, type Request } from "@hub/db";
import { renderProject, toYaml, type ProjectInput, type TemplateConfig, type K8sManifest } from "@hub/agent-templates";
import { hubConfig } from "./env.js";

export const DEFAULT_DEPARTMENTS = [
  { key: "dev", name: "Development", description: "Application developers" },
  { key: "devops", name: "DevOps", description: "CI/CD, release and platform tooling" },
  { key: "infra", name: "Infrastructure", description: "Cloud, networking, clusters and secrets" },
  { key: "security", name: "Security", description: "AppSec, IAM, compliance and reviews" },
];

/** The Hub runs one organization per installation; it is created on first use. */
export async function ensureDefaultOrg(): Promise<Organization> {
  const cfg = hubConfig();
  const existing = await prisma.organization.findUnique({ where: { slug: cfg.orgSlug } });
  if (existing) return existing;
  const org = await prisma.organization.upsert({
    where: { slug: cfg.orgSlug },
    update: {},
    create: { slug: cfg.orgSlug, name: cfg.orgName },
  });
  for (const d of DEFAULT_DEPARTMENTS) {
    await prisma.department.upsert({
      where: { orgId_key: { orgId: org.id, key: d.key } },
      update: {},
      create: { ...d, orgId: org.id },
    });
  }
  return org;
}

/** Creates or refreshes a user from a GitHub (or dev) login. The first user becomes org admin. */
export async function upsertUserFromLogin(input: {
  login: string;
  githubId?: string | null;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}) {
  const org = await ensureDefaultOrg();
  const data = {
    login: input.login,
    name: input.name ?? undefined,
    email: input.email ?? undefined,
    avatarUrl: input.avatarUrl ?? undefined,
    ...(input.githubId ? { githubId: input.githubId } : {}),
  };
  const byGithub = input.githubId ? await prisma.user.findUnique({ where: { githubId: input.githubId } }) : null;
  const user = byGithub
    ? await prisma.user.update({ where: { id: byGithub.id }, data })
    : await prisma.user.upsert({ where: { login: input.login }, update: data, create: data });
  const existing = await prisma.orgMember.findUnique({ where: { orgId_userId: { orgId: org.id, userId: user.id } } });
  if (!existing) {
    const admins = await prisma.orgMember.count({ where: { orgId: org.id, role: "ADMIN" } });
    await prisma.orgMember.create({ data: { orgId: org.id, userId: user.id, role: admins === 0 ? "ADMIN" : "MEMBER" } });
  }
  return user;
}

export async function getOrgMembership(userId: string) {
  const org = await ensureDefaultOrg();
  const member = await prisma.orgMember.findUnique({ where: { orgId_userId: { orgId: org.id, userId } } });
  return { org, member };
}

export async function getProjectMembership(projectId: string, userId: string): Promise<ProjectMember | null> {
  return prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } });
}

const ANSWER_ROLES: ProjectRole[] = ["OWNER", "APPROVER", "CONTRIBUTOR"];
const APPROVE_ROLES: ProjectRole[] = ["OWNER", "APPROVER"];

/** Members of the owning department (or project owners when nobody owns it yet) may answer. */
export function canAnswer(member: ProjectMember | null, request: Pick<Request, "resolvedDepartmentId">): boolean {
  if (!member || !ANSWER_ROLES.includes(member.role)) return false;
  if (member.role === "OWNER") return true;
  return !request.resolvedDepartmentId || member.departmentId === request.resolvedDepartmentId;
}

export function canApprove(member: ProjectMember | null, request: Pick<Request, "resolvedDepartmentId">): boolean {
  if (!member || !APPROVE_ROLES.includes(member.role)) return false;
  if (member.role === "OWNER") return true;
  return member.departmentId === request.resolvedDepartmentId;
}

/** Logins to @mention when a request needs a person from a department. */
export async function responderLogins(projectId: string, departmentId: string | null, approversOnly = false): Promise<{ logins: string[]; emails: string[] }> {
  const members = await prisma.projectMember.findMany({
    where: departmentId
      ? { projectId, departmentId, role: { in: approversOnly ? APPROVE_ROLES : ANSWER_ROLES } }
      : { projectId, role: "OWNER" },
    include: { user: true },
  });
  const list = members.length || !departmentId
    ? members
    : await prisma.projectMember.findMany({ where: { projectId, role: "OWNER" }, include: { user: true } });
  return {
    logins: list.map((m) => m.user.login),
    emails: list.map((m) => m.user.email).filter((e): e is string => Boolean(e)),
  };
}

export function templateConfig(orgName: string): TemplateConfig {
  const cfg = hubConfig();
  return {
    namespace: cfg.kagent.namespace,
    orgName,
    apiKeySecret: cfg.kagent.apiKeySecret,
    apiKeySecretKey: cfg.kagent.apiKeySecretKey,
    defaultModel: cfg.kagent.defaultModel,
  };
}

export async function buildProjectInput(projectId: string): Promise<{ input: ProjectInput; orgName: string }> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      org: true,
      agents: {
        include: {
          department: true,
          mcpServers: { include: { mcpServer: true } },
          skills: { include: { skill: true } },
        },
        orderBy: { department: { key: "asc" } },
      },
    },
  });
  return {
    orgName: project.org.name,
    input: {
      slug: project.slug,
      name: project.name,
      description: project.description,
      routerEnabled: project.routerEnabled,
      agents: project.archived
        ? []
        : project.agents.map((a) => ({
            departmentKey: a.department.key,
            departmentName: a.department.name,
            departmentDescription: a.department.description,
            systemPrompt: a.systemPrompt,
            model: a.model,
            autonomy: a.autonomy,
            enabled: a.enabled,
            mcpServers: a.mcpServers.map(({ mcpServer: s }) => ({
              slug: s.slug,
              name: s.name,
              description: s.description,
              transport: s.transport,
              url: s.url,
              image: s.image,
              command: s.command,
              args: s.args,
              secretName: s.secretName,
              secretKey: s.secretKey,
              authHeader: s.authHeader,
              access: s.access,
              readTools: s.readTools,
              writeTools: s.writeTools,
            })),
            skills: a.skills
              .filter(({ skill }) => skill.audience !== "HUMAN")
              .map(({ skill }) => ({ slug: skill.slug, name: skill.name, description: skill.description, content: skill.content })),
          })),
    },
  };
}

export async function renderProjectManifests(projectId: string): Promise<{ manifests: K8sManifest[]; yaml: string }> {
  const { input, orgName } = await buildProjectInput(projectId);
  const manifests = renderProject(input, templateConfig(orgName));
  return { manifests, yaml: toYaml(manifests) };
}
