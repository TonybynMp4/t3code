import { useAtomCommand } from "~/state/use-atom-command";
/**
 * Assigning someone, from the row that says who is already assigned. The people who may be
 * assigned are read only once this menu opens, for the same reason as the reviewer picker.
 */
import type {
  EnvironmentId,
  PullRequestAssigneeCandidate,
  PullRequestRef,
} from "@t3tools/contracts";
import { CheckIcon, UserRoundPlusIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { toastManager } from "../ui/toast";
import { PullRequestCandidatePicker } from "./PullRequestCandidatePicker";
import { PullRequestActorLabel } from "./pullRequestPresentation";
import { readableFailure } from "./pullRequestDetail.logic";

function matches(candidate: PullRequestAssigneeCandidate, query: string): boolean {
  if (query.length === 0) return true;
  const needle = query.toLowerCase();
  return (
    candidate.login.toLowerCase().includes(needle) ||
    (candidate.name ?? "").toLowerCase().includes(needle)
  );
}

export function PullRequestAssigneePicker({
  environmentId,
  reference,
  allowed,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  /** False where the host would refuse this account, shown disabled with the reason. */
  allowed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  const candidatesQuery = useEnvironmentQuery(
    open ? pullRequestEnvironment.assigneeCandidates({ environmentId, input: reference }) : null,
  );
  const setAssignees = useAtomCommand(pullRequestEnvironment.setAssignees, {
    reportFailure: false,
  });

  const candidates = useMemo(
    () => (candidatesQuery.data?.candidates ?? []).filter((entry) => matches(entry, query)),
    [candidatesQuery.data, query],
  );

  const toggle = async (candidate: PullRequestAssigneeCandidate) => {
    if (pending !== null) return;
    setPending(candidate.id);
    const result = await setAssignees({
      environmentId,
      input: { ...reference, assignees: [candidate.id], assigned: !candidate.isAssigned },
    });
    setPending(null);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: candidate.isAssigned
          ? `Could not unassign ${candidate.login}`
          : `Could not assign ${candidate.login}`,
        description: readableFailure(
          squashAtomCommandFailure(result),
          "The host refused it. Check that you have triage access on this repository, and that they still have access to it.",
        ),
      });
      return;
    }
    toastManager.add({
      type: "success",
      title: candidate.isAssigned ? `Unassigned ${candidate.login}` : `Assigned ${candidate.login}`,
    });
  };

  return (
    <PullRequestCandidatePicker
      icon={<UserRoundPlusIcon className="size-3.5" />}
      label="Assign someone"
      allowed={allowed}
      disabledReason="Assigning someone needs triage access on this repository"
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      searchLabel="Search people who can be assigned"
      isPending={candidatesQuery.isPending && candidatesQuery.data === null}
      error={candidatesQuery.data === null ? candidatesQuery.error : null}
      candidates={candidates}
      emptyLabel="Nobody can be assigned on this repository."
      noMatchLabel="Nobody who can be assigned matches that."
      errorLabel="The people who can be assigned could not be read."
      truncated={candidatesQuery.data?.truncated === true}
      truncatedLabel="This repository has more people who can be assigned than are listed here. Assign the rest on the host."
      candidateKey={(candidate) => candidate.id}
      disabled={pending !== null}
      onSelect={(candidate) => void toggle(candidate)}
    >
      {(candidate) => (
        <>
          <PullRequestActorLabel actor={candidate} className="flex-1" />
          {candidate.isAssigned ? (
            <CheckIcon aria-label="Assigned" className="size-3.5 shrink-0" />
          ) : null}
        </>
      )}
    </PullRequestCandidatePicker>
  );
}
