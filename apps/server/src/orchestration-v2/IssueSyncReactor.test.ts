import {
  IssueReadError,
  ProjectId,
  ThreadId,
  type IssueDetail,
  type OrchestrationV2ServerCommand,
  type ThreadIssueLink,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import * as IssueService from "../issue/IssueService.ts";
import * as ServerActivation from "../serverActivation.ts";
import * as IssueSyncReactor from "./IssueSyncReactor.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

type SyncCommand = Extract<
  OrchestrationV2ServerCommand,
  { readonly type: "thread.issue-link.sync" }
>;

const PROJECT_ID = ProjectId.make("project-1");

const link: ThreadIssueLink = {
  tracker: "github",
  host: "github.com",
  id: "acme/app#7",
  displayKey: "acme/app#7",
  url: "https://github.com/acme/app/issues/7",
  source: "manual",
  linkedAt: "2026-09-01T00:00:00.000Z",
  snapshot: null,
};

const detail: IssueDetail = {
  tracker: "github",
  host: "github.com",
  id: "acme/app#7",
  displayKey: "acme/app#7",
  url: "https://github.com/acme/app/issues/7",
  title: "Crash on start",
  state: "open",
  author: null,
  labels: [],
  body: "",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-02T00:00:00Z",
  closedAt: null,
  commentCount: 0,
};

const makeHarness = Effect.fn("makeIssueSyncHarness")(function* (
  getIssue: IssueService.IssueService["Service"]["getIssue"],
) {
  const activation = yield* Deferred.make<void>();
  const reads = yield* Queue.unbounded<void>();
  const issueReads = yield* Ref.make(0);
  const commands = yield* Ref.make<ReadonlyArray<SyncCommand>>([]);
  const threads = yield* Ref.make<ReadonlyArray<ProjectionStore.ProjectionThreadIssues>>(
    ["thread-a", "thread-b"].map((id) => ({
      id: ThreadId.make(id),
      projectId: PROJECT_ID,
      issues: [link],
    })),
  );

  const dependencies = Layer.mergeAll(
    Layer.mock(IssueService.IssueService)({
      getIssue: (ref) =>
        Ref.update(issueReads, (count) => count + 1).pipe(Effect.andThen(getIssue(ref))),
    }),
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThreadsWithIssues: () =>
        Queue.offer(reads, undefined).pipe(Effect.andThen(Ref.get(threads))),
    }),
    Layer.mock(Orchestrator.OrchestratorV2)({
      dispatch: (command) =>
        command.type === "thread.issue-link.sync"
          ? Effect.gen(function* () {
              yield* Ref.update(commands, (recorded) => [...recorded, command]);
              // What the orchestrator would persist, so the next sweep sees its own writes.
              yield* Ref.update(threads, (current) =>
                current.map((thread) =>
                  thread.id === command.threadId
                    ? { ...thread, issues: [{ ...link, snapshot: command.snapshot }] }
                    : thread,
                ),
              );
              return { sequence: 1, storedEvents: [] };
            })
          : Effect.die(new Error(`Unexpected command: ${command.type}`)),
      streamDomainEvents: Stream.empty,
    }),
    Layer.succeed(ServerActivation.ServerActivation, Deferred.await(activation)),
    Layer.succeed(
      Crypto.Crypto,
      Crypto.make({
        randomBytes: (size) => new Uint8Array(size).fill(1),
        digest: (_algorithm, data) => Effect.succeed(data),
      }),
    ),
  );

  const start = Effect.gen(function* () {
    const reactor = yield* IssueSyncReactor.IssueSyncReactor;
    yield* reactor.start();
    yield* Deferred.succeed(activation, undefined);
    yield* Queue.take(reads);
    yield* reactor.drain;
    return reactor;
  });
  const sweepAfter = (reactor: IssueSyncReactor.IssueSyncReactor["Service"], minutes: number) =>
    Effect.gen(function* () {
      for (let minute = 0; minute < minutes; minute++) {
        yield* TestClock.adjust("1 minute");
        yield* Queue.take(reads);
        yield* reactor.drain;
      }
    });

  return {
    issueReads,
    commands,
    start,
    sweepAfter,
    layer: IssueSyncReactor.layer.pipe(Layer.provide(dependencies)),
  };
});

describe("IssueSyncReactor", () => {
  it.effect("reads a shared issue once and writes only what changed", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(() => Effect.succeed(detail));
      yield* Effect.gen(function* () {
        const reactor = yield* harness.start;
        assert.equal(yield* Ref.get(harness.issueReads), 1);
        const synced = yield* Ref.get(harness.commands);
        assert.deepEqual(
          synced.map((command) => [command.threadId, command.snapshot.title]),
          [
            ["thread-a", "Crash on start"],
            ["thread-b", "Crash on start"],
          ],
        );

        // An open issue is not re-read every minute, and an unchanged one writes nothing.
        yield* harness.sweepAfter(reactor, 4);
        assert.equal(yield* Ref.get(harness.issueReads), 1);
        yield* harness.sweepAfter(reactor, 1);
        assert.equal(yield* Ref.get(harness.issueReads), 2);
        assert.equal((yield* Ref.get(harness.commands)).length, 2);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("backs off from an issue it cannot read", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(() => Effect.fail(new IssueReadError({ detail: "gone" })));
      yield* Effect.gen(function* () {
        const reactor = yield* harness.start;
        yield* harness.sweepAfter(reactor, 4);
        assert.equal(yield* Ref.get(harness.issueReads), 1);
        yield* harness.sweepAfter(reactor, 1);
        assert.equal(yield* Ref.get(harness.issueReads), 2);
        assert.deepEqual(yield* Ref.get(harness.commands), []);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );
});
