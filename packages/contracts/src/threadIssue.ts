import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { PullRequestActor, PullRequestLabel } from "./pullRequest.ts";

/**
 * Issue tracker a link belongs to: "github" or "gitlab" today. A plain string rather than a
 * closed union, so a client that predates a tracker still decodes threads that link to it and can
 * show the link generically instead of failing the whole thread.
 */
export const ThreadIssueTracker = TrimmedNonEmptyString;
export type ThreadIssueTracker = typeof ThreadIssueTracker.Type;

/** Who created a thread ↔ issue link. */
export const ThreadIssueLinkSource = Schema.Literals(["manual", "agent"]);
export type ThreadIssueLinkSource = typeof ThreadIssueLinkSource.Type;

export const ThreadIssueState = Schema.Literals(["open", "closed"]);
export type ThreadIssueState = typeof ThreadIssueState.Type;

/** Why a closed issue closed, when the tracker says: done, or dropped (not planned, duplicate). */
export const ThreadIssueClosedReason = Schema.Literals(["completed", "not-planned"]);
export type ThreadIssueClosedReason = typeof ThreadIssueClosedReason.Type;

/**
 * Durable identity of an issue as a thread link sees it. `id` is what the tracker keeps stable,
 * `owner/repo#42` on the git hosts, so a display key that changes (a moved Jira project) does not
 * break the link. Compared case-insensitively, like pull request keys.
 */
export const ThreadIssueKey = Schema.Struct({
  tracker: ThreadIssueTracker,
  host: TrimmedNonEmptyString,
  id: TrimmedNonEmptyString,
});
export type ThreadIssueKey = typeof ThreadIssueKey.Type;

/** Tracker state persisted on a link by the sync reactor; null until first sync. */
export const ThreadIssueSnapshot = Schema.Struct({
  state: ThreadIssueState,
  title: TrimmedNonEmptyString,
  author: Schema.NullOr(PullRequestActor),
  labels: Schema.Array(PullRequestLabel),
  updatedAt: Schema.NullOr(IsoDateTime),
  closedAt: Schema.NullOr(IsoDateTime),
  closedReason: Schema.optional(ThreadIssueClosedReason),
  syncedAt: IsoDateTime,
});
export type ThreadIssueSnapshot = typeof ThreadIssueSnapshot.Type;

export const ThreadIssueLink = Schema.Struct({
  ...ThreadIssueKey.fields,
  /** What people call the issue, `owner/repo#42`; shown, never compared. */
  displayKey: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  source: ThreadIssueLinkSource,
  linkedAt: IsoDateTime,
  snapshot: Schema.NullOr(ThreadIssueSnapshot),
  /** Why the last read failed, shown beside the link; cleared by the next successful sync. */
  syncError: Schema.optional(TrimmedNonEmptyString),
});
export type ThreadIssueLink = typeof ThreadIssueLink.Type;
