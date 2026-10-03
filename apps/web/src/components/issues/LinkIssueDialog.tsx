import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  projectIssueDefaults,
  resolveIssueReference,
  threadIssueKeysEqual,
  threadIssuesOf,
} from "@t3tools/shared/threadIssues";
import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useProjects, useServerConfigs, useThreadShell } from "~/state/entities";
import { issueEnvironment } from "~/state/issues";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

/**
 * Which thread has the link dialog open. Set by any entry point (command palette, issues panel)
 * and rendered once by the chat view, so the dialog outlives a palette that closes on run.
 */
const linkIssueDialogThreadAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("issues:link-dialog-thread"),
);

export function openLinkIssueDialog(threadRef: ScopedThreadRef): void {
  appAtomRegistry.set(linkIssueDialogThreadAtom, threadRef);
}

/** Mounted once per chat view; shows the dialog for whichever thread asked for it. */
export function LinkIssueDialogHost() {
  const threadRef = useAtomValue(linkIssueDialogThreadAtom);
  const configs = useServerConfigs();
  if (
    threadRef === null ||
    configs.get(threadRef.environmentId)?.environment.capabilities.threadIssues !== true
  ) {
    return null;
  }
  return (
    <LinkIssueDialog
      threadRef={threadRef}
      onClose={() => appAtomRegistry.set(linkIssueDialogThreadAtom, null)}
    />
  );
}

function LinkIssueDialog({
  threadRef,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [reference, setReference] = useState("");
  const [dirty, setDirty] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const thread = useThreadShell(threadRef);
  const projects = useProjects();
  const link = useAtomCommand(issueEnvironment.link, { reportFailure: false });

  const defaults = useMemo(() => {
    const project = projects.find(
      (candidate) =>
        candidate.environmentId === threadRef.environmentId && candidate.id === thread?.projectId,
    );
    return projectIssueDefaults(project?.repositoryIdentity);
  }, [projects, thread?.projectId, threadRef.environmentId]);
  const resolved = useMemo(() => resolveIssueReference(reference, defaults), [defaults, reference]);
  const alreadyLinked =
    resolved !== null &&
    thread !== null &&
    threadIssuesOf(thread).some((entry) => threadIssueKeysEqual(entry, resolved));

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // The server resolves the reference again and reads the issue, so a typo or a pull request
  // number comes back as an error here instead of a link that never syncs.
  const submit = useCallback(async () => {
    setDirty(true);
    if (resolved === null || alreadyLinked) return;
    setSubmitError(null);
    setPending(true);
    const result = await link({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, reference: reference.trim() },
    });
    setPending(false);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      setSubmitError(error instanceof Error ? error.message : "Could not link the issue.");
      return;
    }
    onClose();
  }, [alreadyLinked, link, onClose, reference, resolved, threadRef]);

  const validation = !dirty
    ? null
    : reference.trim().length === 0
      ? "Paste an issue URL or enter #42."
      : resolved === null
        ? defaults === null
          ? "Paste a GitHub or GitLab issue URL."
          : "Use an issue URL, owner/repo#42, or #42."
        : alreadyLinked
          ? "This issue is already linked."
          : null;

  return (
    <Dialog open onOpenChange={(next) => (pending || next ? undefined : onClose())}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Link issue</DialogTitle>
          <DialogDescription>
            Attach a GitHub or GitLab issue to this thread. The agent can read linked issues.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Input
            ref={inputRef}
            placeholder={defaults === null ? "Issue URL" : "Issue URL, owner/repo#42, or #42"}
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
          {resolved !== null ? (
            <p className="truncate text-muted-foreground text-xs">
              {resolved.host}/{resolved.displayKey}
            </p>
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
            disabled={pending || resolved === null || alreadyLinked}
          >
            {pending ? "Linking..." : "Link"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
