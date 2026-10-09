import Link from "next/link";
import { prisma } from "@hub/db";
import { Badge, Card, EmptyState, Flash, PageHeader, Table, Td } from "@/components/ui";
import { requireAdmin } from "@/lib/session";
import { SkillForm } from "./skill-form";

const audienceLabel = { AGENT: "agents", HUMAN: "people", BOTH: "agents + people" } as const;

export default async function SkillsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { org } = await requireAdmin();
  const [skills, departments] = await Promise.all([
    prisma.skill.findMany({
      where: { orgId: org.id },
      include: { department: true, _count: { select: { agents: true, projects: true } } },
      orderBy: { slug: "asc" },
    }),
    prisma.department.findMany({ where: { orgId: org.id }, orderBy: { key: "asc" } }),
  ]);
  return (
    <>
      <PageHeader
        title="Skills library"
        subtitle="Team knowledge for liaison agents (added to their instructions) and for people's Claude Code (installed by `hub init`)."
      />
      <Flash searchParams={await searchParams} />
      <div className="space-y-6">
        <Card title="Library">
          {skills.length ? (
            <Table head={["Skill", "Audience", "Owner", "Used by"]}>
              {skills.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <Link href={`/admin/skills/${s.id}`} className="font-medium text-indigo-700 hover:underline">
                      {s.name}
                    </Link>
                    <div className="text-xs text-slate-500">{s.description}</div>
                  </Td>
                  <Td>
                    <Badge tone="blue">{audienceLabel[s.audience]}</Badge>
                  </Td>
                  <Td>{s.department?.name ?? "Shared"}</Td>
                  <Td className="text-xs">
                    {s._count.agents} agents, {s._count.projects} projects
                  </Td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="No skills yet">Write down what people usually ask your team: where configs live, naming conventions, runbooks.</EmptyState>
          )}
        </Card>
        <Card title="Add skill">
          <SkillForm departments={departments} />
        </Card>
      </div>
    </>
  );
}
