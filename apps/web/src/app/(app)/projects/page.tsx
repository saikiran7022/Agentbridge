import Link from "next/link";
import { prisma } from "@hub/db";
import { Badge, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/session";

export default async function ProjectsPage() {
  const { user, org, isAdmin } = await getOrgContext();
  const projects = await prisma.project.findMany({
    where: { orgId: org.id, ...(isAdmin ? {} : { members: { some: { userId: user.id } } }) },
    include: {
      members: { include: { department: true } },
      agents: { include: { department: true } },
      _count: { select: { requests: { where: { status: { in: ["ESCALATED", "AWAITING_APPROVAL"] } } } } },
    },
    orderBy: [{ archived: "asc" }, { name: "asc" }],
  });
  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Each project has one or two people per team plus a liaison agent for every team."
        actions={<LinkButton href="/projects/new" variant="primary">New project</LinkButton>}
      />
      {projects.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.map((p) => {
            const mine = p.members.find((m) => m.userId === user.id);
            return (
              <Link key={p.id} href={`/projects/${p.slug}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-semibold">{p.name}</h2>
                    <p className="text-xs text-slate-500">{p.githubOwner ? `${p.githubOwner}/${p.githubRepo}` : "No repository linked"}</p>
                  </div>
                  <div className="flex gap-1">
                    {p.archived && <Badge>archived</Badge>}
                    {p._count.requests > 0 && <Badge tone="amber">{p._count.requests} waiting</Badge>}
                    {mine && <Badge tone="violet">{mine.role.toLowerCase()}</Badge>}
                  </div>
                </div>
                {p.description && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{p.description}</p>}
                <div className="mt-3 flex flex-wrap gap-1">
                  {p.agents.map((a) => (
                    <Badge key={a.id} tone={a.enabled ? "blue" : "gray"}>
                      {a.department.key} ({p.members.filter((m) => m.departmentId === a.departmentId).length})
                    </Badge>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState title="You're not on any projects yet">
          Create one, or ask a project owner to add you.
        </EmptyState>
      )}
    </>
  );
}
