import {
  type IssueCommentPage,
  type IssueDetail,
  IssueThreadNotFoundError,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { type GitIssueLink, threadIssuesOf } from "@t3tools/shared/threadIssues";
import * as Effect from "effect/Effect";

import * as IssueService from "../../../issue/IssueService.ts";
import * as ThreadIssueService from "../../../issue/ThreadIssueService.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { IssueListFailedError, IssuesToolkit, type ListLinkedIssuesResult } from "./tools.ts";

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
      syncError: link.syncError ?? null,
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
  const issues = yield* IssueService.IssueService;
  const threadIssues = yield* ThreadIssueService.ThreadIssueService;

  const currentThreadId = McpInvocationContext.requireMcpCapability("issues").pipe(
    Effect.map((scope) => scope.threadId),
  );

  return IssuesToolkit.of({
    link_issue: ({ issue: reference }) =>
      Effect.gen(function* () {
        const threadId = yield* currentThreadId;
        const linked = yield* threadIssues.link({ threadId, reference, source: "agent" });
        return {
          tracker: linked.tracker,
          key: linked.displayKey,
          url: linked.url,
          alreadyLinked: linked.alreadyLinked,
        };
      }),
    unlink_issue: ({ issue: reference }) =>
      Effect.gen(function* () {
        const threadId = yield* currentThreadId;
        const { issue, wasLinked } = yield* threadIssues.unlink({ threadId, reference });
        return { ...identityOf(issue), wasLinked };
      }),
    list_linked_issues: () =>
      Effect.gen(function* () {
        const threadId = yield* currentThreadId;
        const thread = yield* engine
          .getThreadShell(threadId)
          .pipe(Effect.mapError((cause) => new IssueListFailedError({ cause })));
        if (thread === null || thread === undefined) {
          return yield* new IssueThreadNotFoundError({ threadId });
        }
        return listLinkedIssues(thread);
      }),
    read_issue: ({ issue: reference, commentsCursor }) =>
      Effect.gen(function* () {
        const { thread, issue } = yield* threadIssues.resolve(yield* currentThreadId, reference);
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
