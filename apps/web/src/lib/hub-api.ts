import {
  approveRequest,
  closeRequest,
  createRequest,
  ensureDefaultOrg,
  getRequestForUser,
  hubConfig,
  listInbox,
  listRequests,
  notFound,
  rejectRequest,
  replyToRequest,
  serializeRequest,
  waitForRequest,
} from "@hub/core";
import { prisma, type RequestStatus, type User } from "@hub/db";
import { hubLiaisonSkill, type HubApi, type HubProject } from "@hub/mcp";

const STATUSES = new Set<string>(["OPEN", "ROUTING", "IN_PROGRESS", "ANSWERED", "ESCALATED", "AWAITING_APPROVAL", "APPROVED", "REJECTED", "CLOSED", "FAILED"]);

export async function projectsFor(user: User): Promise<HubProject[]> {
  const memberships = await prisma.projectMember.findMany({
    where: { userId: user.id, project: { archived: false } },
    include: {
      department: true,
      project: {
        include: {
          agents: { include: { department: true } },
          members: { include: { user: true, department: true } },
        },
      },
    },
    orderBy: { project: { slug: "asc" } },
  });
  return memberships.map(({ project, department, role }) => {
    const depts = new Map<string, { key: string; name: string; description: string }>();
    for (const a of project.agents) depts.set(a.department.id, a.department);
    for (const m of project.members) depts.set(m.department.id, m.department);
    return {
      slug: project.slug,
      name: project.name,
      description: project.description,
      myRole: role,
      myTeam: department.key,
      routerEnabled: project.routerEnabled,
      teams: [...depts.entries()]
        .sort((a, b) => a[1].key.localeCompare(b[1].key))
        .map(([id, d]) => {
          const agent = project.agents.find((a) => a.departmentId === id);
          return {
            key: d.key,
            name: d.name,
            description: d.description,
            agent: agent ? { enabled: agent.enabled, autonomy: agent.autonomy, status: agent.syncStatus } : null,
            people: project.members.filter((m) => m.departmentId === id).map((m) => ({ login: m.user.login, role: m.role })),
          };
        }),
    };
  });
}

/** In-process HubApi used by the REST routes and the hosted MCP endpoint. */
export function directHubApi(user: User): HubApi {
  return {
    async me() {
      return { login: user.login, name: user.name };
    },
    listProjects: () => projectsFor(user),
    async ask(input) {
      return serializeRequest(
        await createRequest({
          user,
          projectSlug: input.project,
          team: input.team,
          question: input.question,
          context: input.context,
          title: input.title,
          client: input.client,
        }),
      );
    },
    async getRequest(id) {
      return serializeRequest(await getRequestForUser(user, id));
    },
    async waitFor(id, timeoutSeconds) {
      return serializeRequest(await waitForRequest(user, id, timeoutSeconds * 1000));
    },
    async myRequests(status) {
      const s = status?.toUpperCase();
      const rows = await listRequests({ askerId: user.id, ...(s && STATUSES.has(s) ? { status: s as RequestStatus } : {}) }, 50);
      return rows.map(serializeRequest);
    },
    async inbox() {
      return (await listInbox(user)).map(serializeRequest);
    },
    async reply(id, body) {
      return serializeRequest(await replyToRequest(user, id, body, { via: "hub-mcp" }));
    },
    async approve(id, note) {
      return serializeRequest(await approveRequest(user, id, note, { via: "hub-mcp" }));
    },
    async reject(id, reason) {
      return serializeRequest(await rejectRequest(user, id, reason, { via: "hub-mcp" }));
    },
    async close(id) {
      return serializeRequest(await closeRequest(user, id, { via: "hub-mcp" }));
    },
    async bootstrap(slug) {
      const org = await ensureDefaultOrg();
      const project = await prisma.project.findUnique({
        where: { orgId_slug: { orgId: org.id, slug } },
        include: { skills: { include: { skill: true } } },
      });
      if (!project) throw notFound(`Project "${slug}"`);
      const member = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: project.id, userId: user.id } } });
      if (!member) throw notFound(`Project "${slug}"`);
      const skills = project.skills
        .filter(({ skill }) => skill.audience !== "AGENT")
        .map(({ skill }) => ({ slug: skill.slug, name: skill.name, description: skill.description, content: skill.content }));
      return {
        hubUrl: hubConfig().hubUrl,
        project: { slug: project.slug, name: project.name },
        skills: [hubLiaisonSkill(project.slug), ...skills],
      };
    },
  };
}
