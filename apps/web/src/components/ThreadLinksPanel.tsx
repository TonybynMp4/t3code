import type { ScopedThreadRef, ThreadIssueLink } from "@t3tools/contracts";
import {
  threadIssueKeyOf,
  threadIssueKeysEqual,
  threadIssuesOf,
} from "@t3tools/shared/threadIssues";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import { CircleDotIcon, PlusIcon } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { useServerConfigs, useThreadShell } from "~/state/entities";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { ThreadIssueDetail, ThreadIssueRows } from "./issues/ThreadIssueRows";
import { openLinkThreadItemDialog } from "./LinkThreadItemDialog";
import { PullRequestGlyph } from "./pullRequest/pullRequestIcons";
import { PullRequestsUnavailableState } from "./pullRequest/PullRequestsUnavailableState";
import { ThreadPullRequestRows } from "./pullRequest/ThreadPullRequestRows";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";

function LinkSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h3 className="px-2 pt-1.5 pb-1 text-2xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** Everything linked to a thread: its pull requests and its issues, in one tab. */
export function ThreadLinksPanel({ threadRef }: { threadRef: ScopedThreadRef }) {
  const capabilities = useServerConfigs().get(threadRef.environmentId)?.environment.capabilities;
  const supportsPullRequests = capabilities?.threadPullRequests === true;
  const supportsIssues = capabilities?.threadIssues === true;
  if (!supportsPullRequests && !supportsIssues) {
    return (
      <PullRequestsUnavailableState
        title="Linked items unavailable"
        error="This environment does not support linking pull requests or issues. Update its T3 Code server."
      />
    );
  }
  return (
    <EnabledThreadLinksPanel
      threadRef={threadRef}
      supportsPullRequests={supportsPullRequests}
      supportsIssues={supportsIssues}
    />
  );
}

function EnabledThreadLinksPanel({
  threadRef,
  supportsPullRequests,
  supportsIssues,
}: {
  threadRef: ScopedThreadRef;
  supportsPullRequests: boolean;
  supportsIssues: boolean;
}) {
  const thread = useThreadShell(threadRef);
  const [selectedIssue, setSelectedIssue] = useState<ThreadIssueLink | null>(null);
  const pullRequests = useMemo(
    () => (supportsPullRequests ? visibleThreadPullRequests(thread?.pullRequests ?? []) : []),
    [supportsPullRequests, thread],
  );
  const issues = useMemo(
    () => (supportsIssues && thread !== null ? threadIssuesOf(thread) : []),
    [supportsIssues, thread],
  );
  const linkPullRequest = useCallback(
    () => openLinkThreadItemDialog(threadRef, "pull-request"),
    [threadRef],
  );
  const linkIssue = useCallback(() => openLinkThreadItemDialog(threadRef, "issue"), [threadRef]);
  const linkAny = useCallback(() => openLinkThreadItemDialog(threadRef), [threadRef]);
  const links = useMemo(() => [...pullRequests, ...issues], [pullRequests, issues]);
  const lastSynced = useMemo(() => {
    let latest: string | null = null;
    for (const link of links) {
      const at = link.snapshot?.syncedAt;
      if (at !== undefined && (latest === null || at > latest)) latest = at;
    }
    return latest;
  }, [links]);

  // Follow the live link, so an unlink from elsewhere closes the detail view.
  const selectedIssueLink =
    selectedIssue === null
      ? null
      : (issues.find((link) => threadIssueKeysEqual(link, selectedIssue)) ?? null);
  if (selectedIssueLink !== null && thread !== null) {
    return (
      <ThreadIssueDetail
        key={threadIssueKeyOf(selectedIssueLink)}
        link={selectedIssueLink}
        threadRef={threadRef}
        projectId={thread.projectId}
        onBack={() => setSelectedIssue(null)}
      />
    );
  }

  if (links.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <PullRequestGlyph.link aria-hidden className="size-6 text-muted-foreground/60" />
        <p className="text-sm font-medium">Nothing linked yet</p>
        <p className="max-w-60 text-xs text-muted-foreground">
          {supportsIssues
            ? "Pull requests the agent opens from this thread land here. Link the issue it works on so the agent can read it."
            : "Pull requests the agent opens from this thread land here. Link one yourself from a URL or a number."}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {supportsPullRequests ? (
            <Button size="sm" variant="outline" onClick={linkPullRequest}>
              <PullRequestGlyph.link className="size-3.5" />
              Link pull request
            </Button>
          ) : null}
          {supportsIssues ? (
            <Button size="sm" variant="outline" onClick={linkIssue}>
              <CircleDotIcon className="size-3.5" />
              Link issue
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const openCount = links.filter(
    (link) => link.snapshot === null || link.snapshot.state === "open",
  ).length;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-1.5">
          {pullRequests.length > 0 ? (
            <LinkSection title="Pull requests">
              <ThreadPullRequestRows threadRef={threadRef} links={pullRequests} />
            </LinkSection>
          ) : null}
          {issues.length > 0 ? (
            <LinkSection title="Issues">
              <ThreadIssueRows threadRef={threadRef} links={issues} onSelect={setSelectedIssue} />
            </LinkSection>
          ) : null}
        </div>
      </ScrollArea>
      <footer className="flex items-center justify-between border-t border-border/60 px-2 py-1.5 text-2xs text-muted-foreground">
        <span>
          {openCount} open · {links.length} linked
          {lastSynced ? ` · synced ${formatRelativeTimeLabel(lastSynced)}` : ""}
        </span>
        <Button size="xs" variant="ghost" onClick={linkAny}>
          <PlusIcon className="size-3.5" />
          Link
        </Button>
      </footer>
    </div>
  );
}
