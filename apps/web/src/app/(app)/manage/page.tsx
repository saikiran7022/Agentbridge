import { prisma } from "@hub/db";
import { Avatar, AvatarStack, toneAt } from "@/components/avatar";
import { LiveFilter } from "@/components/live-filter";
import { Popover } from "@/components/popover";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card, EmptyState, Field, Flash, Input, LinkButton, PageHeader, Select, TimeAgo, cx } from "@/components/ui";
import { requireAdmin } from "@/lib/session";
import { addPerson, addToTeam, assignToProject, decideJoin, deleteTeam, removeFromTeam, saveTeam, unassignFromProject } from "./actions";

const ROLE_TONE = { OWNER: "violet", APPROVER: "green", CONTRIBUTOR: "blue", VIEWER: "gray" } as const;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Section({ id, title, subtitle, actions, children }: { id: string; title: string; subtitle: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export default async function ManagePage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { org } = await requireAdmin();
  const [teams, people, projects, joinRequests] = await Promise.all([
    prisma.department.findMany({
      where: { orgId: org.id },
      orderBy: { name: "asc" },
      include: { _count: { select: { agents: true } }, teamMembers: { include: { user: true }, orderBy: { createdAt: "asc" } } },
    }),
    prisma.orgMember.findMany({
      where: { orgId: org.id },
      orderBy: { user: { login: "asc" } },
      include: { user: { include: { teamMemberships: { include: { department: true } } } }, department: true },
    }),
    prisma.project.findMany({
      where: { orgId: org.id, archived: false },
      orderBy: { name: "asc" },
      include: { members: { include: { user: true } }, agents: true },
    }),
    prisma.teamJoinRequest.findMany({
      where: { orgId: org.id, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: { user: true, department: true },
    }),
  ]);

  const projectsPerTeam = new Map<string, number>();
  for (const p of projects) for (const id of new Set(p.members.map((m) => m.departmentId))) projectsPerTeam.set(id, (projectsPerTeam.get(id) ?? 0) + 1);
  const unassigned = people.filter((m) => m.user.teamMemberships.length === 0).length;
  const gaps = projects.reduce((n, p) => n + teams.filter((t) => !p.members.some((m) => m.departmentId === t.id)).length, 0);

  return (
    <>
      <PageHeader
        title="Manage workspace"
        subtitle="Teams, people and projects in one place. Add a team, drop people onto projects, and spot teams a project is missing."
        actions={<LinkButton href="/projects/new" variant="primary">New project</LinkButton>}
      />
      <Flash searchParams={await searchParams} />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Teams", value: teams.length, href: "#teams", hint: `${teams.reduce((n, t) => n + t._count.agents, 0)} liaison agents` },
          { label: "People", value: people.length, href: "#people", hint: unassigned ? `${unassigned} not on a team` : "Everyone is on a team" },
          { label: "Join requests", value: joinRequests.length, href: "#requests", hint: joinRequests.length ? "Waiting for you" : "All caught up" },
          { label: "Coverage gaps", value: gaps, href: "#projects", hint: gaps ? "Teams missing from projects" : "Every team is staffed" },
        ].map((s) => (
          <a key={s.label} href={s.href} className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:border-indigo-300 hover:shadow">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{s.label}</div>
            <div className={cx("mt-1 text-3xl font-semibold", (s.label === "Coverage gaps" || s.label === "Join requests") && s.value > 0 && "text-amber-600")}>{s.value}</div>
            <div className="mt-0.5 text-xs text-slate-500">{s.hint}</div>
          </a>
        ))}
      </div>

      <div className="space-y-12">
        {/* ---- Join requests ---- */}
        <Section id="requests" title="Join requests" subtitle="People who signed up and asked to join a team. Only org admins can approve.">
          {joinRequests.length === 0 ? (
            <EmptyState title="No pending requests">When someone asks to join a team it shows up here.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {joinRequests.map((r) => (
                <li key={r.id} className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
                  <form action={decideJoin} className="flex flex-wrap items-center gap-4">
                    <input type="hidden" name="requestId" value={r.id} />
                    <Avatar name={r.user.login} src={r.user.avatarUrl} size="md" />
                    <div className="min-w-0 flex-1 basis-60">
                      <p className="text-sm">
                        <strong>{r.user.name ?? r.user.login}</strong> <span className="text-slate-500">@{r.user.login}</span> wants to join{" "}
                        <strong>{r.department.name}</strong>
                      </p>
                      {r.message && <p className="mt-1 text-sm italic text-slate-600">"{r.message}"</p>}
                      <p className="mt-1 text-xs text-slate-500"><TimeAgo date={r.createdAt} /></p>
                    </div>
                    <div className="w-full sm:w-56">
                      <Input name="note" placeholder="Note (optional)" />
                    </div>
                    <div className="flex gap-2">
                      <SubmitButton name="decision" value="approve" size="sm">Approve</SubmitButton>
                      <SubmitButton name="decision" value="reject" size="sm" variant="secondary">Decline</SubmitButton>
                    </div>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ---- Teams ---- */}
        <Section id="teams" title="Teams" subtitle="Each team gets a liaison agent on every project it joins.">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {teams.map((t, i) => (
              <div key={t.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-base font-bold text-white", toneAt(i))}>
                    {t.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{t.name}</h3>
                    <code className="text-xs text-slate-400">{t.key}</code>
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 min-h-10 text-sm text-slate-600">{t.description || "No description yet."}</p>
                <div className="mt-4 flex items-center justify-between">
                  <AvatarStack people={t.teamMembers.map((m) => ({ name: m.user.login, src: m.user.avatarUrl }))} />
                  <div className="text-right text-xs text-slate-500">
                    {plural(t.teamMembers.length, "person").replace("persons", "people")} · {plural(projectsPerTeam.get(t.id) ?? 0, "project")}
                  </div>
                </div>
                <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
                  <Popover label="Edit">
                    <form action={saveTeam} className="space-y-3">
                      <input type="hidden" name="id" value={t.id} />
                      <Field label="Name">
                        <Input name="name" defaultValue={t.name} required />
                      </Field>
                      <Field label="Description">
                        <Input name="description" defaultValue={t.description} />
                      </Field>
                      <SubmitButton size="sm">Save team</SubmitButton>
                    </form>
                  </Popover>
                  <form action={deleteTeam}>
                    <input type="hidden" name="id" value={t.id} />
                    <SubmitButton size="sm" variant="ghost" confirm={`Delete the ${t.name} team?`}>Delete</SubmitButton>
                  </form>
                </div>
              </div>
            ))}
            <details className="group rounded-xl border-2 border-dashed border-slate-300 bg-white/50 p-5 open:border-indigo-400 open:bg-white">
              <summary className="flex cursor-pointer list-none flex-col items-center justify-center gap-1 py-6 text-sm font-medium text-slate-500 group-open:hidden hover:text-indigo-700 [&::-webkit-details-marker]:hidden">
                <span className="text-2xl leading-none">+</span>
                New team
              </summary>
              <form action={saveTeam} className="space-y-3">
                <Field label="Team name">
                  <Input name="name" placeholder="Data Platform" required />
                </Field>
                <Field label="Short key" hint="Optional. Used by agents, e.g. data">
                  <Input name="key" placeholder="data" />
                </Field>
                <Field label="What does this team own?">
                  <Input name="description" placeholder="Warehouses, pipelines and BI" />
                </Field>
                <SubmitButton>Create team</SubmitButton>
              </form>
            </details>
          </div>
        </Section>

        {/* ---- Projects x teams ---- */}
        <Section id="projects" title="Projects and who covers them" subtitle="Amber cells are teams with nobody on that project. Click + to add someone.">
          {projects.length === 0 || teams.length === 0 ? (
            <EmptyState title={projects.length ? "Create a team first" : "No projects yet"}>
              {projects.length ? "Teams become the columns of this view." : "Create a project and it appears here."}
            </EmptyState>
          ) : (
            <Card className="overflow-visible [&>div]:p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left">
                      <th className="sticky left-0 z-10 min-w-48 bg-white px-5 py-3 text-xs font-medium uppercase tracking-wide text-slate-500">Project</th>
                      {teams.map((t, i) => (
                        <th key={t.id} className="min-w-48 px-4 py-3">
                          <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                            <span className={cx("h-2.5 w-2.5 rounded-full bg-gradient-to-br", toneAt(i))} />
                            {t.name}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {projects.map((p) => {
                      const covered = teams.filter((t) => p.members.some((m) => m.departmentId === t.id)).length;
                      return (
                        <tr key={p.id}>
                          <td className="sticky left-0 z-10 bg-white px-5 py-4 align-top">
                            <a href={`/projects/${p.slug}`} className="font-semibold hover:text-indigo-700">{p.name}</a>
                            <div className="mt-1">
                              <Badge tone={covered === teams.length ? "green" : "amber"}>
                                {covered}/{teams.length} teams
                              </Badge>
                            </div>
                          </td>
                          {teams.map((t) => {
                            const here = p.members.filter((m) => m.departmentId === t.id);
                            return (
                              <td key={t.id} className={cx("px-4 py-3 align-top", here.length === 0 && "bg-amber-50/60")}>
                                <ul className="space-y-1.5">
                                  {here.map((m) => (
                                    <li key={m.id} className="group/member flex items-center gap-2">
                                      <Avatar name={m.user.login} src={m.user.avatarUrl} size="xs" />
                                      <span className="min-w-0 flex-1 truncate">{m.user.login}</span>
                                      <Badge tone={ROLE_TONE[m.role]}>{m.role.toLowerCase()}</Badge>
                                      <form action={unassignFromProject} className="opacity-0 transition group-hover/member:opacity-100 focus-within:opacity-100">
                                        <input type="hidden" name="id" value={m.id} />
                                        <button type="submit" aria-label={`Remove ${m.user.login}`} className="rounded px-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600">×</button>
                                      </form>
                                    </li>
                                  ))}
                                </ul>
                                <Popover inline label={here.length ? "+" : "+ Add person"} className={here.length ? "mt-2" : ""}>
                                  <form action={assignToProject} className="space-y-3">
                                    <input type="hidden" name="slug" value={p.slug} />
                                    <input type="hidden" name="departmentId" value={t.id} />
                                    <p className="text-sm font-medium">
                                      Add to {t.name} on {p.name}
                                    </p>
                                    <Input name="login" placeholder="GitHub login" list="people-logins" required />
                                    <Select name="role" defaultValue={here.length ? "CONTRIBUTOR" : "APPROVER"}>
                                      <option value="OWNER">Owner</option>
                                      <option value="APPROVER">Approver</option>
                                      <option value="CONTRIBUTOR">Contributor</option>
                                      <option value="VIEWER">Viewer</option>
                                    </Select>
                                    <SubmitButton size="sm">Add</SubmitButton>
                                  </form>
                                </Popover>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          <datalist id="people-logins">
            {people.map((m) => (
              <option key={m.id} value={m.user.login} />
            ))}
          </datalist>
        </Section>

        {/* ---- People ---- */}
        <Section
          id="people"
          title="People"
          subtitle="Everyone in the organization and the team they belong to."
          actions={
            <div className="flex items-center gap-2">
              <LiveFilter target="#people-list" placeholder="Search people" />
              <Popover label="+ Add person" align="right">
                <form action={addPerson} className="space-y-3">
                  <Field label="GitHub login">
                    <Input name="login" placeholder="octocat" required />
                  </Field>
                  <Field label="Name">
                    <Input name="name" />
                  </Field>
                  <Field label="Team">
                    <Select name="departmentId" defaultValue="">
                      <option value="">No team yet</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </Select>
                  </Field>
                  <SubmitButton size="sm">Add person</SubmitButton>
                </form>
              </Popover>
            </div>
          }
        >
          <div id="people-list" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {people.map((m) => (
              <div
                key={m.id}
                data-filter-item={`${m.user.login} ${m.user.name ?? ""} ${m.department?.name ?? ""}`.toLowerCase()}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <Avatar name={m.user.login} src={m.user.avatarUrl} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{m.user.name ?? m.user.login}</span>
                      {m.role === "ADMIN" && <Badge tone="violet">admin</Badge>}
                    </div>
                    <div className="truncate text-xs text-slate-500">@{m.user.login}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {m.user.teamMemberships.length === 0 && <span className="text-xs text-slate-400">Not on a team yet</span>}
                  {m.user.teamMemberships.map((tm) => (
                    <form key={tm.id} action={removeFromTeam} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-xs font-medium text-slate-700">
                      <input type="hidden" name="userId" value={m.userId} />
                      <input type="hidden" name="departmentId" value={tm.departmentId} />
                      {tm.department.name}
                      <button type="submit" aria-label={`Remove ${m.user.login} from ${tm.department.name}`} className="rounded-full px-1 text-slate-400 hover:bg-rose-100 hover:text-rose-600">×</button>
                    </form>
                  ))}
                  {teams.some((t) => !m.user.teamMemberships.some((tm) => tm.departmentId === t.id)) && (
                    <Popover label="+ Team">
                      <form action={addToTeam} className="space-y-3">
                        <input type="hidden" name="userId" value={m.userId} />
                        <p className="text-sm font-medium">Add {m.user.login} to a team</p>
                        <Select name="departmentId" defaultValue="">
                          <option value="" disabled>Choose a team...</option>
                          {teams
                            .filter((t) => !m.user.teamMemberships.some((tm) => tm.departmentId === t.id))
                            .map((t) => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                        </Select>
                        <SubmitButton size="sm">Add</SubmitButton>
                      </form>
                    </Popover>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <details className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold">Who can do what</summary>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">How you get it</th>
                  <th className="px-3 py-2 font-medium">What you can do</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[
                  ["Org admin", "Keycloak role hub-admin, or set on People", "Create, edit and delete teams. Approve join requests. Put anyone on a team or a project. Manage MCP servers and skills."],
                  ["Team member", "Request to join, then an admin approves", "Be added to projects on behalf of that team. Start a project for that team."],
                  ["Project owner", "Starts a project, or is made owner", "Manage the project: people from their own teams, agents, settings."],
                  ["Approver", "Project role", "Approve or reject changes agents propose for their team."],
                  ["Contributor / Viewer", "Project role", "Answer requests for their team / read only."],
                ].map(([role, how, can]) => (
                  <tr key={role}>
                    <td className="px-3 py-2 font-medium">{role}</td>
                    <td className="px-3 py-2 text-slate-600">{how}</td>
                    <td className="px-3 py-2 text-slate-600">{can}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </>
  );
}
