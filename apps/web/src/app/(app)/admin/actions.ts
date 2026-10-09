"use server";

import { audit, badRequest } from "@hub/core";
import { prisma } from "@hub/db";
import { act, list, optStr, slugify, str } from "@/lib/form";
import { requireAdmin } from "@/lib/session";

const MCP_TRANSPORTS = ["STREAMABLE_HTTP", "SSE", "STDIO"] as const;
const MCP_ACCESS = ["READ_ONLY", "READ_WRITE"] as const;
const AUDIENCES = ["AGENT", "HUMAN", "BOTH"] as const;

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export async function saveDepartment(fd: FormData) {
  return act("/admin/departments", async () => {
    const { org, user } = await requireAdmin();
    const id = str(fd, "id");
    const name = str(fd, "name");
    const key = slugify(str(fd, "key") || name);
    if (!name || !key) throw badRequest("Name is required");
    const data = { name, key, description: str(fd, "description") };
    if (id) await prisma.department.update({ where: { id, orgId: org.id }, data });
    else await prisma.department.create({ data: { ...data, orgId: org.id } });
    await audit({ orgId: org.id, actor: { type: "HUMAN", userId: user.id }, action: id ? "department.updated" : "department.created", data });
    return `Saved department "${name}"`;
  });
}

export async function deleteDepartment(fd: FormData) {
  return act("/admin/departments", async () => {
    const { org } = await requireAdmin();
    const id = str(fd, "id");
    const used = await prisma.projectMember.count({ where: { departmentId: id } }) + (await prisma.liaisonAgent.count({ where: { departmentId: id } }));
    if (used) throw badRequest("This department is used by projects; remove its members and agents first");
    await prisma.department.delete({ where: { id, orgId: org.id } });
    return "Department deleted";
  });
}

export async function addOrgUser(fd: FormData) {
  return act("/admin/users", async () => {
    const { org, user: admin } = await requireAdmin();
    const login = str(fd, "login").toLowerCase().replace(/^@/, "");
    if (!/^[a-z0-9][a-z0-9-]{0,38}$/.test(login)) throw badRequest("Enter a valid GitHub login");
    const user = await prisma.user.upsert({
      where: { login },
      update: {},
      create: { login, name: optStr(fd, "name"), email: optStr(fd, "email") },
    });
    await prisma.orgMember.upsert({
      where: { orgId_userId: { orgId: org.id, userId: user.id } },
      update: { departmentId: optStr(fd, "departmentId") },
      create: { orgId: org.id, userId: user.id, departmentId: optStr(fd, "departmentId"), role: str(fd, "role") === "ADMIN" ? "ADMIN" : "MEMBER" },
    });
    await audit({ orgId: org.id, actor: { type: "HUMAN", userId: admin.id }, action: "user.added", data: { login } });
    return `Added ${login}. They can sign in with GitHub as "${login}".`;
  });
}

export async function updateOrgMember(fd: FormData) {
  return act("/admin/users", async () => {
    const { org, user: admin } = await requireAdmin();
    const id = str(fd, "id");
    const role = str(fd, "role") === "ADMIN" ? "ADMIN" : "MEMBER";
    const member = await prisma.orgMember.findFirstOrThrow({ where: { id, orgId: org.id } });
    if (member.userId === admin.id && role !== "ADMIN") throw badRequest("You cannot remove your own admin role");
    await prisma.orgMember.update({ where: { id }, data: { role, departmentId: optStr(fd, "departmentId") } });
    await prisma.user.update({ where: { id: member.userId }, data: { email: optStr(fd, "email"), name: optStr(fd, "name") } });
    return "Saved";
  });
}

export async function saveMcpServer(fd: FormData) {
  const id = str(fd, "id");
  return act(id ? `/admin/mcp-servers/${id}` : "/admin/mcp-servers", async () => {
    const { org, user } = await requireAdmin();
    const name = str(fd, "name");
    const slug = slugify(str(fd, "slug") || name);
    if (!name || !slug) throw badRequest("Name is required");
    const transport = oneOf(str(fd, "transport"), MCP_TRANSPORTS, "STREAMABLE_HTTP");
    const url = optStr(fd, "url");
    const image = optStr(fd, "image");
    if (transport !== "STDIO" && !url) throw badRequest("Remote MCP servers need a URL");
    if (transport === "STDIO" && !image) throw badRequest("STDIO MCP servers need a container image");
    const data = {
      name,
      slug,
      description: str(fd, "description"),
      departmentId: optStr(fd, "departmentId"),
      transport,
      url,
      image,
      command: optStr(fd, "command"),
      args: list(fd, "args"),
      secretName: optStr(fd, "secretName"),
      secretKey: optStr(fd, "secretKey"),
      authHeader: str(fd, "authHeader") || "Authorization",
      access: oneOf(str(fd, "access"), MCP_ACCESS, "READ_ONLY"),
      readTools: list(fd, "readTools"),
      writeTools: list(fd, "writeTools"),
    };
    const saved = id
      ? await prisma.mcpServer.update({ where: { id, orgId: org.id }, data })
      : await prisma.mcpServer.create({ data: { ...data, orgId: org.id } });
    await audit({ orgId: org.id, actor: { type: "HUMAN", userId: user.id }, action: id ? "mcp.updated" : "mcp.created", data: { slug: saved.slug } });
    return `Saved MCP server "${name}". Re-sync projects that use it.`;
  });
}

export async function deleteMcpServer(fd: FormData) {
  return act("/admin/mcp-servers", async () => {
    const { org } = await requireAdmin();
    await prisma.mcpServer.delete({ where: { id: str(fd, "id"), orgId: org.id } });
    return "MCP server deleted. Re-sync projects that used it.";
  });
}

export async function saveSkill(fd: FormData) {
  const id = str(fd, "id");
  return act(id ? `/admin/skills/${id}` : "/admin/skills", async () => {
    const { org, user } = await requireAdmin();
    const name = str(fd, "name");
    const slug = slugify(str(fd, "slug") || name);
    const content = str(fd, "content");
    if (!name || !slug || !content) throw badRequest("Name and content are required");
    const data = {
      name,
      slug,
      description: str(fd, "description") || name,
      content,
      audience: oneOf(str(fd, "audience"), AUDIENCES, "BOTH"),
      departmentId: optStr(fd, "departmentId"),
    };
    const saved = id
      ? await prisma.skill.update({ where: { id, orgId: org.id }, data })
      : await prisma.skill.create({ data: { ...data, orgId: org.id } });
    await audit({ orgId: org.id, actor: { type: "HUMAN", userId: user.id }, action: id ? "skill.updated" : "skill.created", data: { slug: saved.slug } });
    return `Saved skill "${name}"`;
  });
}

export async function deleteSkill(fd: FormData) {
  return act("/admin/skills", async () => {
    const { org } = await requireAdmin();
    await prisma.skill.delete({ where: { id: str(fd, "id"), orgId: org.id } });
    return "Skill deleted";
  });
}