import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { hubConfig } from "./env.js";

export const QUEUE_NAME = "hub";

export interface JobPayloads {
  "request.created": { requestId: string };
  "request.dispatch": { requestId: string };
  "request.execute": { requestId: string };
  "request.escalate": { requestId: string; reason: string };
  "message.post": { messageId: string };
  "discussion.close": { requestId: string };
  "github.event": { event: string; deliveryId: string; payload: unknown };
  "project.reconcile": { projectId: string };
  "requests.sweep": Record<string, never>;
}

export type JobName = keyof JobPayloads;

export type JobSink = <N extends JobName>(name: N, data: JobPayloads[N]) => Promise<void>;

let sink: JobSink | null = null;
let queue: Queue | null = null;
let connection: IORedis | null = null;

export function redisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(hubConfig().redisUrl, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: redisConnection() as unknown as ConnectionOptions,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return queue;
}

/** Tests (and the worker's inline mode) can replace Redis with a direct dispatcher. */
export function setJobSink(next: JobSink | null): void {
  sink = next;
}

export async function enqueue<N extends JobName>(name: N, data: JobPayloads[N]): Promise<void> {
  if (sink) return sink(name, data);
  await getQueue().add(name, data);
}

export async function closeQueue(): Promise<void> {
  await queue?.close();
  connection?.disconnect();
  queue = null;
  connection = null;
}
