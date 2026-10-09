import Link from "next/link";
import { listInbox, listRequests, pendingJoinRequestCount } from "@hub/core";
import { prisma } from "@hub/db";
import { AvatarStack, toneAt } from "@/components/avatar";
import { RequestTable } from "@/components/request-table";
import { Badge, Card, Flash, LinkButton, PageHeader, Stat, cx } from "@/components/ui";
import { dailyRequestCounts, formatMinutes, formatPercent, requestMetrics } from "@/lib/metrics";
import { getOrgContext } from "@/lib/session";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { user, org, isAdmin } = await getOrgContext();
  const memberships = await prisma.projectMember.findMany({ where: { userId: user.id }, include: { project: true } });
  const projectIds = memberships.map((m) => m.projectId);
  const scope = isAdmin ? { project: { orgId: org.id } } : { projectId: { in: projectIds } };
  const [inbox, mine, metrics, daily, tokens, myTeams, joinRequests, pendingMine] = await Promise.all([
    listInbox(user),
    listRequests({ askerId: user.id }, 8),
    requestMetrics(scope),
    dailyRequestCounts(scope, 14),
    prisma.apiToken.count({ where: { userId: user.id, revokedAt: null } }),
    prisma.teamMember.findMany({ where: { userId: user.id }, include: { department: { include: { teamMembers: { include: { user: true } } } } } }),
    isAdmin ? pendingJoinRequestCount(org.id) : Promise.resolve(0),
    prisma.teamJoinRequest.count({ where: { userId: user.id, status: "PENDING" } }),
  ]);
  const peak = Math.max(1, ...daily.map((d) => d.total));
  const total14 = daily.reduce((n, d) => n + d.total, 0);
  const first = user.name?.split(" ")[0] ?? user.login;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${first}`}
        subtitle={isAdmin ? "Here's how the whole organization is doing." : "Questions your Claude Code sent to other teams, and the ones waiting on you."}
        actions={
          <>
            {tokens === 0 && <LinkButton href="/get-started" variant="secondary">Connect Claude Code</LinkButton>}
            <LinkButton href="/projects/new" variant="primary">New project</LinkButton>
          </>
        }
      />
      <Flash searchParams={await searchParams} />

      {isAdmin && joinRequests > 0 && (
        <Link href="/manage#requests" className="mb-4 flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-5 py-3 text-sm text-amber-900 shadow-sm hover:shadow">
          <span>
            <strong>{joinRequests}</strong> {joinRequests === 1 ? "person is" : "people are"} waiting to join a team.
          </span>
          <span className="font-medium">Review →</span>
        </Link>
      )}
      {myTeams.length === 0 && (
        <Link href="/teams" className="mb-4 flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-3 text-sm text-indigo-900 shadow-sm hover:shadow">
          <span>
            {pendingMine > 0 ? "Your request to join a team is waiting for an admin." : "You aren't on a team yet. Request to join the teams you work in."}
          </span>
          <span className="font-medium">{pendingMine > 0 ? "View" : "Choose teams"} →</span>
        </Link>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Waiting on you" value={inbox.length} hint={inbox.length ? "Open your inbox" : "Nothing needs you"} />
        <Stat label="Requests (30d)" value={metrics.total} hint={isAdmin ? "Whole organization" : "Your projects"} />
        <Stat label="Answered by agents" value={formatPercent(metrics.agentShare)} hint={`${metrics.answeredByAgent} answers without a person`} />
        <Stat label="Median time to answer" value={formatMinutes(metrics.medianMinutesToAnswer)} />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card title="Requests, last 14 days" actions={<span className="text-xs text-slate-500">{total14} total</span>} className="lg:col-span-2">
          <div className="flex h-40 items-end gap-1.5" role="img" aria-label={`Requests per day over the last 14 days, ${total14} in total`}>
            {daily.map((d) => (
              <div key={d.day} className="group flex h-full flex-1 flex-col justify-end" title={`${d.label}: ${d.total} requests, ${d.byAgent} answered by agents`}>
                <div className="relative w-full overflow-hidden rounded-t bg-indigo-200 transition group-hover:bg-indigo-300" style={{ height: `${Math.max((d.total / peak) * 100, d.total ? 6 : 2)}%` }}>
                  <div className="absolute inset-x-0 bottom-0 bg-indigo-600" style={{ height: `${d.total ? (d.byAgent / d.total) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-slate-500">
            <span>{daily[0]?.label}</span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-indigo-600" /> answered by an agent</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-indigo-200" /> other</span>
            </span>
            <span>{daily.at(-1)?.label}</span>
          </div>
        </Card>

        <Card title="Your teams" actions={<Link href="/teams" className="text-xs font-medium text-indigo-700 hover:underline">Browse teams</Link>}>
          {myTeams.length ? (
            <ul className="space-y-3">
              {myTeams.map((tm, i) => (
                <li key={tm.id} className="flex items-center gap-3">
                  <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-sm font-bold text-white", toneAt(i))}>
                    {tm.department.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{tm.department.name}</span>
                    <span className="text-xs text-slate-500">{tm.department.teamMembers.length} {tm.department.teamMembers.length === 1 ? "member" : "members"}</span>
                  </span>
                  <AvatarStack max={3} people={tm.department.teamMembers.map((m) => ({ name: m.user.login, src: m.user.avatarUrl }))} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No teams yet.</p>
          )}
          {memberships.length > 0 && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Your projects</div>
              <div className="flex flex-wrap gap-1.5">
                {memberships.map((m) => (
                  <Link key={m.id} href={`/projects/${m.project.slug}`}>
                    <Badge tone="blue">{m.project.name}</Badge>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2" title="Waiting on you" actions={<LinkButton href="/inbox" size="sm">Open inbox</LinkButton>}>
          <RequestTable requests={inbox.slice(0, 6)} showProject empty="Nothing needs you right now." />
        </Card>
        <Card className="lg:col-span-3" title="Your recent questions">
          <RequestTable requests={mine} showProject empty="You haven't asked anything yet." />
        </Card>
      </div>
    </>
  );
}
