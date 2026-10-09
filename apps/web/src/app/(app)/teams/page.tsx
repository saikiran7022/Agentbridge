import { prisma } from "@hub/db";
import { Avatar, AvatarStack, toneAt } from "@/components/avatar";
import { Popover } from "@/components/popover";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Field, Flash, PageHeader, Textarea, TimeAgo, cx } from "@/components/ui";
import { getOrgContext } from "@/lib/session";
import { cancelJoin, requestJoin } from "./actions";

export default async function TeamsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { user, org, isAdmin } = await getOrgContext();
  const [teams, mine, requests] = await Promise.all([
    prisma.department.findMany({
      where: { orgId: org.id },
      orderBy: { name: "asc" },
      include: { teamMembers: { include: { user: true }, orderBy: { createdAt: "asc" } } },
    }),
    prisma.teamMember.findMany({ where: { userId: user.id } }),
    prisma.teamJoinRequest.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, include: { department: true, decidedBy: true }, take: 20 }),
  ]);
  const memberOf = new Set(mine.map((m) => m.departmentId));
  const pending = new Map(requests.filter((r) => r.status === "PENDING").map((r) => [r.departmentId, r]));
  const history = requests.filter((r) => r.status === "APPROVED" || r.status === "REJECTED").slice(0, 5);

  return (
    <>
      <PageHeader
        title="Teams"
        subtitle={isAdmin ? "You can create teams and approve join requests from Manage." : "Join the teams you work in. An org admin approves each request."}
      />
      <Flash searchParams={await searchParams} />

      {memberOf.size === 0 && pending.size === 0 && (
        <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-4 text-sm text-indigo-900">
          <strong>Welcome, {user.name?.split(" ")[0] ?? user.login}.</strong> Your account is ready. Pick the teams you belong to below, and once an
          org admin approves, you can be added to their projects.
        </div>
      )}

      {teams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500">
          No teams exist yet. Only an org admin can create them.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {teams.map((t, i) => {
            const isMember = memberOf.has(t.id);
            const req = pending.get(t.id);
            return (
              <div key={t.id} className={cx("flex flex-col rounded-xl border bg-white p-5 shadow-sm", isMember ? "border-emerald-300" : "border-slate-200")}>
                <div className="flex items-start gap-3">
                  <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-base font-bold text-white", toneAt(i))}>
                    {t.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold">{t.name}</h3>
                    <p className="text-xs text-slate-500">{t.teamMembers.length} {t.teamMembers.length === 1 ? "member" : "members"}</p>
                  </div>
                  {isMember && <Badge tone="green">You're in</Badge>}
                  {req && <Badge tone="amber">Pending</Badge>}
                </div>
                <p className="mt-3 line-clamp-3 min-h-10 text-sm text-slate-600">{t.description || "No description yet."}</p>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <AvatarStack people={t.teamMembers.map((m) => ({ name: m.user.login, src: m.user.avatarUrl }))} />
                  {!isMember && !req && (
                    <Popover label="Request to join" align="right">
                      <form action={requestJoin} className="space-y-3">
                        <input type="hidden" name="departmentId" value={t.id} />
                        <p className="text-sm font-medium">Join {t.name}</p>
                        <Field label="Why this team? (optional)" hint="Helps the admin decide">
                          <Textarea name="message" rows={3} className="font-sans text-sm" placeholder="I run the staging clusters." />
                        </Field>
                        <SubmitButton size="sm">Send request</SubmitButton>
                      </form>
                    </Popover>
                  )}
                  {req && (
                    <form action={cancelJoin}>
                      <input type="hidden" name="requestId" value={req.id} />
                      <SubmitButton size="sm" variant="ghost">Cancel</SubmitButton>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {history.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Recent decisions</h2>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm shadow-sm">
            {history.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                {r.decidedBy && <Avatar name={r.decidedBy.login} src={r.decidedBy.avatarUrl} size="xs" />}
                <span className="flex-1">
                  <strong>{r.department.name}</strong>: {r.status === "APPROVED" ? "approved" : "declined"}
                  {r.decisionNote && <span className="text-slate-500"> · "{r.decisionNote}"</span>}
                </span>
                <Badge tone={r.status === "APPROVED" ? "green" : "red"}>{r.status.toLowerCase()}</Badge>
                {r.decidedAt && <span className="text-xs text-slate-500"><TimeAgo date={r.decidedAt} /></span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
