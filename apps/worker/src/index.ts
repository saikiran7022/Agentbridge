import { Worker, type ConnectionOptions, type Job } from "bullmq";
import {
  QUEUE_NAME,
  closeQueue,
  defaultDeps,
  enqueue,
  escalate,
  getQueue,
  hubConfig,
  processDiscussionClose,
  processDispatch,
  processExecute,
  processGithubEvent,
  processMessagePost,
  processRequestCreated,
  processSweep,
  redisConnection,
  type JobName,
  type JobPayloads,
} from "@hub/core";
import { prisma } from "@hub/db";
import { reconcileProject } from "./reconcile.js";
import { startServer } from "./server.js";

async function handle(job: Job): Promise<unknown> {
  const deps = defaultDeps();
  const name = job.name as JobName;
  switch (name) {
    case "request.created":
      return processRequestCreated((job.data as JobPayloads["request.created"]).requestId, deps);
    case "request.dispatch":
      return processDispatch((job.data as JobPayloads["request.dispatch"]).requestId, deps);
    case "request.execute":
      return processExecute((job.data as JobPayloads["request.execute"]).requestId, deps);
    case "request.escalate": {
      const d = job.data as JobPayloads["request.escalate"];
      return escalate(d.requestId, d.reason, deps);
    }
    case "message.post":
      return processMessagePost((job.data as JobPayloads["message.post"]).messageId, deps);
    case "discussion.close":
      return processDiscussionClose((job.data as JobPayloads["discussion.close"]).requestId, deps);
    case "github.event": {
      const d = job.data as JobPayloads["github.event"];
      return processGithubEvent(d.event, d.payload, deps);
    }
    case "project.reconcile":
      return reconcileProject((job.data as JobPayloads["project.reconcile"]).projectId);
    case "requests.sweep":
      return processSweep(deps);
    default:
      console.warn(`[worker] unknown job ${job.name}`);
  }
}

async function main() {
  const cfg = hubConfig();
  console.log(`[worker] agent mode: ${cfg.agentMode}; kube apply: ${cfg.kagent.kubeApply}; kagent: ${cfg.kagent.url}`);

  const worker = new Worker(QUEUE_NAME, handle, {
    connection: redisConnection() as unknown as ConnectionOptions,
    concurrency: 8,
  });
  worker.on("failed", async (job, err) => {
    console.error(`[worker] ${job?.name} failed (attempt ${job?.attemptsMade}):`, err.message);
    const maxAttempts = job?.opts.attempts ?? 1;
    if (job && job.attemptsMade >= maxAttempts && job.name.startsWith("request.") && job.name !== "request.escalate") {
      const requestId = (job.data as { requestId?: string }).requestId;
      if (requestId) await enqueue("request.escalate", { requestId, reason: `Processing failed: ${err.message}` });
    }
  });
  worker.on("completed", (job) => console.log(`[worker] ${job.name} done`));

  await getQueue().upsertJobScheduler("requests-sweep", { every: 60_000 }, { name: "requests.sweep", data: {} });

  const server = startServer(Number(process.env.WORKER_PORT ?? 4000));

  const shutdown = async () => {
    console.log("[worker] shutting down");
    server.close();
    await worker.close();
    await closeQueue();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
