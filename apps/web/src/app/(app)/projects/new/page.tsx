import { prisma } from "@hub/db";
import Link from "next/link";
import { Card, Checkbox, EmptyState, Field, Flash, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getOrgContext } from "@/lib/session";
import { createProject } from "../actions";
import { WizardSteps } from "../wizard-steps";

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { org, member, user, isAdmin } = await getOrgContext();
  const departments = await prisma.department.findMany({ where: { orgId: org.id }, orderBy: { key: "asc" } });
  const myTeamIds = new Set((await prisma.teamMember.findMany({ where: { userId: user.id } })).map((t) => t.departmentId));
  const myTeams = isAdmin ? departments : departments.filter((d) => myTeamIds.has(d.id));
  if (myTeams.length === 0) {
    return (
      <>
        <PageHeader title="New project" subtitle="Projects are started on behalf of a team." />
        <EmptyState title="Join a team first">
          You aren't on any team yet. <Link href="/teams" className="font-medium text-indigo-700 hover:underline">Request to join one</Link>, and an org admin will approve it.
        </EmptyState>
      </>
    );
  }
  return (
    <>
      <PageHeader title="New project" subtitle="Set up the project, pick the teams involved, then add people and configure each team's agent." />
      <WizardSteps current={1} />
      <Flash searchParams={await searchParams} />
      <Card>
        <form action={createProject} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project name">
              <Input name="name" placeholder="Payments Service" required />
            </Field>
            <Field label="Slug" hint="Used by hub-mcp and in agent names. Lowercase letters, numbers and dashes.">
              <Input name="slug" placeholder="payments" />
            </Field>
          </div>
          <Field label="Description" hint="Agents read this, so describe what the project is">
            <Textarea name="description" rows={3} className="font-sans text-sm" placeholder="Card payments API, ledger and settlement jobs running on EKS." />
          </Field>
          <Field label="GitHub repository" hint="Where request threads are posted as Discussions. The Hub's GitHub App must be installed on it.">
            <Input name="repo" placeholder="acme/payments" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starting on behalf of" hint="Only teams you belong to">
              <Select name="myDepartmentId" defaultValue={myTeams.find((d) => d.id === member?.departmentId)?.id ?? myTeams[0].id} required>
                {myTeams.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </Field>
            <div>
              <span className="mb-2 block text-sm font-medium text-slate-700">Teams on this project</span>
              <div className="space-y-2">
                {departments.map((d) => (
                  <Checkbox key={d.id} name="departments" value={d.id} defaultChecked label={d.name} hint={d.description} />
                ))}
              </div>
            </div>
          </div>
          <SubmitButton>Create project</SubmitButton>
        </form>
      </Card>
    </>
  );
}
