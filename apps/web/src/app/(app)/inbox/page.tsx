import { listInbox } from "@hub/core";
import { RequestTable } from "@/components/request-table";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/session";

export default async function InboxPage() {
  const user = await requireUser();
  const inbox = await listInbox(user);
  const approvals = inbox.filter((r) => r.status === "AWAITING_APPROVAL");
  const escalations = inbox.filter((r) => r.status === "ESCALATED");
  return (
    <>
      <PageHeader
        title="My inbox"
        subtitle="Requests your team's agent couldn't answer alone. Your Claude Code sees the same list through hub-mcp's inbox tool."
      />
      <div className="space-y-6">
        <Card title={`Approvals (${approvals.length})`}>
          <RequestTable requests={approvals} showProject empty="No changes waiting for your approval." />
        </Card>
        <Card title={`Escalated questions (${escalations.length})`}>
          <RequestTable requests={escalations} showProject empty="No escalated questions for your team." />
        </Card>
      </div>
    </>
  );
}
