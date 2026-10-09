import nodemailer from "nodemailer";
import { hubConfig } from "./env.js";

export interface Notification {
  subject: string;
  text: string;
  url?: string;
  slackWebhookUrl?: string | null;
  emails?: string[];
}

export type Notifier = (n: Notification) => Promise<void>;

let transport: nodemailer.Transporter | null = null;

export const defaultNotifier: Notifier = async (n) => {
  const cfg = hubConfig();
  const tasks: Promise<unknown>[] = [];
  const slack = n.slackWebhookUrl || cfg.slackWebhookUrl;
  if (slack) {
    tasks.push(
      fetch(slack, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `*${n.subject}*\n${n.text}${n.url ? `\n<${n.url}|Open in Hub>` : ""}` }),
      }),
    );
  }
  const to = (n.emails ?? []).filter(Boolean);
  if (cfg.smtpUrl && to.length) {
    transport ??= nodemailer.createTransport(cfg.smtpUrl);
    tasks.push(
      transport.sendMail({
        from: cfg.smtpFrom,
        to,
        subject: n.subject,
        text: `${n.text}${n.url ? `\n\n${n.url}` : ""}`,
      }),
    );
  }
  const results = await Promise.allSettled(tasks);
  for (const r of results) if (r.status === "rejected") console.warn("[notify] delivery failed:", r.reason);
};

let override: Notifier | null = null;

export function notifier(): Notifier {
  return override ?? defaultNotifier;
}

export function setNotifier(next: Notifier | null): void {
  override = next;
}
