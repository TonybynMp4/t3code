import { useAtomCommand } from "~/state/use-atom-command";
/**
 * Assigning someone, from the row that says who is already assigned. The people who may be
 * assigned are read only once this menu opens, for the same reason as the reviewer picker.
 * Picks are held until the menu closes and then sent as one set, as GitLab's own menu does, so
 * the host's limit is checked against everyone at once rather than one click at a time.
 */
import type {
  EnvironmentId,
  PullRequestAssigneeCandidate,
  PullRequestRef,
} from "@t3tools/contracts";
import {
  assigneeDraftChange,
  isAssigneeDraftFull,
  mergeAssigneeCandidates,
  toggleAssigneeDraft,
} from "@t3tools/client-runtime/pull-request-assignees";
import { CheckIcon, UserRoundPlusIcon } from "lucide-react";
import { useState } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { useDebouncedValue } from "~/state/queries";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { toastManager } from "../ui/toast";
import { PullRequestCandidatePicker } from "./PullRequestCandidatePicker";
import { PullRequestActorLabel } from "./pullRequestPresentation";
import { readableFailure } from "./pullRequestDetail.logic";

export function PullRequestAssigneePicker({
  environmentId,
  reference,
  allowed,
  limit,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  /** False where the host would refuse this account, shown disabled with the reason. */
  allowed: boolean;
  /** How many people the host keeps assigned, where it has said. */
  limit: number | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Null until the first pick, so the menu follows the assignees as they load until then.
  const [draft, setDraft] = useState<ReadonlyArray<PullRequestAssigneeCandidate> | null>(null);
  const [pending, setPending] = useState(false);

  const candidatesQuery = useEnvironmentQuery(
    open ? pullRequestEnvironment.assigneeCandidates({ environmentId, input: reference }) : null,
  );
  // Past the first page the host is asked, since what was loaded cannot answer for the rest.
  const searchQuery = useDebouncedValue(query.trim(), 250);
  const searchesHost = candidatesQuery.data?.truncated === true && searchQuery.length > 0;
  // Only once the debounce has caught up, or rows matching the previous text would linger.
  const searched = searchesHost && searchQuery === query.trim();
  const searchResult = useEnvironmentQuery(
    open && searchesHost
      ? pullRequestEnvironment.assigneeSearch({
          environmentId,
          input: { ...reference, query: searchQuery },
        })
      : null,
  );
  const setAssignees = useAtomCommand(pullRequestEnvironment.setAssignees, {
    reportFailure: false,
  });

  const candidates = mergeAssigneeCandidates(
    candidatesQuery.data?.candidates ?? [],
    searched ? (searchResult.data?.candidates ?? []) : [],
    query,
  );

  const assigned =
    candidatesQuery.data?.candidates.filter((candidate) => candidate.isAssigned) ?? [];
  const picked = draft ?? assigned;
  const pickedIds = new Set(picked.map((candidate) => candidate.id));
  const full = isAssigneeDraftFull(picked, limit);

  const submit = async (next: ReadonlyArray<PullRequestAssigneeCandidate>) => {
    const change = assigneeDraftChange(assigned, next);
    if (change === null) return;
    setPending(true);
    const result = await setAssignees({
      environmentId,
      input: { ...reference, assignees: next.map((candidate) => candidate.id) },
    });
    setPending(false);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: "Could not change the assignees",
        description: readableFailure(
          squashAtomCommandFailure(result),
          "The host refused it. Check that you have triage access on this repository, and that they still have access to it.",
        ),
      });
      return;
    }
    toastManager.add({ type: "success", title: assigneeChangeTitle(change) });
  };

  const onOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) return;
    setQuery("");
    setDraft(null);
    if (draft !== null) void submit(draft);
  };

  return (
    <PullRequestCandidatePicker
      icon={<UserRoundPlusIcon className="size-3.5" />}
      label="Assign someone"
      allowed={allowed}
      disabledReason="Assigning someone needs triage access on this repository"
      open={open}
      onOpenChange={onOpenChange}
      query={query}
      onQueryChange={setQuery}
      searchLabel="Search people who can be assigned"
      isPending={
        (candidatesQuery.isPending && candidatesQuery.data === null) ||
        // Nothing loaded matches yet, and the host has not answered: not a "nobody matches".
        (candidates.length === 0 &&
          candidatesQuery.data?.truncated === true &&
          query.trim().length > 0 &&
          (searchQuery !== query.trim() || searchResult.isPending))
      }
      error={
        candidatesQuery.data === null
          ? candidatesQuery.error
          : searched && candidates.length === 0
            ? searchResult.error
            : null
      }
      candidates={candidates}
      emptyLabel="Nobody can be assigned on this repository."
      noMatchLabel="Nobody who can be assigned matches that."
      errorLabel="The people who can be assigned could not be read."
      truncated={
        candidatesQuery.data?.truncated === true &&
        (query.trim().length === 0 ||
          (searched && (searchResult.error !== null || searchResult.data?.truncated === true)))
      }
      truncatedLabel={
        searched && searchResult.error !== null
          ? `Only the people already listed are matched: the host search failed. ${searchResult.error}`
          : searched
            ? "More people match than the host returned. Keep typing to narrow it down."
            : "This repository has more people who can be assigned than are listed here. Search to find them."
      }
      candidateKey={(candidate) => candidate.id}
      disabled={pending}
      candidateDisabled={(candidate) => full && !pickedIds.has(candidate.id)}
      notice={
        limit === 1
          ? "Only one person can be assigned here, so a pick replaces them."
          : full
            ? `No more than ${limit} people can be assigned here.`
            : null
      }
      onSelect={(candidate) => setDraft(toggleAssigneeDraft(picked, candidate, limit))}
    >
      {(candidate) => (
        <>
          <PullRequestActorLabel actor={candidate} className="flex-1" />
          {pickedIds.has(candidate.id) ? (
            <CheckIcon aria-label="Assigned" className="size-3.5 shrink-0" />
          ) : null}
        </>
      )}
    </PullRequestCandidatePicker>
  );
}

function assigneeChangeTitle(change: NonNullable<ReturnType<typeof assigneeDraftChange>>): string {
  const names = (people: ReadonlyArray<PullRequestAssigneeCandidate>) =>
    people.map((person) => person.login).join(", ");
  if (change.removed.length === 0) return `Assigned ${names(change.added)}`;
  if (change.added.length === 0) return `Unassigned ${names(change.removed)}`;
  return `Assigned ${names(change.added)}, unassigned ${names(change.removed)}`;
}
