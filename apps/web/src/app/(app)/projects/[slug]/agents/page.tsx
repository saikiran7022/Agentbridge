import { agentResourceName } from "@hub/agent-templates";
import { hubConfig } from "@hub/core";
import { prisma } from "@hub/db";
import { Badge, Card, Checkbox, Field, Flash, Input, LinkButton, Select, StatusBadge, Textarea, TimeAgo } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireProject } from "@/lib/session";
import { addAgent, saveAgent, syncAgents } from "../../actions";
import { WizardSteps } from "../../wizard-steps";

const AUTONOMY_HELP = {
  READ_ONLY: "Read tools only. Changes are handed to a person on the team.",
  APPROVAL_FOR_WRITES: "Read tools only. Proposed changes go to an approver; once approved, a separate executor agent with write tools carries them out.",
  AUTONOMOUS: "Read and write tools. Use only for low-risk teams and servers.",
};

export default async function AgentsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { slug } = await params;
  const { project, org, canManage } = await requireProject(slug);
  const cfg = hubConfig();
  const [agents, servers, skills, departments] = await Promise.all([
    prisma.liaisonAgent.findMany({
      where: { projectId: project.id },
      include: { department: true, mcpServers: true, skills: true },
      orderBy: { department: { key: "asc" } },
    }),
    prisma.mcpServer.findMany({ where: { orgId: org.id }, include: { department: true }, orderBy: { slug: "asc" } }),
    prisma.skill.findMany({ where: { orgId: org.id, audience: { in: ["AGENT", "BOTH"] } }, include: { department: true }, orderBy: { slug: "asc" } }),
    prisma.department.findMany({ where: { orgId: org.id }, orderBy: { key: "asc" } }),
  ]);
  const missing = departments.filter((d) => !agents.some((a) => a.departmentId === d.id));

  return (
    <>
      {canManage && <WizardSteps current={3} slug={slug} />}
      <Flash searchParams={await searchParams} />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm shadow-sm">
        <div>
          Agent mode: <Badge tone={cfg.agentMode === "kagent" ? "green" : "gray"}>{cfg.agentMode}</Badge>{" "}
          {cfg.kagent.kubeApply ? (
            <>applied to namespace <code>{cfg.kagent.namespace}</code></>
          ) : (
            <>manifests are rendered only (set <code>HUB_KUBE_APPLY=true</code> to apply them automatically)</>
          )}
          {project.routerEnabled && (
            <div className="mt-1 text-xs text-slate-500">
              Router agent: <code>{agentResourceName(slug, "", "router")}</code> handles questions sent without a team.
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <LinkButton href={`/projects/${slug}/agents/manifests`}>View manifests</LinkButton>
          {canManage && (
            <form action={syncAgents}>
              <input type="hidden" name="slug" value={slug} />
              <SubmitButton>Sync to kagent</SubmitButton>
            </form>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {agents.map((a) => (
          <Card
            key={a.id}
            title={
              <span className="flex items-center gap-2">
                {a.department.name} liaison agent <code className="text-xs font-normal text-slate-500">{agentResourceName(slug, a.department.key)}</code>
              </span>
            }
            actions={
              <span className="flex items-center gap-2 text-xs text-slate-500">
                {a.lastSyncedAt && <TimeAgo date={a.lastSyncedAt} />}
                <StatusBadge status={a.syncStatus} />
              </span>
            }
          >
            {a.syncError && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">{a.syncError}</p>}
            <form action={saveAgent} className="space-y-4">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="agentId" value={a.id} />
              <fieldset disabled={!canManage} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="md:col-span-2">
                    <Field label="Autonomy" hint={AUTONOMY_HELP[a.autonomy]}>
                      <Select name="autonomy" defaultValue={a.autonomy}>
                        <option value="READ_ONLY">Read-only</option>
                        <option value="APPROVAL_FOR_WRITES">Approval required for changes</option>
                        <option value="AUTONOMOUS">Autonomous</option>
                      </Select>
                    </Field>
                  </div>
                  <Field label="Confidence threshold" hint="Below this, a person checks the answer">
                    <Input name="confidenceThreshold" type="number" step="0.05" min="0" max="1" defaultValue={a.confidenceThreshold} />
                  </Field>
                  <Field label="Model" hint={`Default: ${cfg.kagent.defaultModel}`}>
                    <Input name="model" defaultValue={a.model ?? ""} placeholder={cfg.kagent.defaultModel} />
                  </Field>
                  <Field label="Max agent attempts" hint="Per request, before escalating">
                    <Input name="maxHops" type="number" min="1" max="10" defaultValue={a.maxHops} />
                  </Field>
                  <Field label="Token budget" hint="Per request, before escalating">
                    <Input name="maxTokens" type="number" min="1000" step="1000" defaultValue={a.maxTokens} />
                  </Field>
                  <div className="flex items-end pb-2 md:col-span-2">
                    <Checkbox name="enabled" defaultChecked={a.enabled} label="Enabled" hint="Disabled agents are removed from kagent and requests go to people" />
                  </div>
                </div>
                <Field label="Team instructions" hint="What this team owns and how it wants questions answered. Leave empty for the default.">
                  <Textarea name="systemPrompt" rows={4} defaultValue={a.systemPrompt} placeholder={`You know the project's ${a.department.name.toLowerCase()} setup...`} />
                </Field>
                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <div className="mb-2 text-sm font-medium text-slate-700">MCP servers (tools)</div>
                    {servers.length ? (
                      <div className="space-y-2">
                        {servers.map((s) => (
                          <Checkbox
                            key={s.id}
                            name="mcpServerIds"
                            value={s.id}
                            defaultChecked={a.mcpServers.some((m) => m.mcpServerId === s.id)}
                            label={s.name}
                            hint={`${s.department?.name ?? "Shared"}, ${s.access === "READ_ONLY" ? "read-only" : "read/write"}`}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">No MCP servers in the catalog yet. An org admin can add them.</p>
                    )}
                  </div>
                  <div>
                    <div className="mb-2 text-sm font-medium text-slate-700">Skills (knowledge)</div>
                    {skills.length ? (
                      <div className="space-y-2">
                        {skills.map((s) => (
                          <Checkbox
                            key={s.id}
                            name="skillIds"
                            value={s.id}
                            defaultChecked={a.skills.some((x) => x.skillId === s.id)}
                            label={s.name}
                            hint={s.department?.name ?? "Shared"}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">No skills in the library yet.</p>
                    )}
                  </div>
                </div>
                {canManage && <SubmitButton>Save and sync</SubmitButton>}
              </fieldset>
            </form>
          </Card>
        ))}

        {canManage && missing.length > 0 && (
          <Card title="Add a team agent">
            <form action={addAgent} className="flex items-end gap-2">
              <input type="hidden" name="slug" value={slug} />
              <Field label="Department">
                <Select name="departmentId">
                  {missing.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </Select>
              </Field>
              <SubmitButton variant="secondary">Add agent</SubmitButton>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
