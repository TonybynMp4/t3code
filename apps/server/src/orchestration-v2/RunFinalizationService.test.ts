import { assert, it } from "@effect/vitest";
import {
  CheckpointScopeId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as CheckpointCapture from "./CheckpointCaptureService.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as RunFinalization from "./RunFinalizationService.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

it.effect("completes finalization when the post-checkpoint workspace refresh fails", () => {
  const threadId = ThreadId.make("thread_refresh_failure");
  const runId = RunId.make("run_refresh_failure");
  const scopeId = CheckpointScopeId.make("scope_refresh_failure");
  const captured: string[] = [];
  const layer = RunFinalization.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(CheckpointCapture.CheckpointCaptureServiceV2)({
          execute: () =>
            Effect.sync(() => {
              captured.push("checkpoint");
            }),
        }),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getCheckpointContext: () =>
            Effect.succeed({
              runs: [],
              checkpointScopes: [{ id: scopeId, runId, kind: "root_run" as const, cwd: "/repo" }],
              checkpoints: [],
            }),
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({}),
        Layer.succeed(RunFinalization.RunFinalizationObserver, {
          refresh: () =>
            Effect.gen(function* () {
              captured.push("refresh");
              return yield* new RunFinalization.RunFinalizationRefreshError({
                cwd: "/repo",
                cause: new Error("Git command timed out"),
              });
            }),
          refreshAfterTurn: () => Effect.void,
        }),
      ),
    ),
  );
  return Effect.gen(function* () {
    const service = yield* RunFinalization.RunFinalizationService;
    yield* service.finalize({ threadId, runId, scopeId });
    assert.deepEqual(captured, ["checkpoint", "refresh"]);
  }).pipe(Effect.provide(layer));
});

it.effect.each(
  (
    [
      {
        label: "discovers a new PR for the completed run's branch",
        branch: "feature",
        checkedOut: "feature",
        activeRun: null,
        expected: ["/repo"],
      },
      {
        label: "leaves the default branch's PR cache alone",
        branch: "main",
        checkedOut: "main",
        activeRun: null,
        expected: [],
      },
      {
        label: "does not refresh another thread's checkout",
        branch: "feature",
        checkedOut: "other",
        activeRun: null,
        expected: [],
      },
      {
        label: "discovers the PR after the thread adopts a renamed branch",
        branch: "feature",
        checkedOut: "renamed",
        adopts: true,
        activeRun: null,
        expected: ["/repo"],
      },
      {
        label: "does not refresh during a newer active run",
        branch: "feature",
        checkedOut: "feature",
        activeRun: "newer-run",
        expected: [],
      },
    ] as const
  ).map((scenario) => [scenario.label, scenario] as const),
)("%s", ([, scenario]) => {
  const refreshed: string[] = [];
  let branch: string = scenario.branch;
  const threadId = ThreadId.make("thread-pr-refresh");
  const runId = RunId.make("completed-run");
  const layer = RunFinalization.layerObserver.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(WorkspaceEntries.WorkspaceEntries)({ refresh: () => Effect.void }),
        Layer.mock(PullRequestService.PullRequestService)({
          refreshAfterTurn: () => Effect.void,
        }),
        Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({
          refreshLocalStatus: () =>
            Effect.succeed({
              isRepo: true,
              hasPrimaryRemote: true,
              isDefaultRef: scenario.checkedOut === "main",
              refName: scenario.checkedOut,
              hasWorkingTreeChanges: false,
              workingTree: { files: [], insertions: 0, deletions: 0 },
            }),
          refreshStatus: () =>
            Effect.die("turn completion must preserve known PRs and lookup backoff"),
          refreshPullRequestStatus: (cwd) =>
            Effect.sync(() => {
              refreshed.push(cwd);
              return null;
            }),
        }),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThreadShell: () =>
            Effect.succeed({
              id: threadId,
              branch,
              activeRunId: scenario.activeRun === null ? null : RunId.make(scenario.activeRun),
            } as OrchestrationV2ThreadShell),
        }),
      ),
    ),
  );
  return Effect.gen(function* () {
    const observer = yield* RunFinalization.RunFinalizationObserver;
    yield* observer.refresh({
      cwd: "/repo",
      threadId,
      runId,
      followBranch: (refName) =>
        Effect.sync(() => {
          if ("adopts" in scenario) branch = refName;
        }),
    });
    assert.deepEqual(refreshed, [...scenario.expected]);
  }).pipe(Effect.provide(layer));
});

it.effect.each(
  (
    [
      {
        label: "adopts a branch renamed inside the thread's own worktree",
        checkedOut: "renamed",
        worktreePath: "/worktree",
        sharedWith: [],
        expected: [{ branch: "renamed", expectedBranch: "feature" }],
      },
      {
        label: "waits out the temporary branch of a first-turn rename",
        checkedOut: "t3/0a1b2c3d",
        worktreePath: "/worktree",
        sharedWith: [],
        expected: [],
      },
      {
        label: "leaves a worktree shared with another thread alone",
        checkedOut: "renamed",
        worktreePath: "/worktree",
        sharedWith: ["other-thread"],
        expected: [],
      },
      {
        label: "leaves a local checkout alone",
        checkedOut: "renamed",
        worktreePath: null,
        sharedWith: [],
        expected: [],
      },
    ] as const
  ).map((scenario) => [scenario.label, scenario] as const),
)("%s", ([, scenario]) => {
  const threadId = ThreadId.make("thread-branch-follow");
  const runId = RunId.make("run-branch-follow");
  const scopeId = CheckpointScopeId.make("scope-branch-follow");
  const dispatched: Array<{ branch: unknown; expectedBranch: unknown }> = [];
  const layer = RunFinalization.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(CheckpointCapture.CheckpointCaptureServiceV2)({ execute: () => Effect.void }),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getCheckpointContext: () =>
            Effect.succeed({
              runs: [],
              checkpointScopes: [
                { id: scopeId, runId, kind: "root_run" as const, cwd: "/worktree" },
              ],
              checkpoints: [],
            }),
          getThreadShell: () =>
            Effect.succeed({
              id: threadId,
              branch: "feature",
              worktreePath: scenario.worktreePath,
              activeRunId: null,
            } as OrchestrationV2ThreadShell),
          getThreadWorktreePaths: () =>
            Effect.succeed([
              { threadId, worktreePath: "/worktree" },
              ...scenario.sharedWith.map((id) => ({
                threadId: ThreadId.make(id),
                worktreePath: "/worktree",
              })),
            ]),
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          dispatch: (command) =>
            Effect.sync(() => {
              if (command.type === "thread.metadata.update") {
                dispatched.push({ branch: command.branch, expectedBranch: command.expectedBranch });
              }
              return {} as never;
            }),
        }),
        Layer.succeed(RunFinalization.RunFinalizationObserver, {
          refresh: ({ followBranch }) => followBranch(scenario.checkedOut),
          refreshAfterTurn: () => Effect.void,
        }),
      ),
    ),
  );
  return Effect.gen(function* () {
    const service = yield* RunFinalization.RunFinalizationService;
    yield* service.finalize({ threadId, runId, scopeId });
    assert.deepEqual(dispatched, [...scenario.expected]);
  }).pipe(Effect.provide(layer));
});
