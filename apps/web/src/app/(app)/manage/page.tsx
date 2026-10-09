import { prisma } from "@hub/db";
import { Avatar, AvatarStack, toneAt } from "@/components/avatar";
import { LiveFilter } from "@/components/live-filter";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card, EmptyState, Field, Flash, Input, LinkButton, PageHeader, Select, cx } from "@/components/ui";
import { requireAdmin } from "@/lib/session";
import { addPerson, assignToProject, deleteTeam, moveToTeam, saveTeam, unassignFromProject } from "./actions";

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

/** A button that opens a small form panel, with no client JavaScript. */
function Popover({ label, align = "left", inline, children, className }: { label: React.ReactNode; align?: "left" | "right"; inline?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <details className={cx("group relative", className)}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 group-open:border-indigo-400 group-open:text-indigo-700 [&::-webkit-details-marker]:hidden">
        {label}
      </summary>
      <div
        className={cx(
          "mt-2 rounded-xl border border-slate-200 bg-white p-4",
          inline ? "w-full bg-slate-50" : cx("absolute z-20 w-72 shadow-xl", align === "right" ? "right-0" : "left-0"),
        )}
      >
        {children}
      </div>
    </details>
  );
}

export default async function ManagePage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { org } = await requireAdmin();
  const [teams, people, projects] = await Promise.all([
    prisma.department.findMany({
      where: { orgId: org.id },
      orderBy: { name: "asc" },
      include: { _count: { select: { agents: true } }, orgMembers: { include: { user: true } } },
    }),
    prisma.orgMember.findMany({
      where: { orgId: org.id },
      orderBy: { user: { login: "asc" } },
      include: { user: true, department: true },
    }),
    prisma.project.findMany({
      where: { orgId: org.id, archived: false },
      orderBy: { name: "asc" },
      include: { members: { include: { user: true } }, agents: true },
    }),
  ]);

  const projectsPerTeam = new Map<string, number>();
  for (const p of projects) for (const id of new Set(p.members.map((m) => m.departmentId))) projectsPerTeam.set(id, (projectsPerTeam.get(id) ?? 0) + 1);
  const unassigned = people.filter((m) => !m.departmentId).length;
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
          { label: "People", value: people.length, href: "#people", hint: unassigned ? `${unassigned} without a team` : "Everyone has a team" },
          { label: "Projects", value: projects.length, href: "#projects", hint: "Active" },
          { label: "Coverage gaps", value: gaps, href: "#projects", hint: gaps ? "Teams missing from projects" : "Every team is staffed" },
        ].map((s) => (
          <a key={s.label} href={s.href} className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:border-indigo-300 hover:shadow">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{s.label}</div>
            <div className={cx("mt-1 text-3xl font-semibold", s.label === "Coverage gaps" && s.value > 0 && "text-amber-600")}>{s.value}</div>
            <div className="mt-0.5 text-xs text-slate-500">{s.hint}</div>
          </a>
        ))}
      </div>

      <div className="space-y-12">
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
                  <AvatarStack people={t.orgMembers.map((m) => ({ name: m.user.login, src: m.user.avatarUrl }))} />
                  <div className="text-right text-xs text-slate-500">
                    {plural(t.orgMembers.length, "person").replace("persons", "people")} · {plural(projectsPerTeam.get(t.id) ?? 0, "project")}
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
                <form action={moveToTeam} className="mt-3 flex gap-2">
                  <input type="hidden" name="id" value={m.id} />
                  <Select name="departmentId" defaultValue={m.departmentId ?? ""} aria-label={`Team for ${m.user.login}`} className="py-1.5">
                    <option value="">No team</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </Select>
                  <SubmitButton size="sm" variant="secondary">Move</SubmitButton>
                </form>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
