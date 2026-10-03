import {
  IssueLinkFailedError,
  IssueReadError,
  IssueReferenceInvalidError,
  IssueThreadNotFoundError,
  IssueThreadReadError,
  IssueUnavailableError,
  IssueUnlinkFailedError,
  McpCapabilityUnavailableError,
  ThreadIssueLinkSource,
  ThreadIssueState,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as IssueService from "../../../issue/IssueService.ts";
import * as ThreadIssueService from "../../../issue/ThreadIssueService.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  Orchestrator.OrchestratorV2,
  IssueService.IssueService,
  ThreadIssueService.ThreadIssueService,
];

export const IssueTargetInput = Schema.Struct({
  issue: TrimmedNonEmptyString.annotate({
    description:
      "The issue's web URL, owner/repo#42, or #42 for an issue in this thread's own repository. GitHub and GitLab issues are supported.",
  }),
});
export type IssueTargetInput = typeof IssueTargetInput.Type;

export class IssueListFailedError extends Schema.TaggedError<IssueListFailedError>()(
  "IssueListFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not list the linked issues.";
  }
}

export const IssueToolError = Schema.Union([
  McpCapabilityUnavailableError,
  IssueReferenceInvalidError,
  IssueThreadNotFoundError,
  IssueThreadReadError,
  IssueLinkFailedError,
  IssueUnlinkFailedError,
  IssueListFailedError,
  IssueUnavailableError,
  IssueReadError,
]);
export type IssueToolError = typeof IssueToolError.Type;

const IssueIdentity = {
  tracker: Schema.String,
  key: Schema.String,
  url: Schema.String,
};

export const LinkIssueResult = Schema.Struct({
  ...IssueIdentity,
  alreadyLinked: Schema.Boolean.annotate({
    description: "True when the issue was linked to this thread before the call.",
  }),
});
export type LinkIssueResult = typeof LinkIssueResult.Type;

export const UnlinkIssueResult = Schema.Struct({
  ...IssueIdentity,
  wasLinked: Schema.Boolean.annotate({
    description: "False when the issue was not linked to this thread to begin with.",
  }),
});
export type UnlinkIssueResult = typeof UnlinkIssueResult.Type;

export const LinkedIssueEntry = Schema.Struct({
  ...IssueIdentity,
  source: ThreadIssueLinkSource,
  state: Schema.NullOr(ThreadIssueState),
  title: Schema.NullOr(Schema.String),
  syncError: Schema.NullOr(Schema.String).annotate({
    description: "Why T3 Code could not read the issue last time; null when it could.",
  }),
});
export type LinkedIssueEntry = typeof LinkedIssueEntry.Type;

export const ListLinkedIssuesResult = Schema.Struct({
  issues: Schema.Array(LinkedIssueEntry),
});
export type ListLinkedIssuesResult = typeof ListLinkedIssuesResult.Type;

export const ReadIssueInput = Schema.Struct({
  ...IssueTargetInput.fields,
  commentsCursor: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description: "nextCommentsCursor from a previous read_issue call, to read later comments.",
    }),
  ),
});
export type ReadIssueInput = typeof ReadIssueInput.Type;

export const ReadIssueResult = Schema.Struct({
  markdown: Schema.String.annotate({
    description: "The issue and a page of its comments, oldest first, as markdown.",
  }),
  nextCommentsCursor: Schema.NullOr(Schema.String).annotate({
    description: "Pass back as commentsCursor to read more comments; null when there are none.",
  }),
});
export type ReadIssueResult = typeof ReadIssueResult.Type;

const LinkIssueTool = Tool.make("link_issue", {
  description:
    "Link an issue to this thread so T3 Code shows its title and state beside the thread. Link the issue a thread is working on. Linking an already-linked issue succeeds with alreadyLinked=true.",
  parameters: IssueTargetInput,
  success: LinkIssueResult,
  failure: IssueToolError,
  dependencies,
})
  .annotate(Tool.Title, "Link issue to thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const UnlinkIssueTool = Tool.make("unlink_issue", {
  description:
    "Remove an issue link from this thread. Unlinking an issue that is not linked succeeds with wasLinked=false.",
  parameters: IssueTargetInput,
  success: UnlinkIssueResult,
  failure: IssueToolError,
  dependencies,
})
  .annotate(Tool.Title, "Unlink issue from thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const ListLinkedIssuesTool = Tool.make("list_linked_issues", {
  description:
    "List the issues linked to this thread with their last known title and state. Use read_issue for the full text.",
  success: ListLinkedIssuesResult,
  failure: IssueToolError,
  dependencies,
})
  .annotate(Tool.Title, "List linked issues")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const ReadIssueTool = Tool.make("read_issue", {
  description:
    "Read an issue's description, labels, state, and comments from its tracker, using this environment's credentials. Works for any issue, linked or not. Prefer it over tracker CLIs.",
  parameters: ReadIssueInput,
  success: ReadIssueResult,
  failure: IssueToolError,
  dependencies,
})
  .annotate(Tool.Title, "Read issue")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const IssuesToolkit = Toolkit.make(
  LinkIssueTool,
  UnlinkIssueTool,
  ListLinkedIssuesTool,
  ReadIssueTool,
);
