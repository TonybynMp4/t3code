import { useMemo } from "react";
import type { EnvironmentId, ScopedThreadRef, ThreadIssueLink } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { parseIssueUrl, threadIssueKeysEqual, threadIssuesOf } from "@t3tools/shared/threadIssues";

import { issueEnvironment } from "~/state/issues";
import { useServerConfigs } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

/** Links and unlinks issue URLs on a thread, for surfaces that act on a bare link. */
export function useIssueLinking(environmentId: EnvironmentId | null | undefined) {
  const configs = useServerConfigs();
  const supported =
    environmentId != null &&
    configs.get(environmentId)?.environment.capabilities.threadIssues === true;
  const link = useAtomCommand(issueEnvironment.link, { reportFailure: false });
  const unlink = useAtomCommand(threadEnvironment.unlinkIssue, { reportFailure: false });
  return useMemo(() => {
    const canLink = (url: string) => supported && parseIssueUrl(url) !== null;
    const isLinked = (
      thread: { readonly issues?: readonly ThreadIssueLink[] } | null,
      url: string,
    ) => {
      const parsed = supported && thread !== null ? parseIssueUrl(url) : null;
      return (
        parsed !== null &&
        thread !== null &&
        threadIssuesOf(thread).some((entry) => threadIssueKeysEqual(entry, parsed))
      );
    };
    /**
     * Linking takes anything the server resolves (a URL, `owner/repo#42`, `#42`); unlinking
     * needs a URL, since it names the stored link directly.
     */
    const changeLink = async (threadRef: ScopedThreadRef, reference: string, linked: boolean) => {
      const parsed = parseIssueUrl(reference);
      if (!supported || threadRef.environmentId !== environmentId || (!linked && parsed === null))
        throw new Error("The issue is not available in this environment.");
      // The server reads the issue before linking, so a pull request served under GitHub's
      // `/issues/` path comes back as an error rather than a link that never syncs.
      const result = await (linked || parsed === null
        ? link({
            environmentId: threadRef.environmentId,
            input: { threadId: threadRef.threadId, reference },
          })
        : unlink({
            environmentId: threadRef.environmentId,
            input: {
              threadId: threadRef.threadId,
              tracker: parsed.tracker,
              host: parsed.host,
              id: parsed.id,
            },
          }));
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) throw new Error("Link update interrupted.");
        throw squashAtomCommandFailure(result);
      }
    };
    return { supported, canLink, isLinked, changeLink };
  }, [environmentId, link, supported, unlink]);
}
