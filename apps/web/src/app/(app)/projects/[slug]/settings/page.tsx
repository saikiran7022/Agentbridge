import { githubConfigured, hubConfig } from "@hub/core";
import { prisma } from "@hub/db";
import { Badge, Card, Checkbox, Field, Flash, Input, Table, Td, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireProject } from "@/lib/session";
import { checkDiscussions, saveProjectSettings, setArchived } from "../../actions";
import { WizardSteps } from "../../wizard-steps";

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { slug } = await params;
  const { project, org } = await requireProject(slug, { manage: true });
  const [agents, skills, projectSkills] = await Promise.all([
    prisma.liaisonAgent.findMany({ where: { projectId: project.id }, include: { department: true }, orderBy: { department: { key: "asc" } } }),
    prisma.skill.findMany({ where: { orgId: org.id, audience: { in: ["HUMAN", "BOTH"] } }, orderBy: { slug: "asc" } }),
    prisma.projectSkill.findMany({ where: { projectId: project.id } }),
  ]);
  const ghReady = githubConfigured();
  const webhookUrl = `${hubConfig().hubUrl}/webhooks/github`;

  return (
    <>
      <WizardSteps current={4} slug={slug} />
      <Flash searchParams={await searchParams} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Project settings">
            <form action={saveProjectSettings} className="space-y-4">
              <input type="hidden" name="slug" value={slug} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name">
                  <Input name="name" defaultValue={project.name} />
                </Field>
                <Field label="GitHub repository" hint="owner/repo with Discussions enabled">
                  <Input name="repo" defaultValue={project.githubOwner ? `${project.githubOwner}/${project.githubRepo}` : ""} placeholder="acme/payments" />
                </Field>
              </div>
              <Field label="Description">
                <Textarea name="description" rows={3} className="font-sans text-sm" defaultValue={project.description} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Fallback Discussions category" hint="Used for teams without their own category">
                  <Input name="fallbackCategory" defaultValue={project.fallbackCategory} />
                </Field>
                <Field label="Slack webhook (optional)" hint="Escalations and approval requests are posted here">
                  <Input name="slackWebhookUrl" defaultValue={project.slackWebhookUrl ?? ""} placeholder="https://hooks.slack.com/services/..." />
                </Field>
              </div>
              <Checkbox name="routerEnabled" defaultChecked={project.routerEnabled} label="Router agent" hint="Lets people ask without choosing a team; the router picks the right liaison agent" />
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">Skills installed into members' Claude Code</div>
                {skills.length ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {skills.map((s) => (
                      <Checkbox key={s.id} name="skillIds" value={s.id} defaultChecked={projectSkills.some((p) => p.skillId === s.id)} label={s.name} hint={s.description} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No people-facing skills in the library yet. Everyone always gets the built-in hub-liaison skill.</p>
                )}
              </div>
              <SubmitButton>Save settings</SubmitButton>
            </form>
          </Card>

          <Card
            title="GitHub Discussions"
            actions={ghReady ? <Badge tone="green">GitHub App configured</Badge> : <Badge tone="amber">GitHub App not configured</Badge>}
          >
            <p className="mb-3 text-sm text-slate-600">
              Every request becomes a Discussion thread. GitHub's API can't create categories, so create one per team in the repository's
              Discussions settings (names below). Teams without a category use <strong>{project.fallbackCategory}</strong>.
            </p>
            <Table head={["Team", "Expected category", "Matched"]}>
              {agents.map((a) => (
                <tr key={a.id}>
                  <Td>{a.department.name}</Td>
                  <Td>
                    <code className="text-xs">{a.department.name}</code>
                  </Td>
                  <Td>{a.discussionCategoryName ? <Badge tone="green">{a.discussionCategoryName}</Badge> : <Badge>fallback</Badge>}</Td>
                </tr>
              ))}
            </Table>
            <form action={checkDiscussions} className="mt-4">
              <input type="hidden" name="slug" value={slug} />
              <SubmitButton variant="secondary">Check repository and categories</SubmitButton>
            </form>
            <p className="mt-4 text-xs text-slate-500">
              GitHub App webhook: subscribe to <code>Discussion</code> and <code>Discussion comment</code> events and point it at{" "}
              <code>{webhookUrl}</code>. Replies and <code>/approve</code>, <code>/reject</code>, <code>/close</code> comments flow back into the Hub.
            </p>
          </Card>
        </div>

        <Card title={project.archived ? "Restore project" : "Archive project"}>
          <p className="mb-3 text-sm text-slate-600">
            {project.archived ? "Restoring redeploys the project's agents." : "Archiving removes the project's agents from kagent and stops new requests."}
          </p>
          <form action={setArchived}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="archived" value={project.archived ? "false" : "true"} />
            <SubmitButton variant={project.archived ? "secondary" : "danger"} confirm={project.archived ? undefined : "Archive this project?"}>
              {project.archived ? "Restore" : "Archive"}
            </SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
