import { listInbox, listRequests } from "@hub/core";
import { prisma } from "@hub/db";
import { RequestTable } from "@/components/request-table";
import { Card, Flash, LinkButton, PageHeader, Stat } from "@/components/ui";
import { formatMinutes, formatPercent, requestMetrics } from "@/lib/metrics";
import { getOrgContext } from "@/lib/session";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { user, org, isAdmin } = await getOrgContext();
  const projectIds = (await prisma.projectMember.findMany({ where: { userId: user.id }, select: { projectId: true } })).map((m) => m.projectId);
  const scope = isAdmin ? { project: { orgId: org.id } } : { projectId: { in: projectIds } };
  const [inbox, mine, metrics, tokens] = await Promise.all([
    listInbox(user),
    listRequests({ askerId: user.id }, 10),
    requestMetrics(scope),
    prisma.apiToken.count({ where: { userId: user.id, revokedAt: null } }),
  ]);

  return (
    <>
      <PageHeader
        title={`Hi ${user.name?.split(" ")[0] ?? user.login}`}
        subtitle="Questions your Claude Code sent to other teams, and the ones waiting on you."
        actions={tokens === 0 ? <LinkButton href="/get-started" variant="primary">Connect Claude Code</LinkButton> : undefined}
      />
      <Flash searchParams={await searchParams} />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Waiting on you" value={inbox.length} />
        <Stat label="Requests (30d)" value={metrics.total} hint={isAdmin ? "Whole organization" : "Your projects"} />
        <Stat label="Answered by agents" value={formatPercent(metrics.agentShare)} hint={`${metrics.answeredByAgent} answers without a person`} />
        <Stat label="Median time to answer" value={formatMinutes(metrics.medianMinutesToAnswer)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Waiting on you" actions={<LinkButton href="/inbox" size="sm">Open inbox</LinkButton>}>
          <RequestTable requests={inbox.slice(0, 8)} showProject empty="Nothing needs you right now." />
        </Card>
        <Card title="Your recent questions">
          <RequestTable requests={mine} showProject empty="You haven't asked anything yet." />
        </Card>
      </div>
    </>
  );
}
