import type { PullRequestAssigneeCandidate } from "@t3tools/contracts";

/**
 * The assignee menu's rows: the people the menu first loaded, narrowed to what was typed, then
 * whoever the host's own search found beyond them. Anybody in both comes from the first list,
 * since that is the one an assignment updates.
 */
export function mergeAssigneeCandidates(
  loaded: ReadonlyArray<PullRequestAssigneeCandidate>,
  searched: ReadonlyArray<PullRequestAssigneeCandidate>,
  query: string,
): ReadonlyArray<PullRequestAssigneeCandidate> {
  const needle = query.trim().toLowerCase();
  const known = new Set(loaded.map((candidate) => candidate.id));
  return [
    ...loaded.filter(
      (candidate) =>
        needle.length === 0 ||
        candidate.login.toLowerCase().includes(needle) ||
        (candidate.name ?? "").toLowerCase().includes(needle),
    ),
    // The host matched these on its own terms, an email for one, so they are not narrowed again.
    ...searched.filter((candidate) => !known.has(candidate.id)),
  ];
}

/**
 * The menu's pick, in the order chosen. It is sent once the menu closes, so the host's limit is
 * held here: with one allowed a pick replaces the assignee, and past a higher one it is refused.
 */
export function toggleAssigneeDraft(
  draft: ReadonlyArray<PullRequestAssigneeCandidate>,
  candidate: PullRequestAssigneeCandidate,
  limit: number | undefined,
): ReadonlyArray<PullRequestAssigneeCandidate> {
  if (draft.some((entry) => entry.id === candidate.id)) {
    return draft.filter((entry) => entry.id !== candidate.id);
  }
  if (limit === 1) return [candidate];
  if (isAssigneeDraftFull(draft, limit)) return draft;
  return [...draft, candidate];
}

/** Whether nobody else can be added. A limit of one never fills: a pick replaces instead. */
export function isAssigneeDraftFull(
  draft: ReadonlyArray<PullRequestAssigneeCandidate>,
  limit: number | undefined,
): boolean {
  return limit !== undefined && limit > 1 && draft.length >= limit;
}

/** What closing the menu changed, or null where it ends where it began. */
export function assigneeDraftChange(
  assigned: ReadonlyArray<PullRequestAssigneeCandidate>,
  draft: ReadonlyArray<PullRequestAssigneeCandidate>,
): {
  readonly added: ReadonlyArray<PullRequestAssigneeCandidate>;
  readonly removed: ReadonlyArray<PullRequestAssigneeCandidate>;
} | null {
  const before = new Set(assigned.map((entry) => entry.id));
  const after = new Set(draft.map((entry) => entry.id));
  const added = draft.filter((entry) => !before.has(entry.id));
  const removed = assigned.filter((entry) => !after.has(entry.id));
  return added.length === 0 && removed.length === 0 ? null : { added, removed };
}
