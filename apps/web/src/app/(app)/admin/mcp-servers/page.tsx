import Link from "next/link";
import { prisma } from "@hub/db";
import { Badge, Card, EmptyState, Flash, PageHeader, Table, Td } from "@/components/ui";
import { requireAdmin } from "@/lib/session";
import { McpForm } from "./mcp-form";

export default async function McpServersPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { org } = await requireAdmin();
  const [servers, departments] = await Promise.all([
    prisma.mcpServer.findMany({
      where: { orgId: org.id },
      include: { department: true, _count: { select: { agents: true } } },
      orderBy: { slug: "asc" },
    }),
    prisma.department.findMany({ where: { orgId: org.id }, orderBy: { key: "asc" } }),
  ]);
  return (
    <>
      <PageHeader
        title="MCP server catalog"
        subtitle="Tools that liaison agents can use. Each department attaches the servers its agent needs on the project's Agents page."
      />
      <Flash searchParams={await searchParams} />
      <div className="space-y-6">
        <Card title="Catalog">
          {servers.length ? (
            <Table head={["Server", "Owner", "Transport", "Tools", "Used by"]}>
              {servers.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <Link href={`/admin/mcp-servers/${s.id}`} className="font-medium text-indigo-700 hover:underline">
                      {s.name}
                    </Link>
                    <div className="text-xs text-slate-500">{s.url ?? s.image}</div>
                  </Td>
                  <Td>{s.department?.name ?? "Shared"}</Td>
                  <Td>
                    <Badge>{s.transport.toLowerCase()}</Badge>{" "}
                    <Badge tone={s.access === "READ_ONLY" ? "green" : "amber"}>{s.access === "READ_ONLY" ? "read-only" : "read/write"}</Badge>
                  </Td>
                  <Td className="text-xs text-slate-600">
                    {s.readTools.length || "all"} read, {s.writeTools.length} write
                  </Td>
                  <Td className="text-xs">{s._count.agents} agents</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="No MCP servers yet">Add the tools your teams already use, such as Kubernetes, Terraform state, Vault or your CI system.</EmptyState>
          )}
        </Card>
        <Card title="Add MCP server">
          <McpForm departments={departments} />
        </Card>
      </div>
    </>
  );
}
