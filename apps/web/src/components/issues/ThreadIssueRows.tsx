import type {
  IssueRef,
  ProjectId,
  ScopedThreadRef,
  ThreadIssueClosedReason,
  ThreadIssueLink,
  ThreadIssueState,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { threadIssueKeyOf } from "@t3tools/shared/threadIssues";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleSlashIcon,
  LinkIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { issueEnvironment } from "~/state/issues";
import { useProject } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { PullRequestMarkdown } from "../pullRequest/PullRequestMarkdown";
import { PullRequestRowAuthor } from "../pullRequest/PullRequestListRow";
import { PULL_REQUEST_STATE_PRESENTATION, PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { PullRequestLabelChip } from "../pullRequest/pullRequestPresentation";
import { PullRequestCommentBody } from "../pullRequest/PullRequestCommentBody";
import { Button } from "../ui/button";
import { LinkedItemRowActions, LinkedItemRowLines, LINKED_ITEM_ROW_CLASS } from "../LinkedItemRow";
import { MenuItem } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";

const SOURCE_LABELS: Record<ThreadIssueLink["source"], string> = {
  manual: "Linked by you",
  agent: "Linked by the agent",
};

export function IssueStateGlyph({
  state,
  closedReason,
}: {
  state: ThreadIssueState | null;
  closedReason?: ThreadIssueClosedReason | undefined;
}) {
  if (state === null) {
    return (
      <CircleDotIcon
        aria-label="Waiting for tracker state"
        className="size-4 shrink-0 text-muted-foreground"
      />
    );
  }
  if (state === "open") {
    return (
      <CircleDotIcon
        aria-label="Open"
        className={cn("size-4 shrink-0", PULL_REQUEST_STATE_PRESENTATION.open.toneClassName)}
      />
    );
  }
  // Closed as done reads like a merged pull request; closed as not planned is greyed out.
  if (closedReason === "not-planned") {
    return (
      <CircleSlashIcon
        aria-label="Closed as not planned"
        className={cn("size-4 shrink-0", PULL_REQUEST_STATE_PRESENTATION.draft.toneClassName)}
      />
    );
  }
  return (
    <CircleCheckIcon
      aria-label="Closed"
      className={cn("size-4 shrink-0", PULL_REQUEST_STATE_PRESENTATION.merged.toneClassName)}
    />
  );
}

function IssueRow({
  link,
  threadRef,
  onSelect,
  onUnlink,
}: {
  link: ThreadIssueLink;
  threadRef: ScopedThreadRef;
  onSelect: (link: ThreadIssueLink) => void;
  onUnlink: (link: ThreadIssueLink) => void;
}) {
  const openLink = useOpenLink(threadRef);
  const snapshot = link.snapshot;
  // Never read: say why rather than looking pending. Read before: keep the last state shown.
  const unreadable = snapshot === null && link.syncError !== undefined;
  return (
    <div className={cn(LINKED_ITEM_ROW_CLASS, "pl-2")}>
      <span className="mt-3.5 inline-flex shrink-0">
        {unreadable ? (
          <CircleAlertIcon
            aria-label="Could not read the issue"
            className="size-4 shrink-0 text-destructive"
          />
        ) : (
          <IssueStateGlyph state={snapshot?.state ?? null} closedReason={snapshot?.closedReason} />
        )}
      </span>
      <button type="button" onClick={() => onSelect(link)} className="flex min-w-0 flex-1">
        <LinkedItemRowLines
          reference={link.displayKey}
          referenceTooltip={
            <>
              {SOURCE_LABELS[link.source]} · {formatRelativeTimeLabel(link.linkedAt)}
              {link.syncError === undefined ? null : (
                <>
                  <br />
                  Last refresh failed: {link.syncError}
                </>
              )}
            </>
          }
          updatedAt={snapshot?.updatedAt}
          title={
            snapshot?.title ??
            (link.syncError === undefined ? link.host : `Could not read: ${link.syncError}`)
          }
          meta={
            snapshot !== null && (snapshot.author || snapshot.labels.length > 0) ? (
              <>
                {snapshot.author ? (
                  <PullRequestRowAuthor
                    actor={snapshot.author}
                    className="shrink-0"
                    labelClassName="max-w-28"
                  />
                ) : null}
                {snapshot.labels.map((label) => (
                  <PullRequestLabelChip key={label.name} label={label} className="max-w-28" />
                ))}
              </>
            ) : null
          }
        />
      </button>
      <LinkedItemRowActions label={`Actions for ${link.displayKey}`}>
        <MenuItem onClick={() => void writeTextToClipboard(link.url, "link")}>
          <LinkIcon className="size-3.5" />
          Copy link
        </MenuItem>
        <MenuItem onClick={(event) => void openLink(link.url, { event })}>
          <ArrowUpRightIcon className="size-3.5" />
          Open
        </MenuItem>
        <MenuItem onClick={() => onUnlink(link)}>
          <PullRequestGlyph.unlink className="size-3.5" />
          Unlink from thread
        </MenuItem>
      </LinkedItemRowActions>
    </div>
  );
}

/** Read-only view of one linked issue: what the tracker says now, then its comments. */
export function ThreadIssueDetail({
  link,
  threadRef,
  projectId,
  onBack,
}: {
  link: ThreadIssueLink;
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
  onBack: () => void;
}) {
  const project = useProject(scopeProjectRef(threadRef.environmentId, projectId));
  const openLink = useOpenLink(threadRef);
  // One entry per loaded comment page: the cursor the server returned for it.
  const [commentCursors, setCommentCursors] = useState<ReadonlyArray<string | undefined>>([
    undefined,
  ]);
  const ref = useMemo<IssueRef>(
    () => ({ projectId, tracker: link.tracker, host: link.host, id: link.id }),
    [link.host, link.id, link.tracker, projectId],
  );
  const detail = useEnvironmentQuery(
    issueEnvironment.detail({ environmentId: threadRef.environmentId, input: ref }),
  );
  const issue = detail.data;
  const cwd = project?.workspaceRoot ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-1 border-b border-border/60 px-1.5 py-1">
        <Button
          variant="ghost"
          size="icon-micro"
          aria-label="Back to linked items"
          onClick={onBack}
        >
          <ArrowLeftIcon className="size-3.5" />
        </Button>
        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
          {link.displayKey}
        </span>
        <Button
          variant="ghost"
          size="icon-micro"
          aria-label="Open on tracker"
          onClick={(event) => void openLink(link.url, { event })}
        >
          <ArrowUpRightIcon className="size-3.5" />
        </Button>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          {issue === null ? (
            detail.error ? (
              <p className="text-destructive text-xs">{detail.error}</p>
            ) : (
              <p className="text-muted-foreground text-xs">Loading…</p>
            )
          ) : (
            <>
              <div className="flex items-start gap-2">
                <IssueStateGlyph state={issue.state} closedReason={issue.closedReason} />
                <h2 className="min-w-0 text-sm font-medium">{issue.title}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
                <PullRequestRowAuthor actor={issue.author} labelClassName="max-w-28" />
                <span>opened {formatRelativeTimeLabel(issue.createdAt)}</span>
                {issue.closedAt ? (
                  <span>· closed {formatRelativeTimeLabel(issue.closedAt)}</span>
                ) : null}
                {issue.labels.map((label) => (
                  <PullRequestLabelChip key={label.name} label={label} className="max-w-40" />
                ))}
              </div>
              {cwd === null ? null : issue.body.trim().length === 0 ? (
                <p className="text-muted-foreground text-xs italic">No description.</p>
              ) : (
                <PullRequestMarkdown
                  text={issue.body}
                  cwd={cwd}
                  environmentId={threadRef.environmentId}
                  threadRef={threadRef}
                />
              )}
              {cwd === null || issue.commentCount === 0
                ? null
                : commentCursors.map((cursor, index) => (
                    <IssueCommentsPage
                      key={cursor ?? ""}
                      threadRef={threadRef}
                      issueRef={ref}
                      cwd={cwd}
                      cursor={cursor}
                      isLast={index === commentCursors.length - 1}
                      onMore={(next) => setCommentCursors((cursors) => [...cursors, next])}
                    />
                  ))}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function IssueCommentsPage({
  threadRef,
  issueRef,
  cwd,
  cursor,
  isLast,
  onMore,
}: {
  threadRef: ScopedThreadRef;
  issueRef: IssueRef;
  cwd: string;
  cursor: string | undefined;
  isLast: boolean;
  onMore: (nextCursor: string) => void;
}) {
  const page = useEnvironmentQuery(
    issueEnvironment.comments({
      environmentId: threadRef.environmentId,
      input: {
        ...issueRef,
        ...(cursor === undefined ? {} : { cursor }),
      },
    }),
  );
  if (page.data === null) {
    return page.error ? <p className="text-destructive text-xs">{page.error}</p> : null;
  }
  const { nextCursor } = page.data;
  return (
    <>
      {page.data.comments.map((comment) => (
        <section key={comment.id} className="border-t border-border/60 pt-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-2xs text-muted-foreground">
            <PullRequestRowAuthor actor={comment.author} labelClassName="max-w-28" />
            <span>{formatRelativeTimeLabel(comment.createdAt)}</span>
          </div>
          <PullRequestCommentBody
            text={comment.body}
            cwd={cwd}
            environmentId={threadRef.environmentId}
            threadRef={threadRef}
          />
        </section>
      ))}
      {isLast && nextCursor !== null ? (
        <Button size="xs" variant="ghost" onClick={() => onMore(nextCursor)}>
          Load more comments
        </Button>
      ) : null}
    </>
  );
}

/** The thread's linked issues as rows, for the Linked tab. Selecting one opens its detail. */
export function ThreadIssueRows({
  threadRef,
  links,
  onSelect,
}: {
  threadRef: ScopedThreadRef;
  links: ReadonlyArray<ThreadIssueLink>;
  onSelect: (link: ThreadIssueLink) => void;
}) {
  const unlink = useAtomCommand(threadEnvironment.unlinkIssue, { reportFailure: true });
  const handleUnlink = useCallback(
    (link: ThreadIssueLink) => {
      void unlink({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          tracker: link.tracker,
          host: link.host,
          id: link.id,
        },
      });
    },
    [threadRef, unlink],
  );

  return links.map((link) => (
    <IssueRow
      key={threadIssueKeyOf(link)}
      link={link}
      threadRef={threadRef}
      onSelect={onSelect}
      onUnlink={handleUnlink}
    />
  ));
}
