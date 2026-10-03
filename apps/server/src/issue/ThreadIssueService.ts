import {
  CommandId,
  type IssueLinkResult,
  IssueLinkFailedError,
  type IssueReadError,
  IssueReferenceInvalidError,
  IssueThreadNotFoundError,
  IssueThreadReadError,
  IssueUnlinkFailedError,
  type OrchestrationV2ThreadShell,
  type ThreadId,
  type ThreadIssueLinkSource,
} from "@t3tools/contracts";
import {
  type GitIssueLink,
  projectIssueDefaults,
  resolveIssueReference,
  threadIssueKeysEqual,
  threadIssuesOf,
} from "@t3tools/shared/threadIssues";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as IssueService from "./IssueService.ts";

type ResolveError = IssueReferenceInvalidError | IssueThreadNotFoundError | IssueThreadReadError;

/** The issue a reference names, completed with the thread's project remote. */
export interface ThreadIssueTarget {
  readonly thread: OrchestrationV2ThreadShell;
  readonly issue: GitIssueLink;
}

/**
 * Links and unlinks issues on threads for every entry point (the web dialog over RPC, agents over
 * MCP), so each one resolves references and checks issues the same way.
 */
export class ThreadIssueService extends Context.Service<
  ThreadIssueService,
  {
    readonly resolve: (
      threadId: ThreadId,
      reference: string,
    ) => Effect.Effect<ThreadIssueTarget, ResolveError>;
    /**
     * Reads the issue before linking, so a typo or a pull request number fails here instead of
     * leaving a link that can never sync. A tracker this environment cannot reach right now still
     * links, and syncs once it can.
     */
    readonly link: (input: {
      readonly threadId: ThreadId;
      readonly reference: string;
      readonly source: ThreadIssueLinkSource;
    }) => Effect.Effect<IssueLinkResult, ResolveError | IssueReadError | IssueLinkFailedError>;
    readonly unlink: (input: {
      readonly threadId: ThreadId;
      readonly reference: string;
    }) => Effect.Effect<
      { readonly issue: GitIssueLink; readonly wasLinked: boolean },
      ResolveError | IssueUnlinkFailedError
    >;
  }
>()("t3/issue/ThreadIssueService") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projects = yield* ProjectService.ProjectService;
  const issues = yield* IssueService.IssueService;
  const crypto = yield* Crypto.Crypto;

  const commandId = (tag: string, threadId: ThreadId) =>
    crypto.randomUUIDv4.pipe(
      Effect.orDie,
      Effect.map((uuid) => CommandId.make(`server:${tag}:${threadId}:${uuid}`)),
    );

  const failUnlessInterrupted = <E, F>(cause: Cause.Cause<E>, failure: () => F) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.failCause(cause as Cause.Cause<never>)
      : Effect.fail(failure());

  const resolve = Effect.fn("ThreadIssueService.resolve")(function* (
    threadId: ThreadId,
    reference: string,
  ) {
    const thread = yield* engine
      .getThreadShell(threadId)
      .pipe(Effect.mapError((cause) => new IssueThreadReadError({ cause })));
    if (thread === null || thread === undefined) {
      return yield* new IssueThreadNotFoundError({ threadId });
    }
    const project = yield* projects.getShell(thread.projectId).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.mapError((cause) => new IssueThreadReadError({ cause })),
    );
    const issue = resolveIssueReference(
      reference,
      projectIssueDefaults(project?.repositoryIdentity),
    );
    if (issue === null) return yield* new IssueReferenceInvalidError({});
    return { thread, issue };
  });

  const link = Effect.fn("ThreadIssueService.link")(function* (input: {
    readonly threadId: ThreadId;
    readonly reference: string;
    readonly source: ThreadIssueLinkSource;
  }) {
    const { thread, issue } = yield* resolve(input.threadId, input.reference);
    const identity = {
      tracker: issue.tracker,
      host: issue.host,
      id: issue.id,
      displayKey: issue.displayKey,
      url: issue.url,
    };
    if (threadIssuesOf(thread).some((existing) => threadIssueKeysEqual(existing, issue))) {
      return { ...identity, alreadyLinked: true };
    }
    yield* issues
      .getIssue({ projectId: thread.projectId, ...issue })
      .pipe(Effect.catchTag("IssueUnavailableError", () => Effect.void));
    yield* engine
      .dispatch({
        type: "thread.issue.link",
        commandId: yield* commandId("issue-link", thread.id),
        threadId: thread.id,
        ...identity,
        source: input.source,
      })
      .pipe(
        Effect.catchCause((cause) =>
          failUnlessInterrupted(cause, () => new IssueLinkFailedError({ cause })),
        ),
      );
    return { ...identity, alreadyLinked: false };
  });

  const unlink = Effect.fn("ThreadIssueService.unlink")(function* (input: {
    readonly threadId: ThreadId;
    readonly reference: string;
  }) {
    const { thread, issue } = yield* resolve(input.threadId, input.reference);
    if (!threadIssuesOf(thread).some((existing) => threadIssueKeysEqual(existing, issue))) {
      return { issue, wasLinked: false };
    }
    yield* engine
      .dispatch({
        type: "thread.issue.unlink",
        commandId: yield* commandId("issue-unlink", thread.id),
        threadId: thread.id,
        tracker: issue.tracker,
        host: issue.host,
        id: issue.id,
      })
      .pipe(
        Effect.catchCause((cause) =>
          failUnlessInterrupted(cause, () => new IssueUnlinkFailedError({ cause })),
        ),
      );
    return { issue, wasLinked: true };
  });

  return ThreadIssueService.of({ resolve, link, unlink });
});

export const layer = Layer.effect(ThreadIssueService, make);
