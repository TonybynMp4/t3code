import {
  pullRequestHostOf,
  type ScopedThreadRef,
  type SourceControlProviderKind,
} from "@t3tools/contracts";
import { changeRequestUrlFor } from "@t3tools/shared/changeRequestUrl";
import {
  parseGitIssueId,
  parseIssueUrl,
  projectIssueDefaults,
  resolveIssueReference,
  threadIssueKeysEqual,
  threadIssuesOf,
} from "@t3tools/shared/threadIssues";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useIssueLinking } from "~/hooks/useIssueLinking";
import { usePullRequestLinking } from "~/hooks/usePullRequestLinking";
import { parseChangeRequestUrl } from "~/lib/openPullRequestLink";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useProjects, useThreadShell } from "~/state/entities";
import { resolveLinkPullRequestInput } from "./pullRequest/LinkPullRequestDialog";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Toggle, ToggleGroup } from "./ui/toggle-group";

export type LinkThreadItemKind = "pull-request" | "issue";

/**
 * Which thread has the link dialog open, and which kind it starts on. Set by whichever entry
 * point asked (command palette, Linked tab) and rendered once by the chat view, so the dialog
 * outlives a palette that closes the moment its command runs.
 */
const linkThreadItemDialogAtom = Atom.make<{
  readonly threadRef: ScopedThreadRef;
  readonly kind: LinkThreadItemKind | null;
} | null>(null).pipe(Atom.keepAlive, Atom.withLabel("thread-links:link-dialog"));

/** Without a kind, the dialog starts on pull requests where the environment links them. */
export function openLinkThreadItemDialog(
  threadRef: ScopedThreadRef,
  kind: LinkThreadItemKind | null = null,
): void {
  appAtomRegistry.set(linkThreadItemDialogAtom, { threadRef, kind });
}

/**
 * The kind a pasted URL names, or null when the input does not say (a bare `42` or `#42`).
 * Both hosts keep the two apart in the path: GitHub's `/pull/` and `/issues/`, GitLab's
 * `/-/merge_requests/` and `/-/issues/`.
 */
export function linkThreadItemKindOf(reference: string): LinkThreadItemKind | null {
  const trimmed = reference.trim();
  if (parseChangeRequestUrl(trimmed) !== null) return "pull-request";
  if (parseIssueUrl(trimmed) !== null) return "issue";
  return null;
}

/** Mounted once per chat view; shows the dialog for whichever thread asked for it. */
export function LinkThreadItemDialogHost() {
  const request = useAtomValue(linkThreadItemDialogAtom);
  const pullRequestLinking = usePullRequestLinking(request?.threadRef.environmentId);
  const issueLinking = useIssueLinking(request?.threadRef.environmentId);
  const supportsPullRequests = pullRequestLinking.mode !== "unsupported";
  const supportsIssues = issueLinking.supported;
  if (request === null || (!supportsPullRequests && !supportsIssues)) return null;
  const initialKind =
    request.kind === "issue" && supportsIssues
      ? "issue"
      : supportsPullRequests
        ? "pull-request"
        : "issue";
  return (
    <LinkThreadItemDialog
      key={`${request.threadRef.environmentId}:${request.threadRef.threadId}:${initialKind}`}
      threadRef={request.threadRef}
      initialKind={initialKind}
      supportsPullRequests={supportsPullRequests}
      supportsIssues={supportsIssues}
      onClose={() => appAtomRegistry.set(linkThreadItemDialogAtom, null)}
    />
  );
}

