import { prisma } from "@hub/db";
import { Card, Field, Flash, Input, Select, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireProject } from "@/lib/session";
import { addProjectMember, removeProjectMember, updateProjectMember } from "../../actions";
import { WizardSteps } from "../../wizard-steps";

const ROLE_HELP = {
  OWNER: "Manages the project; can answer and approve for any team",
  APPROVER: "Answers for their team and approves changes the agent proposes",
  CONTRIBUTOR: "Asks other teams and answers for their own team",
  VIEWER: "Read-only",
};

export default async function MembersPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { slug } = await params;
  const { project, org, canManage } = await requireProject(slug);
  const [members, departments] = await Promise.all([
    prisma.projectMember.findMany({
      where: { projectId: project.id },
      include: { user: true, department: true },
      orderBy: [{ department: { key: "asc" } }, { role: "asc" }],
    }),
    prisma.department.findMany({ where: { orgId: org.id }, orderBy: { key: "asc" } }),
  ]);
  const grouped = departments
    .map((d) => ({ d, people: members.filter((m) => m.departmentId === d.id) }))
    .filter((g) => g.people.length);

  return (
    <>
      {canManage && <WizardSteps current={2} slug={slug} />}
      <Flash searchParams={await searchParams} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={`${members.length} people`} className="lg:col-span-2">
          <Table head={["Person", "Team and role", ""]}>
            {grouped.flatMap(({ people }) =>
              people.map((m) => (
                <tr key={m.id}>
                  <Td>
                    <div className="font-medium">{m.user.login}</div>
                    <div className="text-xs text-slate-500">{m.user.name}</div>
                  </Td>
                  <Td>
                    {canManage ? (
                      <form action={updateProjectMember} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="id" value={m.id} />
                        <Select name="departmentId" defaultValue={m.departmentId} className="w-40">
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </Select>
                        <Select name="role" defaultValue={m.role} className="w-36">
                          {Object.keys(ROLE_HELP).map((r) => (
                            <option key={r} value={r}>{r.toLowerCase()}</option>
                          ))}
                        </Select>
                        <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
                      </form>
                    ) : (
                      <span className="text-sm">
                        {m.department.name}, {m.role.toLowerCase()}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {canManage && (
                      <form action={removeProjectMember}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="id" value={m.id} />
                        <SubmitButton size="sm" variant="ghost" confirm={`Remove ${m.user.login}?`}>Remove</SubmitButton>
                      </form>
                    )}
                  </Td>
                </tr>
              )),
            )}
          </Table>
        </Card>
        <div className="space-y-6">
          {canManage && (
            <Card title="Add a person">
              <form action={addProjectMember} className="space-y-3">
                <input type="hidden" name="slug" value={slug} />
                <Field label="GitHub login" hint="People who haven't signed in yet are added automatically">
                  <Input name="login" placeholder="ivan-infra" required />
                </Field>
                <Field label="Team">
                  <Select name="departmentId" required defaultValue="">
                    <option value="" disabled>Choose...</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Role">
                  <Select name="role" defaultValue="CONTRIBUTOR">
                    {Object.keys(ROLE_HELP).map((r) => (
                      <option key={r} value={r}>{r.toLowerCase()}</option>
                    ))}
                  </Select>
                </Field>
                <SubmitButton>Add to project</SubmitButton>
              </form>
            </Card>
          )}
          <Card title="Roles">
            <dl className="space-y-2 text-sm">
              {Object.entries(ROLE_HELP).map(([role, help]) => (
                <div key={role}>
                  <dt className="font-medium">{role.toLowerCase()}</dt>
                  <dd className="text-slate-500">{help}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
