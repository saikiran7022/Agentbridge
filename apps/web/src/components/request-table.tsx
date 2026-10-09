import Link from "next/link";
import type { RequestWithRelations } from "@hub/core";
import { Badge, EmptyState, StatusBadge, Table, Td, TimeAgo } from "./ui";

export function RequestTable({ requests, showProject, empty }: { requests: RequestWithRelations[]; showProject?: boolean; empty?: string }) {
  if (!requests.length) return <EmptyState title={empty ?? "No requests"} />;
  return (
    <Table head={["#", "Request", ...(showProject ? ["Project"] : []), "Team", "Status", "Asked"]}>
      {requests.map((r) => (
        <tr key={r.id} className="hover:bg-slate-50">
          <Td className="text-xs text-slate-500">{r.number}</Td>
          <Td>
            <Link href={`/projects/${r.project.slug}/requests/${r.id}`} className="font-medium text-slate-800 hover:text-indigo-700">
              {r.title}
            </Link>
            <div className="text-xs text-slate-500">
              by {r.asker.login}
              {r.answeredByAgent && r.status === "ANSWERED" && (
                <>
                  {" "}
                  <Badge tone="green">answered by agent</Badge>
                </>
              )}
            </div>
          </Td>
          {showProject && <Td className="text-xs">{r.project.name}</Td>}
          <Td className="text-xs">{r.resolvedDepartment?.name ?? r.targetDepartment?.name ?? "router"}</Td>
          <Td>
            <StatusBadge status={r.status} />
          </Td>
          <Td className="whitespace-nowrap text-xs text-slate-500">
            <TimeAgo date={r.createdAt} />
          </Td>
        </tr>
      ))}
    </Table>
  );
}
