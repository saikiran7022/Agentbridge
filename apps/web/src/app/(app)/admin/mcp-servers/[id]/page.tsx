import { notFound } from "next/navigation";
import { prisma } from "@hub/db";
import { Card, Flash, LinkButton, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireAdmin } from "@/lib/session";
import { deleteMcpServer } from "../../actions";
import { McpForm } from "../mcp-form";

export default async function EditMcpServerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { org } = await requireAdmin();
  const { id } = await params;
  const [server, departments] = await Promise.all([
    prisma.mcpServer.findFirst({ where: { id, orgId: org.id }, include: { agents: { include: { agent: { include: { project: true, department: true } } } } } }),
    prisma.department.findMany({ where: { orgId: org.id }, orderBy: { key: "asc" } }),
  ]);
  if (!server) notFound();
  return (
    <>
      <PageHeader
        title={server.name}
        subtitle={`Used by ${server.agents.length} liaison agents`}
        actions={<LinkButton href="/admin/mcp-servers">Back to catalog</LinkButton>}
      />
      <Flash searchParams={await searchParams} />
      <div className="space-y-6">
        <Card title="Settings">
          <McpForm server={server} departments={departments} />
        </Card>
        {server.agents.length > 0 && (
          <Card title="Used by">
            <ul className="list-inside list-disc text-sm">
              {server.agents.map(({ agent }) => (
                <li key={agent.id}>
                  {agent.project.name}: {agent.department.name} agent
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card title="Danger zone">
          <form action={deleteMcpServer}>
            <input type="hidden" name="id" value={server.id} />
            <SubmitButton variant="danger" confirm="Delete this MCP server? Agents using it lose these tools on next sync.">
              Delete MCP server
            </SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
