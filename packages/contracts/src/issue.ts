import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { PullRequestActor, PullRequestLabel } from "./pullRequest.ts";
import { ThreadIssueKey, ThreadIssueState } from "./threadIssue.ts";

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
