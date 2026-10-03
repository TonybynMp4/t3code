import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { PullRequestActor, PullRequestLabel } from "./pullRequest.ts";
import { ThreadIssueClosedReason, ThreadIssueKey, ThreadIssueState } from "./threadIssue.ts";

/**
 * An issue to read. `projectId` picks the environment-local project whose credentials and remote
 * the read goes through, the way pull request reads route through their project.
 */
export const IssueRef = Schema.Struct({
  projectId: ProjectId,
  ...ThreadIssueKey.fields,
});
export type IssueRef = typeof IssueRef.Type;

export const IssueDetail = Schema.Struct({
  ...ThreadIssueKey.fields,
  displayKey: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  state: ThreadIssueState,
  author: Schema.NullOr(PullRequestActor),
  labels: Schema.Array(PullRequestLabel),
  body: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: Schema.NullOr(IsoDateTime),
  closedAt: Schema.NullOr(IsoDateTime),
  closedReason: Schema.optional(ThreadIssueClosedReason),
  commentCount: NonNegativeInt,
});
export type IssueDetail = typeof IssueDetail.Type;

export const IssueComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  author: Schema.NullOr(PullRequestActor),
  body: Schema.String,
  createdAt: IsoDateTime,
  url: Schema.NullOr(Schema.String),
});
export type IssueComment = typeof IssueComment.Type;

export const IssueCommentsInput = Schema.Struct({
  ...IssueRef.fields,
  /** Opaque cursor from the previous page; absent for the first, oldest comments. */
  cursor: Schema.optional(TrimmedNonEmptyString),
  limit: Schema.optional(PositiveInt),
});
export type IssueCommentsInput = typeof IssueCommentsInput.Type;

export const IssueCommentPage = Schema.Struct({
  comments: Schema.Array(IssueComment),
  nextCursor: Schema.NullOr(TrimmedNonEmptyString),
});
export type IssueCommentPage = typeof IssueCommentPage.Type;

export const IssueUnavailableReason = Schema.Literals([
  "tracker-unsupported",
  "cli-missing",
  "cli-unauthenticated",
  "rate-limited",
]);
export type IssueUnavailableReason = typeof IssueUnavailableReason.Type;

/** The tracker cannot be read from this environment at all; the message is safe to show as-is. */
export class IssueUnavailableError extends Schema.TaggedError<IssueUnavailableError>()(
  "IssueUnavailableError",
  {
    reason: IssueUnavailableReason,
    tracker: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "tracker-unsupported":
        return "Issues from this tracker cannot be read yet.";
      case "cli-missing":
        return this.tracker === "gitlab"
          ? "Install the GitLab CLI (glab) on this environment to read GitLab issues."
          : "Install the GitHub CLI (gh) on this environment to read GitHub issues.";
      case "cli-unauthenticated":
        return this.tracker === "gitlab"
          ? "Run `glab auth login` on this environment to read GitLab issues."
          : "Run `gh auth login` on this environment to read GitHub issues.";
      case "rate-limited":
        return this.tracker === "gitlab"
          ? "GitLab is rate limiting this environment; issues will refresh later."
          : "GitHub is rate limiting this environment; issues will refresh later.";
    }
  }
}

export class IssueReadError extends Schema.TaggedError<IssueReadError>()("IssueReadError", {
  detail: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Could not read the issue: ${this.detail}`;
  }
}

/**
 * Links the issue a person typed to a thread. The server resolves the reference against the
 * thread's project and reads the issue first, so a typo or a pull request number is refused.
 */
export const IssueLinkInput = Schema.Struct({
  threadId: ThreadId,
  /** An issue URL, `owner/repo#42`, or `#42` in the thread project's own repository. */
  reference: TrimmedNonEmptyString,
});
export type IssueLinkInput = typeof IssueLinkInput.Type;

export const IssueLinkResult = Schema.Struct({
  ...ThreadIssueKey.fields,
  displayKey: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  /** True when the issue was linked to the thread before the call. */
  alreadyLinked: Schema.Boolean,
});
export type IssueLinkResult = typeof IssueLinkResult.Type;

export class IssueReferenceInvalidError extends Schema.TaggedError<IssueReferenceInvalidError>()(
  "IssueReferenceInvalidError",
  {},
) {
  override get message(): string {
    return "This does not name a GitHub or GitLab issue. Use its URL, owner/repo#42, or #42 when the project is on GitHub or GitLab.";
  }
}

export class IssueThreadNotFoundError extends Schema.TaggedError<IssueThreadNotFoundError>()(
  "IssueThreadNotFoundError",
  { threadId: Schema.String },
) {
  override get message(): string {
    return `Thread ${this.threadId} was not found.`;
  }
}

/** The thread or its project could not be read to resolve an issue reference. */
export class IssueThreadReadError extends Schema.TaggedError<IssueThreadReadError>()(
  "IssueThreadReadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read the thread.";
  }
}

export class IssueLinkFailedError extends Schema.TaggedError<IssueLinkFailedError>()(
  "IssueLinkFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not link the issue.";
  }
}

export class IssueUnlinkFailedError extends Schema.TaggedError<IssueUnlinkFailedError>()(
  "IssueUnlinkFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not unlink the issue.";
  }
}
