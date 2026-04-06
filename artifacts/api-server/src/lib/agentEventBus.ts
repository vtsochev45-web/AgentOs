/**
 * Agent Event Bus — decouples agent work from client SSE connections.
 *
 * Agents emit events to a per-job buffer. Clients subscribe to watch.
 * If a client disconnects and reconnects, they get the full replay.
 * Agent work continues regardless of client state.
 */

import { EventEmitter } from "events";
import { db } from "@workspace/db";
import { agentJobEventsTable } from "@workspace/db";

export interface AgentEvent {
  type: string;
  data: unknown;
  ts: number;
  jobId?: string;
}

interface Job {
  id: string;
  agentId: number;
  events: AgentEvent[];
  done: boolean;
  conversationId: number | null;
  startedAt: number;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

const jobs = new Map<string, Job>();
const activeJobs = new Map<number, string>(); // agentId → jobId

const JOB_TTL_MS = 5 * 60 * 1000;
const JOB_MAX_DURATION_MS = 5 * 60 * 1000; // watchdog timeout

// Cleanup + watchdog
function tick() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    // Watchdog: kill hung jobs
    if (!job.done && now - job.startedAt > JOB_MAX_DURATION_MS) {
      emitJobEvent(id, "error", "Job timed out after 5 minutes");
      emitJobEvent(id, "done", null);
    }
    // Cleanup: remove old completed jobs
    if (job.done && job.events.length > 0) {
      const lastEvent = job.events[job.events.length - 1]!;
      if (now - lastEvent.ts > JOB_TTL_MS) {
        jobs.delete(id);
      }
    }
  }
}
setInterval(tick, 30_000);

let jobCounter = 0;

export function createJob(agentId: number): string {
  const id = `job-${agentId}-${Date.now()}-${++jobCounter}`;
  jobs.set(id, { id, agentId, events: [], done: false, conversationId: null, startedAt: Date.now() });
  activeJobs.set(agentId, id);
  return id;
}

export function getJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

/** Emit an event to a job's buffer and notify subscribers */
export function emitJobEvent(jobId: string, type: string, data: unknown): void {
  const job = jobs.get(jobId);
  if (!job) return;
  const evt: AgentEvent = { type, data, ts: Date.now(), jobId };
  job.events.push(evt);
  if (type === "done" || type === "error") {
    job.done = true;
    if (activeJobs.get(job.agentId) === jobId) {
      activeJobs.delete(job.agentId);
    }
  }
  if (type === "conversationId") {
    job.conversationId = data as number;
  }
  emitter.emit(`job:${jobId}`, evt);

  // Persist to event-sourced log (fire-and-forget)
  if (type !== "step") { // Skip heartbeat/step noise — only persist meaningful events
    const meta = (type === "completion_meta" && data && typeof data === "object") ? data as Record<string, unknown> : null;
    db.insert(agentJobEventsTable).values({
      jobId,
      agentId: job.agentId,
      eventType: type,
      eventData: data != null ? data : undefined,
      tokenCount: meta ? (Number(meta.tokens_out) || 0) + (Number(meta.tokens_in) || 0) : undefined,
      durationMs: meta ? Number(meta.duration_ms) || undefined : undefined,
      model: meta ? String(meta.model || "") || undefined : undefined,
    }).catch(() => {}); // Silently swallow DB errors — event bus must never block
  }
}

/** Subscribe to job events. Returns unsubscribe function. */
export function subscribeJob(
  jobId: string,
  listener: (evt: AgentEvent) => void
): () => void {
  const handler = (evt: AgentEvent) => listener(evt);
  emitter.on(`job:${jobId}`, handler);
  return () => emitter.off(`job:${jobId}`, handler);
}

/** Get all events for a job (for replay on reconnect) */
export function getJobEvents(jobId: string): AgentEvent[] {
  return jobs.get(jobId)?.events ?? [];
}

/** Check if job is still running */
export function isJobDone(jobId: string): boolean {
  return jobs.get(jobId)?.done ?? true;
}

/** Get active job for an agent */
export function getActiveJob(agentId: number): string | null {
  const jobId = activeJobs.get(agentId);
  if (jobId && jobs.has(jobId) && !jobs.get(jobId)!.done) return jobId;
  activeJobs.delete(agentId);
  return null;
}

/** Check if agent has an active job (for 409 guard) */
export function hasActiveJob(agentId: number): boolean {
  return getActiveJob(agentId) !== null;
}

/** Wait for a job to complete (for synchronous delegation) */
export function waitForJob(jobId: string, timeoutMs: number): Promise<{ answer?: string; error?: string }> {
  return new Promise((resolve) => {
    let content = "";
    const timeout = setTimeout(() => {
      unsub();
      resolve({ error: "Delegation timed out" });
    }, timeoutMs);

    const unsub = subscribeJob(jobId, (evt) => {
      if (evt.type === "content") content += String(evt.data);
      if (evt.type === "done") {
        clearTimeout(timeout);
        unsub();
        resolve({ answer: content || undefined });
      }
      if (evt.type === "error") {
        clearTimeout(timeout);
        unsub();
        resolve({ error: String(evt.data) });
      }
    });

    // If job is already done, resolve immediately
    if (isJobDone(jobId)) {
      clearTimeout(timeout);
      unsub();
      const events = getJobEvents(jobId);
      const answer = events.filter(e => e.type === "content").map(e => String(e.data)).join("");
      const error = events.find(e => e.type === "error");
      resolve(error ? { error: String(error.data) } : { answer: answer || undefined });
    }
  });
}
