import { createServer, type IncomingMessage, type Server } from "node:http";
import { enqueue, hubConfig, verifyWebhookSignature } from "@hub/core";

const HANDLED_EVENTS = new Set(["discussion", "discussion_comment"]);

function readBody(req: IncomingMessage, limit = 5 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function startServer(port: number): Server {
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === "GET" && (req.url === "/healthz" || req.url === "/readyz")) return send(200, { ok: true });

      if (req.method === "POST" && req.url?.startsWith("/webhooks/github")) {
        const raw = await readBody(req);
        const secret = hubConfig().github.webhookSecret;
        if (!verifyWebhookSignature(raw, req.headers["x-hub-signature-256"] as string | undefined, secret)) {
          return send(401, { error: "invalid signature" });
        }
        const event = String(req.headers["x-github-event"] ?? "");
        const deliveryId = String(req.headers["x-github-delivery"] ?? "");
        if (!HANDLED_EVENTS.has(event)) return send(202, { ignored: event });
        await enqueue("github.event", { event, deliveryId, payload: JSON.parse(raw.toString("utf8")) });
        return send(202, { queued: true });
      }

      send(404, { error: "not found" });
    } catch (err) {
      console.error("[server]", err);
      send(500, { error: "internal error" });
    }
  });
  server.listen(port, () => console.log(`[worker] webhook server listening on :${port}`));
  return server;
}
