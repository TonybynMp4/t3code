import {
  CommandId,
  type IssueDetail,
  type ThreadIssueLink,
  type ThreadIssueSnapshot,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { threadIssueKeyOf, threadIssuesOf } from "@t3tools/shared/threadIssues";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as IssueService from "../issue/IssueService.ts";
import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const OPEN_SYNC_INTERVAL_MS = 5 * 60 * 1_000;
/** Closed issues, and open ones whose threads have all settled, change rarely. */
const SLOW_SYNC_INTERVAL_MS = 30 * 60 * 1_000;
/** An issue the tracker refuses (deleted, private, a pull request) is not worth asking often. */
const UNREADABLE_RETRY_MS = 30 * 60 * 1_000;
/** A missing or signed-out CLI may be fixed at any moment. */
const UNAVAILABLE_RETRY_MS = 5 * 60 * 1_000;
/** A rate-limited host is left alone for a while, so other reads on it stop piling on. */
const RATE_LIMIT_PAUSE_MS = 15 * 60 * 1_000;

type SnapshotFields = Omit<ThreadIssueSnapshot, "syncedAt">;

interface LinkEntry {
  readonly thread: ProjectionStore.ProjectionThreadIssues;
  readonly link: ThreadIssueLink;
}

function isUnsettled(thread: ProjectionStore.ProjectionThreadIssues): boolean {
  return thread.settledOverride !== "settled" && thread.settledAt === null;
}

function snapshotFieldsOf(issue: IssueDetail): SnapshotFields {
  return {
    state: issue.state,
    title: issue.title,
    author: issue.author,
    labels: issue.labels,
    updatedAt: issue.updatedAt,
    closedAt: issue.closedAt,
    ...(issue.closedReason === undefined ? {} : { closedReason: issue.closedReason }),
  };
}

function snapshotFieldsEqual(left: SnapshotFields, right: SnapshotFields): boolean {
  return (
    left.state === right.state &&
    left.title === right.title &&
    left.updatedAt === right.updatedAt &&
    left.closedAt === right.closedAt &&
    left.closedReason === right.closedReason &&
    (left.author?.login ?? null) === (right.author?.login ?? null) &&
    (left.author?.avatarUrl ?? null) === (right.author?.avatarUrl ?? null) &&
    left.labels.length === right.labels.length &&
    left.labels.every(
      (label, index) =>
        label.name === right.labels[index]!.name && label.color === right.labels[index]!.color,
    )
  );
}

/**
 * Keeps the title and state of every thread ↔ issue link current. A sweep every minute reads the
 * active threads with issue links, asks the tracker once per issue however many threads share
 * it, and writes back only what changed. New links are read right away; open issues on active
 * threads every few minutes, the rest (closed issues can reopen) rarely. An issue the tracker
 * refuses gets its reason recorded on the link, so it does not look pending forever.
 */
export class IssueSyncReactor extends Context.Service<
  IssueSyncReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/orchestration-v2/IssueSyncReactor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const issues = yield* IssueService.IssueService;
  const crypto = yield* Crypto.Crypto;

  const lastSyncedAt = new Map<string, number>();
  // When an issue that failed to read may be tried again.
  const retryAt = new Map<string, number>();
  // Hosts that rate-limited us, until when.
  const pausedUntil = new Map<string, number>();
  let sweepQueued = false;

  const isDue = (key: string, entries: ReadonlyArray<LinkEntry>, nowMs: number): boolean => {
    const retry = retryAt.get(key);
    if (retry !== undefined) return nowMs >= retry;
    if (entries.some((entry) => entry.link.snapshot === null)) return true;
    const last = lastSyncedAt.get(key);
    if (last === undefined) return true;
    const active = entries.some(
      (entry) => entry.link.snapshot?.state === "open" && isUnsettled(entry.thread),
    );
    return nowMs - last >= (active ? OPEN_SYNC_INTERVAL_MS : SLOW_SYNC_INTERVAL_MS);
  };

  const logSkipped =
    (message: string, fields: Record<string, unknown>) =>
    <E>(cause: Cause.Cause<E>): Effect.Effect<void, E> =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.logWarning(message, { ...fields, cause: Cause.pretty(cause) });

  const commandIdFor = (threadId: string) =>
    crypto.randomUUIDv4.pipe(
      Effect.map((uuid) => CommandId.make(`server:issue-sync:${threadId}:${uuid}`)),
    );

  /** Records why the issue could not be read on every link that does not say so already. */
  const recordFailure = (key: string, entries: ReadonlyArray<LinkEntry>, error: string) =>
    Effect.forEach(
      entries.filter(({ link }) => link.syncError !== error),
      ({ thread, link }) =>
        commandIdFor(thread.id).pipe(
          Effect.flatMap((commandId) =>
            engine.dispatch({
              type: "thread.issue-link.sync-failed",
              commandId,
              threadId: thread.id,
              tracker: link.tracker,
              host: link.host,
              id: link.id,
              error,
            }),
          ),
          Effect.catchCause(
            logSkipped("issue sync failure not recorded", { threadId: thread.id, key }),
          ),
        ),
      { discard: true },
    );

  const syncGroup = Effect.fn("IssueSyncReactor.syncGroup")(function* (
    key: string,
    entries: ReadonlyArray<LinkEntry>,
    now: DateTime.Utc,
  ) {
    const first = entries[0]!;
    const issue = yield* issues
      .getIssue({
        projectId: first.thread.projectId,
        tracker: first.link.tracker,
        host: first.link.host,
        id: first.link.id,
      })
      .pipe(
        Effect.tapError((error) =>
          error._tag === "IssueReadError" ? recordFailure(key, entries, error.detail) : Effect.void,
        ),
      );
    lastSyncedAt.set(key, DateTime.toEpochMillis(now));
    retryAt.delete(key);
    const fields = snapshotFieldsOf(issue);
    yield* Effect.forEach(
      entries.filter(
        ({ link }) =>
          link.snapshot === null ||
          link.syncError !== undefined ||
          !snapshotFieldsEqual(link.snapshot, fields),
      ),
      ({ thread, link }) =>
        commandIdFor(thread.id).pipe(
          Effect.flatMap((commandId) =>
            engine.dispatch({
              type: "thread.issue-link.sync",
              commandId,
              threadId: thread.id,
              tracker: link.tracker,
              host: link.host,
              id: link.id,
              snapshot: { ...fields, syncedAt: DateTime.formatIso(now) },
            }),
          ),
          Effect.catchCause(logSkipped("issue sync skipped", { threadId: thread.id, key })),
        ),
      { discard: true },
    );
  });

  const sweep = Effect.fn("IssueSyncReactor.sweep")(function* () {
    const threads = yield* projections.getThreadsWithIssues();
    const now = yield* DateTime.now;
    const nowMs = DateTime.toEpochMillis(now);

    const groups = new Map<string, Array<LinkEntry>>();
    for (const thread of threads) {
      for (const link of thread.issues) {
        const key = threadIssueKeyOf(link);
        const entries = groups.get(key) ?? [];
        entries.push({ thread, link });
        groups.set(key, entries);
      }
    }
    for (const map of [lastSyncedAt, retryAt]) {
      for (const key of map.keys()) if (!groups.has(key)) map.delete(key);
    }

    // A missing or signed-out CLI fails every read on that host; stop asking it for this sweep.
    const unavailableHosts = new Set<string>();
    const hostOf = ({ link }: LinkEntry) => `${link.tracker}:${link.host.toLowerCase()}`;
    const isSkipped = (host: string) =>
      unavailableHosts.has(host) || (pausedUntil.get(host) ?? 0) > nowMs;

    yield* Effect.forEach(
      groups,
      ([key, entries]) =>
        isDue(key, entries, nowMs) && !isSkipped(hostOf(entries[0]!))
          ? syncGroup(key, entries, now).pipe(
              Effect.tapError((error) =>
                Effect.sync(() => {
                  const host = hostOf(entries[0]!);
                  if (error._tag === "IssueUnavailableError") {
                    unavailableHosts.add(host);
                    if (error.reason === "rate-limited") {
                      pausedUntil.set(host, nowMs + RATE_LIMIT_PAUSE_MS);
                    }
                  }
                  retryAt.set(
                    key,
                    nowMs +
                      (error._tag === "IssueReadError"
                        ? UNREADABLE_RETRY_MS
                        : UNAVAILABLE_RETRY_MS),
                  );
                }),
              ),
              Effect.tapCause(() =>
                Effect.sync(() => {
                  // Typed errors set their own wait above; anything else still waits.
                  if ((retryAt.get(key) ?? 0) <= nowMs) {
                    retryAt.set(key, nowMs + UNAVAILABLE_RETRY_MS);
                  }
                }),
              ),
              Effect.catchCause(logSkipped("issue sync skipped", { key })),
            )
          : Effect.void,
      { concurrency: 8, discard: true },
    );
  });

  const worker = yield* makeDrainableWorker(() =>
    Effect.suspend(() => {
      sweepQueued = false;
      return sweep();
    }).pipe(Effect.catchCause(logSkipped("issue sync sweep failed", {}))),
  );

  const enqueueSweep = Effect.suspend(() => {
    if (sweepQueued) return Effect.void;
    sweepQueued = true;
    return worker.enqueue(undefined);
  });

  const start: IssueSyncReactor["Service"]["start"] = Effect.fn("IssueSyncReactor.start")(
    function* () {
      // A new link carries no snapshot; read it now rather than at the next tick.
      yield* forkParked(
        Stream.runForEach(engine.streamDomainEvents, (event) =>
          event.type === "thread.metadata-updated" &&
          threadIssuesOf(event.payload).some(
            (link) => link.snapshot === null && link.syncError === undefined,
          )
            ? enqueueSweep
            : Effect.void,
        ).pipe(Effect.catchCause(logSkipped("issue sync event stream failed", {}))),
      );
      yield* forkParked(
        Effect.gen(function* () {
          yield* enqueueSweep;
          yield* worker.drain;
        }).pipe(Effect.repeat(Schedule.spaced("1 minute")), Effect.asVoid),
      );
    },
  );

  return IssueSyncReactor.of({ start, drain: worker.drain });
});

export const layer = Layer.effect(IssueSyncReactor, make);
