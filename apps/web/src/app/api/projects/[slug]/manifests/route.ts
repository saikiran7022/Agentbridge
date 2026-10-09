import { NextResponse } from "next/server";
import { ensureDefaultOrg, renderProjectManifests } from "@hub/core";
import { prisma } from "@hub/db";
import { getCurrentUser } from "@/lib/session";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { slug } = await params;
  const org = await ensureDefaultOrg();
  const project = await prisma.project.findUnique({ where: { orgId_slug: { orgId: org.id, slug } } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [member, orgMember] = await Promise.all([
    prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: project.id, userId: user.id } } }),
    prisma.orgMember.findUnique({ where: { orgId_userId: { orgId: org.id, userId: user.id } } }),
  ]);
  if (!member && orgMember?.role !== "ADMIN") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { yaml } = await renderProjectManifests(project.id);
  return new NextResponse(yaml, {
    headers: {
      "content-type": "application/yaml",
      "content-disposition": `attachment; filename="${slug}-agents.yaml"`,
    },
  });
}
