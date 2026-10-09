import { notFound } from "next/navigation";
import { canAnswer, canApprove, DONE_STATES } from "@hub/core";
import { prisma } from "@hub/db";
import { Badge, Card, Field, Flash, Input, ProgressBar, StatusBadge, Textarea, TimeAgo, cx } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireProject } from "@/lib/session";
import { approveAction, closeAction, rejectAction, replyAction } from "../../../actions";

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { slug, id } = await params;
  const { project, membership, user } = await requireProject(slug);
  const r = await prisma.request.findFirst({
    where: { id, projectId: project.id },
    include: {
      asker: true,
      targetDepartment: true,
      resolvedDepartment: true,
      answeredBy: true,
      approvedBy: true,
      messages: { include: { authorUser: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!r) notFound();

  const teamId = r.resolvedDepartmentId ?? r.targetDepartmentId;
  const agent = teamId
    ? await prisma.liaisonAgent.findUnique({
        where: { projectId_departmentId: { projectId: project.id, departmentId: teamId } },
        select: { maxTokens: true },
      })
    : null;

  const isAsker = r.askerId === user.id;
  const mayAnswer = canAnswer(membership, r) && !isAsker;
  const mayApprove = canApprove(membership, r) && r.status === "AWAITING_APPROVAL";
  const done = DONE_STATES.includes(r.status);
  const hidden = (
    <>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="requestId" value={r.id} />
    </>
  );

  return (
    <>
      <Flash searchParams={await searchParams} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card
            title={
              <span className="flex items-center gap-2">
                <span className="text-slate-400">#{r.number}</span> {r.title}
              </span>
            }
            actions={<StatusBadge status={r.status} />}
          >
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{r.question}</div>
            {r.context && (
              <div className="mt-4 rounded-lg bg-slate-50 p-3">
                <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Context</div>
                <div className="whitespace-pre-wrap text-sm text-slate-700">{r.context}</div>
              </div>
            )}
            {r.statusReason && !done && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{r.statusReason}</p>}
          </Card>

          {r.answer && (
            <Card
              title={r.answeredByAgent ? "Answer from the liaison agent" : `Answer from ${r.answeredBy?.login ?? "a team member"}`}
              actions={r.confidence != null ? <Badge tone="green">confidence {Math.round(r.confidence * 100)}%</Badge> : undefined}
            >
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{r.answer}</div>
            </Card>
          )}

          {r.proposedAction && (
            <Card title="Proposed change" actions={r.approvedBy ? <Badge tone="violet">approved by {r.approvedBy.login}</Badge> : undefined}>
              <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">{r.proposedAction}</pre>
              {r.rejectReason && <p className="mt-2 text-sm text-rose-700">Rejected: {r.rejectReason}</p>}
              {mayApprove && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <form action={approveAction} className="space-y-2">
                    {hidden}
                    <Input name="note" placeholder="Note (optional)" />
                    <SubmitButton>Approve and let the agent do it</SubmitButton>
                  </form>
                  <form action={rejectAction} className="space-y-2">
                    {hidden}
                    <Input name="reason" placeholder="Reason" required />
                    <SubmitButton variant="danger">Reject</SubmitButton>
                  </form>
                </div>
              )}
            </Card>
          )}

          <Card title="Thread">
            {r.messages.length ? (
              <ol className="space-y-4">
                {r.messages.map((m) => (
                  <li key={m.id} className="flex gap-3">
                    <span
                      className={cx(
                        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                        m.authorType === "AGENT" ? "bg-indigo-100 text-indigo-700" : m.authorType === "SYSTEM" ? "bg-slate-100 text-slate-500" : "bg-emerald-100 text-emerald-700",
                      )}
                    >
                      {m.authorType === "AGENT" ? "AI" : m.authorType === "SYSTEM" ? "--" : (m.authorUser?.login ?? m.authorAgent ?? "?").slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-slate-500">
                        <span className="font-medium text-slate-700">{m.authorType === "AGENT" ? m.authorAgent : (m.authorUser?.login ?? m.authorAgent ?? "system")}</span>{" "}
                        <TimeAgo date={m.createdAt} />
                        {m.githubCommentId && <span className="ml-1">(synced to GitHub)</span>}
                      </div>
                      <div className={cx("whitespace-pre-wrap text-sm", m.authorType === "SYSTEM" && "italic text-slate-500")}>{m.body}</div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-slate-500">No messages yet.</p>
            )}

            {(mayAnswer || isAsker) && r.status !== "CLOSED" && (
              <form action={replyAction} className="mt-6 space-y-2 border-t border-slate-100 pt-4">
                {hidden}
                <Field
                  label={isAsker ? "Follow up" : "Answer"}
                  hint={isAsker ? "Adds context and sends the request back to the agent" : "Your reply answers the request and is posted to the Discussion"}
                >
                  <Textarea name="body" rows={4} className="font-sans text-sm" required />
                </Field>
                <SubmitButton>{isAsker ? "Send follow-up" : "Post answer"}</SubmitButton>
              </form>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Details">
            <dl className="space-y-2 text-sm">
              <Row label="Asked by">{r.asker.login}{r.askerClient ? ` via ${r.askerClient}` : ""}</Row>
              <Row label="Team">{r.resolvedDepartment?.name ?? r.targetDepartment?.name ?? "Router"}</Row>
              <Row label="Created"><TimeAgo date={r.createdAt} /></Row>
              {r.answeredAt && <Row label="Answered"><TimeAgo date={r.answeredAt} /></Row>}
              <Row label="Agent attempts">{r.hops}</Row>
              {!agent && <Row label="Tokens used">{r.tokensUsed.toLocaleString()}</Row>}
              {r.discussionUrl && (
                <Row label="Discussion">
                  <a href={r.discussionUrl} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">
                    GitHub #{r.discussionNumber}
                  </a>
                </Row>
              )}
            </dl>
            {agent && (
              <div className="mt-4">
                <div className="mb-1 text-sm text-slate-500">Token budget</div>
                <ProgressBar value={r.tokensUsed} max={agent.maxTokens} />
              </div>
            )}
          </Card>
          {(isAsker || mayAnswer) && r.status !== "CLOSED" && (
            <Card title="Actions">
              <form action={closeAction}>
                {hidden}
                <SubmitButton variant="secondary">Close request</SubmitButton>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
