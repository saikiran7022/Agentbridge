import { hubConfig } from "@hub/core";
import { prisma } from "@hub/db";
import { Card, PageHeader, Pre, Table, Td, TimeAgo } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getOrgContext } from "@/lib/session";
import { WizardSteps } from "../projects/wizard-steps";
import { revokeTokenAction } from "./actions";
import { TokenCreator } from "./token-creator";

export default async function GetStartedPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { user } = await getOrgContext();
  const sp = await searchParams;
  const hubUrl = hubConfig().hubUrl;
  const [tokens, memberships] = await Promise.all([
    prisma.apiToken.findMany({ where: { userId: user.id, revokedAt: null }, orderBy: { createdAt: "desc" } }),
    prisma.projectMember.findMany({ where: { userId: user.id }, include: { project: true, department: true } }),
  ]);
  const project = sp.project ?? memberships[0]?.project.slug ?? "<project>";

  const mcpJson = JSON.stringify(
    {
      mcpServers: {
        hub: {
          type: "http",
          url: `${hubUrl}/api/mcp`,
          headers: { Authorization: "Bearer ${HUB_TOKEN}" },
        },
      },
    },
    null,
    2,
  );

  return (
    <>
      <PageHeader title="Connect Claude Code" subtitle="Two commands. Your Claude Code can then ask other teams' agents and answer for yours." />
      {sp.project && <WizardSteps current={5} slug={sp.project} />}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="1. Log in and set up your repository">
            <p className="mb-3 text-sm text-slate-600">Run these in the repository you work in. They open your browser to approve a token, write <code>.mcp.json</code>, and install the project's skills under <code>.claude/skills/</code>.</p>
            <Pre>{`npx @hub/cli login --url ${hubUrl}\nnpx @hub/cli init --project ${project}`}</Pre>
            <p className="mt-3 text-sm text-slate-600">
              Then restart Claude Code (VS Code extension or CLI). Try: <em>"Ask infra which Vault path holds the staging database credentials."</em>
            </p>
          </Card>
          <Card title="Or configure it by hand">
            <p className="mb-3 text-sm text-slate-600">
              Create a token on the right, export it as <code>HUB_TOKEN</code>, and add the hosted MCP server to <code>.mcp.json</code>:
            </p>
            <Pre>{mcpJson}</Pre>
            <p className="mt-3 text-sm text-slate-600">Or with the Claude Code CLI:</p>
            <Pre>{`claude mcp add --transport http hub ${hubUrl}/api/mcp --header "Authorization: Bearer $HUB_TOKEN"`}</Pre>
            <p className="mt-3 text-xs text-slate-500">
              Prefer a local process? <code>npx @hub/mcp</code> runs the same tools over stdio using <code>HUB_URL</code> and <code>HUB_TOKEN</code>.
            </p>
          </Card>
          <Card title="What your Claude Code can do">
            <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
              <li><code>ask</code>: send a question to a team (or let the router pick one) and get a request id back</li>
              <li><code>wait_for</code> / <code>get_answer</code>: wait for or check the answer</li>
              <li><code>follow_up</code>: add details to your request and send it back to the agent</li>
              <li><code>inbox</code>: escalations and approvals waiting on you</li>
              <li><code>reply</code>, <code>approve</code>, <code>reject</code>: answer for your team or approve a proposed change</li>
            </ul>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="API tokens">
            <TokenCreator />
            {tokens.length > 0 && (
              <div className="mt-4">
                <Table head={["Token", "Last used", ""]}>
                  {tokens.map((t) => (
                    <tr key={t.id}>
                      <Td>
                        <div className="text-sm">{t.name}</div>
                        <code className="text-xs text-slate-500">{t.prefix}...</code>
                      </Td>
                      <Td className="text-xs text-slate-500">{t.lastUsedAt ? <TimeAgo date={t.lastUsedAt} /> : "never"}</Td>
                      <Td>
                        <form action={revokeTokenAction}>
                          <input type="hidden" name="id" value={t.id} />
                          <SubmitButton size="sm" variant="ghost">Revoke</SubmitButton>
                        </form>
                      </Td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}
          </Card>
          <Card title="Your projects">
            {memberships.length ? (
              <ul className="space-y-1 text-sm">
                {memberships.map((m) => (
                  <li key={m.id}>
                    <code>{m.project.slug}</code> <span className="text-slate-500">({m.department.name}, {m.role.toLowerCase()})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">You're not on a project yet.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
