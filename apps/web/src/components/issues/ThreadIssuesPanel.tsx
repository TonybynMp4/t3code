import type {
  IssueRef,
  ProjectId,
  ScopedThreadRef,
  ThreadIssueClosedReason,
  ThreadIssueLink,
  ThreadIssueState,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  threadIssueKeyOf,
  threadIssueKeysEqual,
  threadIssuesOf,
} from "@t3tools/shared/threadIssues";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleSlashIcon,
  LinkIcon,
  MoreHorizontalIcon,
  PlusIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { issueEnvironment } from "~/state/issues";
import { useProject, useServerConfigs, useThreadShell } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { PullRequestMarkdown } from "../pullRequest/PullRequestMarkdown";
import {
  PULL_REQUEST_ROW_CLASS,
  PULL_REQUEST_ROW_NUMBER_CLASS,
  PullRequestRowAuthor,
  PullRequestRowLines,
} from "../pullRequest/PullRequestListRow";
import { PULL_REQUEST_STATE_PRESENTATION, PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { PullRequestLabelChip } from "../pullRequest/pullRequestPresentation";
import { PullRequestCommentBody } from "../pullRequest/PullRequestCommentBody";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { openLinkIssueDialog } from "./LinkIssueDialog";

const SOURCE_LABELS: Record<ThreadIssueLink["source"], string> = {
  manual: "Linked by you",
  agent: "Linked by the agent",
};

function IssueStateGlyph({
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
    <div className={cn(PULL_REQUEST_ROW_CLASS, "relative px-2 hover:bg-accent/60")}>
      {unreadable ? (
        <CircleAlertIcon
          aria-label="Could not read the issue"
          className="size-4 shrink-0 text-destructive"
        />
      ) : (
        <IssueStateGlyph state={snapshot?.state ?? null} closedReason={snapshot?.closedReason} />
      )}
      <button type="button" onClick={() => onSelect(link)} className="flex min-w-0 flex-1">
        <PullRequestRowLines
          number={
            <Tooltip>
              <TooltipTrigger render={<span className={PULL_REQUEST_ROW_NUMBER_CLASS} />}>
                {link.displayKey}
              </TooltipTrigger>
              <TooltipPopup>
                {SOURCE_LABELS[link.source]} · {formatRelativeTimeLabel(link.linkedAt)}
                {link.syncError === undefined ? null : (
                  <>
                    <br />
                    Last refresh failed: {link.syncError}
                  </>
                )}
              </TooltipPopup>
            </Tooltip>
          }
          title={
            snapshot?.title ??
            (link.syncError === undefined ? link.host : `Could not read: ${link.syncError}`)
          }
          meta={
            snapshot?.author ? (
              <PullRequestRowAuthor
                actor={snapshot.author}
                className="shrink-0"
                labelClassName="max-w-28"
              />
            ) : null
          }
          updatedAt={snapshot?.updatedAt}
        />
      </button>
      <Menu>
        <MenuTrigger
          render={
            <Button variant="ghost" size="icon-micro" aria-label={`Actions for ${link.displayKey}`}>
              <MoreHorizontalIcon className="size-3.5" />
            </Button>
          }
        />
        <MenuPopup align="end" side="bottom">
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
        </MenuPopup>
      </Menu>
    </div>
  );
}

/** Read-only view of one linked issue: what the tracker says now, then its comments. */
function IssueDetailView({
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
          aria-label="Back to linked issues"
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

export function ThreadIssuesPanel({ threadRef }: { threadRef: ScopedThreadRef }) {
  const configs = useServerConfigs();
  if (configs.get(threadRef.environmentId)?.environment.capabilities.threadIssues !== true) {
    return (
      <Empty className="min-h-0 justify-center-safe">
        <EmptyMedia variant="icon">
          <CircleDotIcon />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>Linked issues unavailable</EmptyTitle>
          <EmptyDescription>
            This environment does not support linking issues. Update its T3 Code server.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return <EnabledThreadIssuesPanel threadRef={threadRef} />;
}

function EnabledThreadIssuesPanel({ threadRef }: { threadRef: ScopedThreadRef }) {
  const thread = useThreadShell(threadRef);
  const [selected, setSelected] = useState<ThreadIssueLink | null>(null);
  const openLinkDialog = useCallback(() => openLinkIssueDialog(threadRef), [threadRef]);
  const unlink = useAtomCommand(threadEnvironment.unlinkIssue, { reportFailure: true });
  const links = useMemo(() => (thread === null ? [] : threadIssuesOf(thread)), [thread]);
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
  // Follow the live link, so an unlink from elsewhere closes the detail view.
  const selectedLink =
    selected === null ? null : (links.find((link) => threadIssueKeysEqual(link, selected)) ?? null);

  if (selectedLink !== null && thread !== null) {
    return (
      <IssueDetailView
        key={threadIssueKeyOf(selectedLink)}
        link={selectedLink}
        threadRef={threadRef}
        projectId={thread.projectId}
        onBack={() => setSelected(null)}
      />
    );
  }

  if (links.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <CircleDotIcon aria-hidden className="size-6 text-muted-foreground/60" />
        <p className="text-sm font-medium">No linked issues</p>
        <p className="max-w-60 text-xs text-muted-foreground">
          Link the GitHub or GitLab issue this thread works on. The agent can read it too.
        </p>
        <Button size="sm" variant="outline" onClick={openLinkDialog}>
          <PlusIcon className="size-3.5" />
          Link issue
        </Button>
      </div>
    );
  }

  const openCount = links.filter((link) => link.snapshot?.state === "open").length;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col p-1.5">
          {links.map((link) => (
            <IssueRow
              key={threadIssueKeyOf(link)}
              link={link}
              threadRef={threadRef}
              onSelect={setSelected}
              onUnlink={handleUnlink}
            />
          ))}
        </div>
      </ScrollArea>
      <footer className="flex items-center justify-between border-t border-border/60 px-2 py-1.5 text-2xs text-muted-foreground">
        <span>
          {openCount} open · {links.length} linked
        </span>
        <Button size="xs" variant="ghost" onClick={openLinkDialog}>
          <PlusIcon className="size-3.5" />
          Link
        </Button>
      </footer>
    </div>
  );
}
