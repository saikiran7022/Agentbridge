import { prisma } from "@hub/db";
import { Badge, Card, Field, Flash, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireAdmin } from "@/lib/session";
import { addOrgUser, updateOrgMember } from "../actions";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { org } = await requireAdmin();
  const [members, departments] = await Promise.all([
    prisma.orgMember.findMany({
      where: { orgId: org.id },
      include: { user: { include: { _count: { select: { projectMemberships: true, apiTokens: { where: { revokedAt: null } } } } } } },
      orderBy: { user: { login: "asc" } },
    }),
    prisma.department.findMany({ where: { orgId: org.id }, orderBy: { key: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="People" subtitle="Everyone who can sign in. Add people ahead of time by GitHub login so you can put them on projects." />
      <Flash searchParams={await searchParams} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={`${members.length} people`} className="lg:col-span-2">
          <Table head={["Person", "Home department / role", "Activity"]}>
            {members.map((m) => (
              <tr key={m.id}>
                <Td>
                  <div className="font-medium">{m.user.login}</div>
                  <div className="text-xs text-slate-500">{m.user.githubId ? "Signed in with GitHub" : "Not signed in yet"}</div>
                </Td>
                <Td>
                  <form action={updateOrgMember} className="grid grid-cols-2 gap-2">
                    <input type="hidden" name="id" value={m.id} />
                    <Input name="name" defaultValue={m.user.name ?? ""} placeholder="Name" />
                    <Input name="email" defaultValue={m.user.email ?? ""} placeholder="Email (for escalations)" />
                    <Select name="departmentId" defaultValue={m.departmentId ?? ""}>
                      <option value="">No department</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </Select>
                    <Select name="role" defaultValue={m.role}>
                      <option value="MEMBER">Member</option>
                      <option value="ADMIN">Org admin</option>
                    </Select>
                    <div className="col-span-2">
                      <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
                    </div>
                  </form>
                </Td>
                <Td className="whitespace-nowrap text-xs text-slate-500">
                  {m.role === "ADMIN" && <Badge tone="violet">admin</Badge>}
                  <div className="mt-1">{m.user._count.projectMemberships} projects</div>
                  <div>{m.user._count.apiTokens} active tokens</div>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Add a person">
          <form action={addOrgUser} className="space-y-3">
            <Field label="GitHub login">
              <Input name="login" placeholder="octocat" required />
            </Field>
            <Field label="Name">
              <Input name="name" />
            </Field>
            <Field label="Email" hint="Used for escalation emails when SMTP is configured">
              <Input name="email" type="email" />
            </Field>
            <Field label="Home department">
              <Select name="departmentId" defaultValue="">
                <option value="">None</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Org role">
              <Select name="role" defaultValue="MEMBER">
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Org admin</option>
              </Select>
            </Field>
            <SubmitButton>Add person</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
