import { hubConfig } from "./env.js";

export const HUB_MARKER = "<!-- agent-liaison-hub -->";

export function requestUrl(projectSlug: string, requestId: string): string {
  return `${hubConfig().hubUrl}/projects/${projectSlug}/requests/${requestId}`;
}

export function deriveTitle(question: string): string {
  const first = question.trim().split(/\r?\n/)[0] ?? "";
  const clean = first.replace(/\s+/g, " ").trim();
  return clean.length > 90 ? `${clean.slice(0, 87)}...` : clean || "Question";
}

export function discussionTitle(input: { number: number; title: string; departmentName?: string | null }): string {
  return `[${input.departmentName ?? "Triage"}] ${input.title} (#${input.number})`;
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
}

export function questionBody(input: {
  askerLogin: string;
  askerClient?: string | null;
  departmentName?: string | null;
  question: string;
  context?: string;
  projectSlug: string;
  requestId: string;
  number: number;
}): string {
  const lines = [
    HUB_MARKER,
    `**Asked by:** \`${input.askerLogin}\`${input.askerClient ? ` via ${input.askerClient}` : ""}`,
    `**For:** ${input.departmentName ?? "Router (department not specified)"}`,
    `**Hub request:** [#${input.number}](${requestUrl(input.projectSlug, input.requestId)})`,
    "",
    "### Question",
    input.question,
  ];
  if (input.context?.trim()) lines.push("", "### Context", input.context.trim());
  lines.push(
    "",
    "---",
    "_The liaison agent answers first. Team members can reply here to answer; approvers can comment `/approve` or `/reject <reason>`._",
  );
  return lines.join("\n");
}

export function agentAnswerBody(input: { agentName: string; answer: string; confidence?: number | null }): string {
  const conf = input.confidence != null ? ` (confidence ${Math.round(input.confidence * 100)}%)` : "";
  return `${HUB_MARKER}\n**Answer from \`${input.agentName}\`**${conf}\n\n${input.answer}`;
}

export function escalationBody(input: { reason: string; mentions: string[]; draft?: string | null; proposedAction?: string | null }): string {
  const who = input.mentions.length ? input.mentions.map((m) => `@${m}`).join(" ") : "Project owners";
  const lines = [HUB_MARKER, `**Needs a human:** ${who}`, "", `Reason: ${input.reason}`];
  if (input.proposedAction) lines.push("", "**Proposed change:**", quote(input.proposedAction));
  if (input.draft) lines.push("", "**Agent's draft (unverified):**", quote(input.draft));
  lines.push("", "_Reply in this thread to answer._");
  return lines.join("\n");
}

export function approvalBody(input: { mentions: string[]; proposedAction: string; answer?: string }): string {
  const who = input.mentions.length ? input.mentions.map((m) => `@${m}`).join(" ") : "Approvers";
  const lines = [HUB_MARKER, `**Approval needed:** ${who}`, "", "**Proposed change:**", quote(input.proposedAction)];
  if (input.answer && input.answer !== input.proposedAction) lines.push("", input.answer);
  lines.push("", "Comment `/approve` to let the agent carry it out, or `/reject <reason>`.");
  return lines.join("\n");
}

export function humanMessageBody(input: { login: string; body: string; via: string }): string {
  return `${HUB_MARKER}\n**\`${input.login}\`** (via ${input.via}):\n\n${input.body}`;
}

export function systemBody(text: string): string {
  return `${HUB_MARKER}\n_${text}_`;
}
