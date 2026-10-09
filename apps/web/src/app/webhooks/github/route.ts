import { NextResponse, type NextRequest } from "next/server";
import { enqueue, hubConfig, verifyWebhookSignature } from "@hub/core";

const HANDLED_EVENTS = new Set(["discussion", "discussion_comment"]);

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get("x-hub-signature-256") ?? undefined, hubConfig().github.webhookSecret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  const event = req.headers.get("x-github-event") ?? "";
  if (!HANDLED_EVENTS.has(event)) return NextResponse.json({ ignored: event }, { status: 202 });
  await enqueue("github.event", {
    event,
    deliveryId: req.headers.get("x-github-delivery") ?? "",
    payload: JSON.parse(raw),
  });
  return NextResponse.json({ queued: true }, { status: 202 });
}
