import type { HubProject, HubRequest } from "./api.js";

const NEXT_STEP: Record<string, (r: HubRequest) => string> = {
  OPEN: (r) => `The ${r.teamName ?? "team"} agent is working on it. Call wait_for with request ${r.number}.`,
  ROUTING: (r) => `The router is picking a team. Call wait_for with request ${r.number}.`,
  IN_PROGRESS: (r) => `An agent is working on it. Call wait_for with request ${r.number}.`,
  ESCALATED: (r) =>
    `A person from ${r.teamName ?? "the project"} has been asked to answer. Continue with other work and check later with get_answer ${r.number}.`,
  AWAITING_APPROVAL: () => "The agent proposed a change that an approver must accept first. Check later with get_answer.",
  APPROVED: () => "Approved; the change is being carried out. Check later with get_answer.",
  ANSWERED: () => "If the answer is not enough, use follow_up to send details back.",
  REJECTED: () => "The proposed change was rejected; see the reason above.",
  CLOSED: () => "This request is closed.",
  FAILED: () => "Processing failed; ask again or contact the team directly.",
};

export function formatRequest(r: HubRequest, opts: { includeThread?: boolean } = {}): string {
  const by = r.answeredBy === "agent" ? "the liaison agent" : r.answeredBy;
  const lines = [
    `Request #${r.number} [${r.status}] for ${r.teamName ?? "router"} in project ${r.project}`,
    `Title: ${r.title}`,
  ];
  if (r.statusReason && !r.done) lines.push(`Note: ${r.statusReason}`);
  if (r.answer) {
    lines.push(
      "",
      `Answer${by ? ` from ${by}` : ""}${r.confidence != null ? ` (confidence ${Math.round(r.confidence * 100)}%)` : ""}:`,
      r.answer,
    );
  }
  if (r.proposedAction) lines.push("", "Proposed change:", r.proposedAction);
  if (r.rejectReason) lines.push("", `Rejected: ${r.rejectReason}`);
  if (opts.includeThread && r.messages.length) {
    lines.push("", "Thread:");
    for (const m of r.messages) lines.push(`- ${m.author} (${m.authorType.toLowerCase()}): ${m.body}`);
  }
  lines.push("", NEXT_STEP[r.status]?.(r) ?? "", `Hub: ${r.url}${r.discussionUrl ? ` | Discussion: ${r.discussionUrl}` : ""}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function formatRequestList(rs: HubRequest[], empty: string): string {
  if (!rs.length) return empty;
  return rs
    .map((r) => `#${r.number} [${r.status}] ${r.project}/${r.teamName ?? "router"}: ${r.title} (asked by ${r.askedBy})`)
    .join("\n");
}

export function formatProjects(ps: HubProject[]): string {
  if (!ps.length) return "You are not a member of any project in the Hub yet. Ask a project owner to add you.";
  return ps
    .map((p) => {
      const teams = p.teams
        .map((t) => `  - ${t.key} (${t.name}): ${t.agent?.enabled ? `agent ${t.agent.status.toLowerCase()}` : "no agent"}; people: ${t.people.map((x) => x.login).join(", ") || "none"}`)
        .join("\n");
      return `${p.slug}: ${p.name} (you: ${p.myTeam}, ${p.myRole.toLowerCase()})${p.description ? `\n  ${p.description}` : ""}\n${teams}`;
    })
    .join("\n\n");
}
