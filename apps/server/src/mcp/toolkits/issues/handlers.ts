import {
  CommandId,
  type IssueCommentPage,
  type IssueDetail,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import {
  type GitIssueLink,
  projectIssueDefaults,
  resolveIssueReference,
  threadIssueKeysEqual,
  threadIssuesOf,
} from "@t3tools/shared/threadIssues";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as IssueService from "../../../issue/IssueService.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import {
  IssueLinkFailedError,
  IssueListFailedError,
  IssueReferenceInvalidError,
  IssuesToolkit,
  IssueThreadNotFoundError,
  IssueUnlinkFailedError,
  type ListLinkedIssuesResult,
} from "./tools.ts";

const READ_COMMENT_LIMIT = 20;
const MAX_BODY_CHARS = 20_000;
const MAX_COMMENT_CHARS = 4_000;

function capped(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length <= limit
    ? trimmed
    : `${trimmed.slice(0, limit)}\n\n[…truncated ${trimmed.length - limit} characters]`;
}

/**
 * What read_issue hands the agent, compactly: the issue and its first page of comments, or only
 * comments when paging on (`issue` is null).
 */
export function issueMarkdown(issue: IssueDetail | null, page: IssueCommentPage) {
  const lines: Array<string> = [];
  if (issue !== null) {
    lines.push(`# ${issue.displayKey}: ${issue.title}`, "");
    lines.push(
      `State: ${issue.state}${issue.closedAt ? ` (closed ${issue.closedAt})` : ""} · Author: ${issue.author?.login ?? "unknown"} · Opened ${issue.createdAt} · ${issue.commentCount} comments`,
    );
    if (issue.labels.length > 0) {
      lines.push(`Labels: ${issue.labels.map((label) => label.name).join(", ")}`);
    }
    lines.push(issue.url, "", capped(issue.body, MAX_BODY_CHARS) || "_No description._");
  }
  if (page.comments.length > 0) {
    lines.push("", "## Comments");
    for (const comment of page.comments) {
      lines.push(
        "",
        `### ${comment.author?.login ?? "unknown"} · ${comment.createdAt}`,
        capped(comment.body, MAX_COMMENT_CHARS),
      );
    }
  }
  return lines.join("\n").trim();
}

/** What list_linked_issues reports from a thread shell. */
function listLinkedIssues(
  thread: Pick<OrchestrationV2ThreadShell, "issues">,
): ListLinkedIssuesResult {
  return {
    issues: threadIssuesOf(thread).map((link) => ({
      tracker: link.tracker,
      key: link.displayKey,
      url: link.url,
      source: link.source,
      state: link.snapshot?.state ?? null,
      title: link.snapshot?.title ?? null,
    })),
  };
}

const identityOf = (issue: GitIssueLink) => ({
  tracker: issue.tracker,
  key: issue.displayKey,
  url: issue.url,
});

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

  type Failure =
    | typeof IssueLinkFailedError
    | typeof IssueUnlinkFailedError
    | typeof IssueListFailedError;

  const requireThread = Effect.fn("IssuesToolkit.requireThread")(function* (Failure: Failure) {
    const scope = yield* McpInvocationContext.requireMcpCapability("issues");
    const thread = yield* engine
      .getThreadShell(scope.threadId)
      .pipe(Effect.mapError((cause) => new Failure({ cause })));
    if (thread === null || thread === undefined) {
      return yield* new IssueThreadNotFoundError({ threadId: scope.threadId });
    }
    return thread;
  });

  /** The thread and the issue the agent named, completed with the thread's project remote. */
  const resolveTarget = Effect.fn("IssuesToolkit.resolveTarget")(function* (
    reference: string,
    Failure: Failure,
  ) {
    const thread = yield* requireThread(Failure);
    const project = yield* projects.getShell(thread.projectId).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.mapError((cause) => new Failure({ cause })),
    );
    const issue = resolveIssueReference(
      reference,
      projectIssueDefaults(project?.repositoryIdentity),
    );
    if (issue === null) return yield* new IssueReferenceInvalidError({});
    return { thread, issue };
  });

  const dispatchFailure =
    (Failure: typeof IssueLinkFailedError | typeof IssueUnlinkFailedError) =>
    <E>(cause: Cause.Cause<E>) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause as Cause.Cause<never>)
        : Effect.fail(new Failure({ cause }));

  return IssuesToolkit.of({
    link_issue: ({ issue: reference }) =>
      Effect.gen(function* () {
        const { thread, issue } = yield* resolveTarget(reference, IssueLinkFailedError);
        if (threadIssuesOf(thread).some((link) => threadIssueKeysEqual(link, issue))) {
          return { ...identityOf(issue), alreadyLinked: true };
        }
        // Reading first turns a typo or a pull request number into an answer the agent can act
        // on. A tracker this environment cannot reach still links, and syncs once it can.
        yield* issues
          .getIssue({ projectId: thread.projectId, ...issue })
          .pipe(Effect.catchTag("IssueUnavailableError", () => Effect.void));
        yield* engine
          .dispatch({
            type: "thread.issue.link",
            commandId: yield* commandId("mcp-issue-link", thread.id),
            threadId: thread.id,
            tracker: issue.tracker,
            host: issue.host,
            id: issue.id,
            displayKey: issue.displayKey,
            url: issue.url,
            source: "agent",
          })
          .pipe(Effect.catchCause(dispatchFailure(IssueLinkFailedError)));
        return { ...identityOf(issue), alreadyLinked: false };
      }),
    unlink_issue: ({ issue: reference }) =>
      Effect.gen(function* () {
        const { thread, issue } = yield* resolveTarget(reference, IssueUnlinkFailedError);
        if (!threadIssuesOf(thread).some((link) => threadIssueKeysEqual(link, issue))) {
          return { ...identityOf(issue), wasLinked: false };
        }
        yield* engine
          .dispatch({
            type: "thread.issue.unlink",
            commandId: yield* commandId("mcp-issue-unlink", thread.id),
            threadId: thread.id,
            tracker: issue.tracker,
            host: issue.host,
            id: issue.id,
          })
          .pipe(Effect.catchCause(dispatchFailure(IssueUnlinkFailedError)));
        return { ...identityOf(issue), wasLinked: true };
      }),
    list_linked_issues: () =>
      requireThread(IssueListFailedError).pipe(Effect.map(listLinkedIssues)),
    read_issue: ({ issue: reference, commentsCursor }) =>
      Effect.gen(function* () {
        const { thread, issue } = yield* resolveTarget(reference, IssueListFailedError);
        const ref = { projectId: thread.projectId, ...issue };
        // Later comment pages carry no issue header, so they skip the issue read.
        const [detail, page] = yield* Effect.all(
          [
            commentsCursor === undefined ? issues.getIssue(ref) : Effect.succeed(null),
            issues.listComments({
              ...ref,
              limit: READ_COMMENT_LIMIT,
              ...(commentsCursor === undefined ? {} : { cursor: commentsCursor }),
            }),
          ],
          { concurrency: 2 },
        );
        return {
          markdown: issueMarkdown(detail, page),
          nextCommentsCursor: page.nextCursor,
        };
      }),
  });
});

export const IssuesToolkitHandlersLive = IssuesToolkit.toLayer(make);