function LinkThreadItemDialog({
  threadRef,
  initialKind,
  supportsPullRequests,
  supportsIssues,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  initialKind: LinkThreadItemKind;
  supportsPullRequests: boolean;
  supportsIssues: boolean;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [reference, setReference] = useState("");
  const [chosenKind, setChosenKind] = useState(initialKind);
  const [dirty, setDirty] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const thread = useThreadShell(threadRef);
  const projects = useProjects();
  const pullRequestLinking = usePullRequestLinking(threadRef.environmentId);
  const issueLinking = useIssueLinking(threadRef.environmentId);

  const repositoryIdentity = projects.find(
    (candidate) =>
      candidate.environmentId === threadRef.environmentId && candidate.id === thread?.projectId,
  )?.repositoryIdentity;
  // Bare numbers resolve against the thread's own repository.
  const ownPullRequestProject = useMemo(() => {
    const identity = repositoryIdentity;
    if (!identity) return null;
    const repository =
      identity.displayName ??
      (identity.owner && identity.name ? `${identity.owner}/${identity.name}` : null);
    if (repository === null) return null;
    const kind = identity.provider as SourceControlProviderKind;
    const host = pullRequestHostOf(identity, kind);
    return {
      host,
      repository,
      webUrl: (number: number) =>
        kind === "forgejo" && identity.webUrl
          ? `${identity.webUrl.replace(/\/+$/, "")}/pulls/${number}`
          : changeRequestUrlFor(kind, host, repository, number, identity.locator.remoteUrl),
    };
  }, [repositoryIdentity]);
  const issueDefaults = useMemo(
    () => projectIssueDefaults(repositoryIdentity),
    [repositoryIdentity],
  );

  // A pasted URL says what it is; the toggle only decides for bare numbers.
  const detectedKind = linkThreadItemKindOf(reference);
  const kind = detectedKind ?? chosenKind;
  const kindSupported = kind === "pull-request" ? supportsPullRequests : supportsIssues;

  const resolved = useMemo((): { reference: string; label: string } | { error: string } | null => {
    if (kind === "pull-request") {
      const result = resolveLinkPullRequestInput({
        reference,
        project: ownPullRequestProject,
        hasProject: (link) => pullRequestLinking.canLink(link.url),
      });
      if (result === null || "error" in result) return result;
      if (pullRequestLinking.isLinked(thread, result.link.url))
        return { error: "This pull request is already linked." };
      return {
        reference: result.link.url,
        label: `${result.link.host}/${result.link.repository} #${result.link.number}`,
      };
    }
    const issue = resolveIssueReference(reference, issueDefaults);
    if (issue === null) {
      // A remote whose host name does not say GitHub or GitLab (a self-hosted GitLab, say) only
      // gets a tracker once the server asks its CLIs, so the server resolves the number.
      const trimmed = reference.trim();
      const serverResolvable =
        issueDefaults === null &&
        (repositoryIdentity?.provider ?? "unknown") === "unknown" &&
        repositoryIdentity?.locator !== undefined &&
        (/^#?[1-9]\d*$/u.test(trimmed) || parseGitIssueId(trimmed)?.repository.includes("/"));
      return serverResolvable
        ? { reference: trimmed, label: `${trimmed} in this project's tracker` }
        : null;
    }
    if (
      thread !== null &&
      threadIssuesOf(thread).some((entry) => threadIssueKeysEqual(entry, issue))
    )
      return { error: "This issue is already linked." };
    return { reference: issue.url, label: `${issue.host}/${issue.displayKey}` };
  }, [
    issueDefaults,
    kind,
    ownPullRequestProject,
    pullRequestLinking,
    reference,
    repositoryIdentity,
    thread,
  ]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // The server reads the item before linking, so a typo or a number of the other kind comes
  // back as an error here instead of a link that never syncs.
  const submit = useCallback(async () => {
    setDirty(true);
    if (!kindSupported || resolved === null || "error" in resolved) return;
    setSubmitError(null);
    setPending(true);
    try {
      await (kind === "pull-request" ? pullRequestLinking : issueLinking).changeLink(
        threadRef,
        resolved.reference,
        true,
      );
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : `Could not link the ${kind === "pull-request" ? "pull request" : "issue"}.`,
      );
      return;
    } finally {
      setPending(false);
    }
    onClose();
  }, [issueLinking, kind, kindSupported, onClose, pullRequestLinking, resolved, threadRef]);

  const noun = kind === "pull-request" ? "pull request" : "issue";
  const validation = !kindSupported
    ? `This environment cannot link ${noun}s.`
    : !dirty
      ? null
      : reference.trim().length === 0
        ? `Paste a ${noun} URL or enter #42.`
        : resolved === null
          ? kind === "issue" && issueDefaults === null
            ? "Paste a GitHub or GitLab issue URL."
            : kind === "issue"
              ? "Use an issue URL, owner/repo#42, or #42."
              : "Use a pull request URL, 123, or #123."
          : "error" in resolved
            ? resolved.error
            : null;
  const bothKinds = supportsPullRequests && supportsIssues;

  return (
    <Dialog open onOpenChange={(next) => (pending || next ? undefined : onClose())}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {bothKinds ? "Link to thread" : kind === "issue" ? "Link issue" : "Link pull request"}
          </DialogTitle>
          <DialogDescription>
            {bothKinds
              ? "Attach a pull request or an issue to this thread. A pasted URL says which it is; pick the kind for a bare number."
              : kind === "issue"
                ? "Attach a GitHub or GitLab issue to this thread. The agent can read linked issues."
                : "Attach a pull request to this thread. A full URL can point at any repository on a host this environment has a project for."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              className="min-w-0 flex-1"
              placeholder={
                bothKinds ? "URL or #42" : `${noun[0]!.toUpperCase()}${noun.slice(1)} URL or #42`
              }
              value={reference}
              onChange={(event) => {
                setDirty(true);
                setSubmitError(null);
                setReference(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void submit();
              }}
            />
            {bothKinds ? (
              <ToggleGroup
                aria-label="Kind to link"
                className="shrink-0"
                variant="segmented"
                value={[kind]}
                disabled={detectedKind !== null || pending}
                onValueChange={(value) => {
                  const next = value[0];
                  if (next === "pull-request" || next === "issue") {
                    setChosenKind(next);
                    setSubmitError(null);
                  }
                }}
              >
                <Toggle value="pull-request">Pull request</Toggle>
                <Toggle value="issue">Issue</Toggle>
              </ToggleGroup>
            ) : null}
          </div>
          {resolved !== null && "reference" in resolved ? (
            <p className="truncate text-muted-foreground text-xs">{resolved.label}</p>
          ) : null}
          {(validation ?? submitError) ? (
            <p className="text-destructive text-xs">{validation ?? submitError}</p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={pending || !kindSupported || resolved === null || "error" in resolved}
          >
            {pending ? "Linking..." : "Link"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
