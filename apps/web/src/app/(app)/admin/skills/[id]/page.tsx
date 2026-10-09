import { notFound } from "next/navigation";
import { prisma } from "@hub/db";
import { Card, Flash, LinkButton, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireAdmin } from "@/lib/session";
import { deleteSkill } from "../../actions";
import { SkillForm } from "../skill-form";

export default async function EditSkillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { org } = await requireAdmin();
  const { id } = await params;
  const [skill, departments] = await Promise.all([
    prisma.skill.findFirst({ where: { id, orgId: org.id } }),
    prisma.department.findMany({ where: { orgId: org.id }, orderBy: { key: "asc" } }),
  ]);
  if (!skill) notFound();
  return (
    <>
      <PageHeader title={skill.name} actions={<LinkButton href="/admin/skills">Back to library</LinkButton>} />
      <Flash searchParams={await searchParams} />
      <div className="space-y-6">
        <Card title="Skill">
          <SkillForm skill={skill} departments={departments} />
        </Card>
        <Card title="Danger zone">
          <form action={deleteSkill}>
            <input type="hidden" name="id" value={skill.id} />
            <SubmitButton variant="danger" confirm="Delete this skill?">Delete skill</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
