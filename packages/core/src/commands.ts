export type CommentCommand =
  | { kind: "approve"; note?: string }
  | { kind: "reject"; reason: string }
  | { kind: "close" }
  | { kind: "reopen" }
  | { kind: "message"; body: string };

/** Slash commands people can type in a Discussion comment. Anything else is a normal reply. */
export function parseCommentCommand(body: string): CommentCommand {
  const text = body.trim();
  const match = /^\/(approve|reject|close|reopen)\b[ \t]*([\s\S]*)$/i.exec(text);
  if (!match) return { kind: "message", body: text };
  const rest = match[2].trim();
  switch (match[1].toLowerCase()) {
    case "approve":
      return { kind: "approve", note: rest || undefined };
    case "reject":
      return { kind: "reject", reason: rest || "Rejected without a reason" };
    case "close":
      return { kind: "close" };
    default:
      return { kind: "reopen" };
  }
}
