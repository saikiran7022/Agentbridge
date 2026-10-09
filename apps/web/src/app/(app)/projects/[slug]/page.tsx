import Link from "next/link";
import { listRequests, hubConfig, githubConfigured } from "@hub/core";
import { prisma, type RequestStatus } from "@hub/db";
import { RequestTable } from "@/components/request-table";
import { Card, Field, Flash, Select, Stat, Textarea, cx } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { formatMinutes, formatPercent, requestMetrics } from "@/lib/metrics";
import { requireProject } from "@/lib/session";
import { askQuestion } from "../actions";

const FILTERS: { label: string; statuses?: RequestStatus[] }[] = [
  { label: "All" },
  { label: "Waiting on people", statuses: ["ESCALATED", "AWAITING_APPROVAL"] },
  { label: "In progress", statuses: ["OPEN", "ROUTING", "IN_PROGRESS", "APPROVED"] },
  { label: "Answered", statuses: ["ANSWERED"] },
  { label: "Closed", statuses: ["CLOSED", "REJECTED", "FAILED"] },
];

export default async function ProjectOverview({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ok?: string; error?: string; filter?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { project, canManage } = await requireProject(slug);
  const filter = FILTERS.find((f) => f.label === sp.filter) ?? FILTERS[0];

  const [requests, metrics, agents, members, tokens] = await Promise.all([
    listRequests({ projectId: project.id, ...(filter.statuses ? { status: { in: filter.statuses } } : {}) }, 100),
    requestMetrics({ projectId: project.id }),
    prisma.liaisonAgent.findMany({ where: { projectId: project.id }, include: { department: true }, orderBy: { department: { key: "asc" } } }),
    prisma.projectMember.findMany({ where: { projectId: project.id }, include: { user: true } }),
    prisma.apiToken.count({ where: { revokedAt: null, user: { projectMemberships: { some: { projectId: project.id } } } } }),
  ]);

  const teamsWithoutPeople = agents.filter((a) => !members.some((m) => m.departmentId === a.departmentId));
  const agentMode = hubConfig().agentMode;
  const checklist = [
    { done: teamsWithoutPeople.length === 0, label: "Every team has at least one person", detail: teamsWithoutPeople.map((a) => a.department.name).join(", "), href: `/projects/${slug}/members` },
    {
      done: agents.some((a) => a.syncStatus === "SYNCED" || a.syncStatus === "RENDERED"),
      label: agentMode === "kagent" ? "Liaison agents are deployed to kagent" : "Liaison agents configured (agent mode is off; humans answer)",
      detail: agents.filter((a) => a.syncStatus === "ERROR").map((a) => `${a.department.name}: error`).join(", "),
      href: `/projects/${slug}/agents`,
    },
    {
      done: Boolean(project.githubOwner && project.githubRepositoryId),
      label: "GitHub Discussions connected",
      detail: !githubConfigured() ? "GitHub App not configured on the Hub" : project.githubOwner ? "Run the category check" : "No repository linked",
      href: `/projects/${slug}/settings`,
    },
    { done: tokens > 0, label: "Team members connected Claude Code", detail: `${tokens} active tokens`, href: `/get-started?project=${slug}` },
  ];

  return (
    <>
      <Flash searchParams={sp} />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Requests (30d)" value={metrics.total} hint={`${metrics.last7Days} in the last 7 days`} />
        <Stat label="Answered by agents" value={formatPercent(metrics.agentShare)} hint={`${metrics.answeredByAgent} of ${metrics.answered} answers`} />
        <Stat label="Median time to answer" value={formatMinutes(metrics.medianMinutesToAnswer)} />
        <Stat label="Waiting on people" value={metrics.waitingOnPeople} hint={`${metrics.open} still with agents`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card
            title="Requests"
            actions={
              <div className="flex gap-1">
                {FILTERS.map((f) => (
                  <Link
                    key={f.label}
                    href={`/projects/${slug}?filter=${encodeURIComponent(f.label)}`}
                    className={cx("rounded-md px-2 py-1 text-xs", f === filter ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:bg-slate-100")}
                  >
                    {f.label}
                  </Link>
                ))}
              </div>
            }
          >
            <RequestTable requests={requests} empty="No requests yet. Ask from Claude Code with hub-mcp, or use the form." />
          </Card>
          {metrics.byTeam.length > 0 && (
            <Card title="By team (30 days)">
              <div className="space-y-2">
                {metrics.byTeam.map((t) => (
                  <div key={t.team} className="flex items-center gap-3 text-sm">
                    <span className="w-32 shrink-0 truncate">{t.team}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full bg-emerald-500" style={{ width: `${(t.byAgent / Math.max(t.total, 1)) * 100}%` }} />
                    </div>
                    <span className="w-40 text-right text-xs text-slate-500">
                      {t.byAgent}/{t.total} by agent{t.waiting ? `, ${t.waiting} waiting` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Ask a team">
            <form action={askQuestion} className="space-y-3">
              <input type="hidden" name="slug" value={slug} />
              <Field label="Team">
                <Select name="team" defaultValue="">
                  <option value="">Not sure (let the router decide)</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.department.key}>{a.department.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Question">
                <Textarea name="question" rows={4} className="font-sans text-sm" placeholder="Which Vault path holds the staging DB credentials?" required />
              </Field>
              <Field label="Context (optional)">
                <Textarea name="context" rows={2} className="font-sans text-sm" placeholder="What you're working on, file paths, errors..." />
              </Field>
              <SubmitButton>Ask</SubmitButton>
            </form>
          </Card>
          <Card title="Setup checklist">
            <ul className="space-y-3 text-sm">
              {checklist.map((c) => (
                <li key={c.label} className="flex gap-2">
                  <span className={cx("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] text-white", c.done ? "bg-emerald-500" : "bg-slate-300")}>
                    {c.done ? "✓" : ""}
                  </span>
                  <span>
                    {canManage || c.href.startsWith("/get-started") ? (
                      <Link href={c.href} className="hover:text-indigo-700">{c.label}</Link>
                    ) : (
                      c.label
                    )}
                    {!c.done && c.detail && <span className="block text-xs text-slate-500">{c.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
