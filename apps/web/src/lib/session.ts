import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { ensureDefaultOrg } from "@hub/core";
import { prisma, type ProjectMember } from "@hub/db";
import { authOptions } from "./auth";

export const getCurrentUser = cache(async () => {
  const session = await getServerSession(authOptions);
  const id = (session as { hubUserId?: string } | null)?.hubUserId;
  if (!id) return null;
  return prisma.user.findUnique({ where: { id } });
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export const getOrgContext = cache(async () => {
  const user = await requireUser();
  const org = await ensureDefaultOrg();
  const member = await prisma.orgMember.findUnique({ where: { orgId_userId: { orgId: org.id, userId: user.id } } });
  return { user, org, member, isAdmin: member?.role === "ADMIN" };
});

export async function requireAdmin() {
  const ctx = await getOrgContext();
  if (!ctx.isAdmin) redirect("/?error=" + encodeURIComponent("Only organization admins can do that"));
  return ctx;
}

/** Loads a project for the current user. Org admins can see and manage every project. */
export async function requireProject(slug: string, opts: { manage?: boolean } = {}) {
  const ctx = await getOrgContext();
  const project = await prisma.project.findUnique({ where: { orgId_slug: { orgId: ctx.org.id, slug } } });
  if (!project) notFound();
  const membership: ProjectMember | null = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: project.id, userId: ctx.user.id } },
  });
  const canManage = ctx.isAdmin || membership?.role === "OWNER";
  if (!membership && !ctx.isAdmin) notFound();
  if (opts.manage && !canManage) {
    redirect(`/projects/${slug}?error=` + encodeURIComponent("Only project owners and org admins can change project settings"));
  }
  return { ...ctx, project, membership, canManage };
}
