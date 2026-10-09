import { prisma } from "@hub/db";
import { Card, Field, Flash, Input, PageHeader, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireAdmin } from "@/lib/session";
import { deleteDepartment, saveDepartment } from "../actions";

export default async function DepartmentsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { org } = await requireAdmin();
  const departments = await prisma.department.findMany({
    where: { orgId: org.id },
    orderBy: { key: "asc" },
    include: { _count: { select: { projectMembers: true, agents: true } } },
  });
  return (
    <>
      <PageHeader title="Departments" subtitle="Teams that contribute people and a liaison agent to projects." />
      <Flash searchParams={await searchParams} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="All departments" className="lg:col-span-2">
          <Table head={["Key", "Name and description", "Usage", ""]}>
            {departments.map((d) => (
              <tr key={d.id}>
                <Td>
                  <code className="text-xs">{d.key}</code>
                </Td>
                <Td>
                  <form action={saveDepartment} className="flex flex-col gap-2">
                    <input type="hidden" name="id" value={d.id} />
                    <input type="hidden" name="key" value={d.key} />
                    <Input name="name" defaultValue={d.name} />
                    <Input name="description" defaultValue={d.description} placeholder="Description" />
                    <div>
                      <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
                    </div>
                  </form>
                </Td>
                <Td className="whitespace-nowrap text-xs text-slate-500">
                  {d._count.projectMembers} members
                  <br />
                  {d._count.agents} agents
                </Td>
                <Td>
                  <form action={deleteDepartment}>
                    <input type="hidden" name="id" value={d.id} />
                    <SubmitButton size="sm" variant="ghost" confirm={`Delete ${d.name}?`}>Delete</SubmitButton>
                  </form>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Add department">
          <form action={saveDepartment} className="space-y-3">
            <Field label="Name">
              <Input name="name" placeholder="Data Platform" required />
            </Field>
            <Field label="Key" hint="Short id used by agents and hub-mcp, e.g. data">
              <Input name="key" placeholder="data" />
            </Field>
            <Field label="Description">
              <Input name="description" placeholder="Warehouses, pipelines and BI" />
            </Field>
            <SubmitButton>Add department</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
