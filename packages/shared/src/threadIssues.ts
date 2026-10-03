import {
  pullRequestHostOf,
  type RepositoryIdentity,
  type ThreadIssueKey,
  type ThreadIssueLink,
} from "@t3tools/contracts";

import { isHostOf } from "./changeRequestUrl.ts";
import { sourceControlRepositorySelector } from "./sourceControl.ts";

/** Trackers whose issues live next to the code and are read through the project's git host. */
export type GitIssueTracker = "github" | "gitlab";

/** An issue named by its web URL on a git host: enough to link it and to read it. */
export interface GitIssueLink extends ThreadIssueKey {
  readonly tracker: GitIssueTracker;
  readonly repository: string;
  readonly number: number;
  readonly displayKey: string;
  readonly url: string;
}

/** A git host issue's link fields; its durable id and display key are `owner/repo#42`. */
export function gitIssueLink(
  tracker: GitIssueTracker,
  host: string,
  repository: string,
  number: number,
): GitIssueLink {
  const normalizedHost = host.trim().toLowerCase();
  const normalizedRepository = repository.trim().toLowerCase();
  const id = `${normalizedRepository}#${number}`;
  return {
    tracker,
    host: normalizedHost,
    id,
    repository: normalizedRepository,
    number,
    displayKey: id,
    url:
      tracker === "gitlab"
        ? `https://${normalizedHost}/${normalizedRepository}/-/issues/${number}`
        : `https://${normalizedHost}/${normalizedRepository}/issues/${number}`,
  };
}

/**
 * Whether a repository path is plain `owner/repo` (or a GitLab `group/sub/repo`): segments of
 * letters, digits, `.`, `_` and `-`, none of them dots only. The path goes into tracker API
 * endpoints, so anything that could reshape the request is refused.
 */
function isGitIssueRepository(repository: string): boolean {
  const segments = repository.split("/");
  return (
    segments.length >= 2 &&
    segments.every((segment) => /^[\w.-]+$/u.test(segment) && !/^\.+$/u.test(segment))
  );
}

/** The repository and number inside a git host issue id, or null for any other id. */
export function parseGitIssueId(id: string): { repository: string; number: number } | null {
  const match = /^(.+)#([1-9]\d*)$/u.exec(id.trim());
  if (!match?.[1] || !match[2]) return null;
  const number = Number(match[2]);
  const repository = match[1].toLowerCase();
  return Number.isSafeInteger(number) && isGitIssueRepository(repository)
    ? { repository, number }
    : null;
}

/**
 * The issue behind a GitHub or GitLab issue URL, or null for anything else. Like
 * `parseChangeRequestUrl`, a doubtful match is worse than none: GitHub's `/issues/` is generic, so
 * it is only believed from a GitHub-ish host, while GitLab's `/-/` marker is trusted anywhere.
 *
 * GitHub also serves pull requests under `/issues/{n}`; the reader rejects those once it sees
 * what the host returns, which this cannot know from the URL.
 */
export function parseIssueUrl(targetUrl: string): GitIssueLink | null {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();

  if (isHostOf(host, "github.com", "github")) {
    const match = /^\/([^/]+\/[^/]+)\/issues\/([1-9]\d*)(?:\/|$)/u.exec(url.pathname);
    if (match?.[1] && match[2] && isGitIssueRepository(match[1])) {
      return gitIssueLink("github", host, match[1], Number(match[2]));
    }
  }
  // GitLab, self-hosted included. Newer GitLab also serves issues as work items.
  const gitlab = /^\/([^/]+(?:\/[^/]+)+)\/-\/(?:issues|work_items)\/([1-9]\d*)(?:\/|$)/u.exec(
    url.pathname,
  );
  if (gitlab?.[1] && gitlab[2] && isGitIssueRepository(gitlab[1])) {
    return gitIssueLink("gitlab", host, gitlab[1], Number(gitlab[2]));
  }
  return null;
}

/** Where a bare `#42` points: the tracker and repository of the project's own remote. */
export interface ProjectIssueDefaults {
  readonly tracker: GitIssueTracker;
  readonly host: string;
  readonly repository: string;
}

/** The project's own issue tracker, when its remote is on GitHub or GitLab. */
export function projectIssueDefaults(
  identity: RepositoryIdentity | null | undefined,
): ProjectIssueDefaults | null {
  const tracker = identity?.provider;
  if (!identity || (tracker !== "github" && tracker !== "gitlab")) return null;
  // The same host and repository a pull request link on this project resolves to.
  const repository = sourceControlRepositorySelector(identity);
  if (repository === null) return null;
  return {
    tracker,
    host: pullRequestHostOf(identity, tracker),
    repository: repository.toLowerCase(),
  };
}

/**
 * The issue a person or agent typed: a URL, `owner/repo#42`, or `#42` / `42` in the project's
 * own repository. Null when it names none, or needs project defaults that are missing.
 */
export function resolveIssueReference(
  input: string,
  defaults: ProjectIssueDefaults | null,
): GitIssueLink | null {
  const trimmed = input.trim();
  if (/^https?:\/\//iu.test(trimmed)) return parseIssueUrl(trimmed);
  const bare = /^#?([1-9]\d*)$/u.exec(trimmed);
  if (bare?.[1]) {
    return defaults === null
      ? null
      : gitIssueLink(defaults.tracker, defaults.host, defaults.repository, Number(bare[1]));
  }
  const id = parseGitIssueId(trimmed);
  if (id === null || defaults === null || !id.repository.includes("/")) return null;
  return gitIssueLink(defaults.tracker, defaults.host, id.repository, id.number);
}

export function normalizeThreadIssueKey(key: ThreadIssueKey): ThreadIssueKey {
  return {
    tracker: key.tracker.trim().toLowerCase(),
    host: key.host.trim().toLowerCase(),
    id: key.id.trim().toLowerCase(),
  };
}

export function threadIssueKeyOf(key: ThreadIssueKey): string {
  const normalized = normalizeThreadIssueKey(key);
  return `${normalized.tracker}:${normalized.host}/${normalized.id}`;
}

export function threadIssueKeysEqual(left: ThreadIssueKey, right: ThreadIssueKey): boolean {
  return threadIssueKeyOf(left) === threadIssueKeyOf(right);
}

export function threadIssuesOf(thread: {
  readonly issues?: ReadonlyArray<ThreadIssueLink> | undefined;
}): ReadonlyArray<ThreadIssueLink> {
  return thread.issues ?? [];
}
