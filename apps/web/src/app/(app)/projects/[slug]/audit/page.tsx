import Link from "next/link";
import { prisma } from "@hub/db";
import { Card, EmptyState, Table, Td, TimeAgo } from "@/components/ui";
import { requireProject } from "@/lib/session";

export default async function AuditPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { project } = await requireProject(slug);
  const events = await prisma.auditEvent.findMany({
    where: { projectId: project.id },
    include: { actorUser: true, request: { select: { id: true, number: true } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return (
    <Card title="Audit log" actions={<span className="text-xs text-slate-500">Latest {events.length} events</span>}>
      {events.length ? (
        <Table head={["When", "Actor", "Action", "Request", "Details"]}>
          {events.map((e) => (
            <tr key={e.id}>
              <Td className="whitespace-nowrap text-xs text-slate-500">
                <TimeAgo date={e.createdAt} />
              </Td>
              <Td className="text-xs">{e.actorType === "HUMAN" ? e.actorUser?.login : e.actorType === "AGENT" ? e.actorAgent : "system"}</Td>
              <Td>
                <code className="text-xs">{e.action}</code>
              </Td>
              <Td className="text-xs">
                {e.request && (
                  <Link href={`/projects/${slug}/requests/${e.request.id}`} className="text-indigo-700 hover:underline">
                    #{e.request.number}
                  </Link>
                )}
              </Td>
              <Td>
                <code className="block max-w-md truncate text-xs text-slate-500" title={JSON.stringify(e.data)}>
                  {JSON.stringify(e.data)}
                </code>
              </Td>
            </tr>
          ))}
        </Table>
      ) : (
        <EmptyState title="Nothing recorded yet" />
      )}
    </Card>
  );
}
