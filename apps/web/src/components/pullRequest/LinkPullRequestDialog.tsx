export { changeRequestUrlFor as changeRequestWebUrl } from "@t3tools/shared/changeRequestUrl";

import { parseChangeRequestUrl } from "~/lib/openPullRequestLink";
import { parsePullRequestReference } from "~/pullRequestReference";

interface ResolvedLink {
  readonly host: string;
  readonly repository: string;
  readonly number: number;
  readonly url: string;
}

/**
 * Which pull request an input names, or why it cannot. A URL carries its own host and
 * repository and may point at any repository on a host this environment has a project for; a
 * bare `#123` can only mean the thread's own repository.
 */
export function resolveLinkPullRequestInput(input: {
  readonly reference: string;
  readonly project: {
    readonly host: string;
    readonly repository: string;
    readonly webUrl: (number: number) => string | null;
  } | null;
  readonly hasProject: (reference: ResolvedLink) => boolean;
}): { link: ResolvedLink } | { error: string } | null {
  const parsed =
    parseChangeRequestUrl(input.reference.trim()) !== null
      ? input.reference.trim()
      : parsePullRequestReference(input.reference);
  if (parsed === null) return null;
  const url = parseChangeRequestUrl(parsed);
  if (url !== null) {
    if (!input.hasProject({ ...url, url: parsed })) {
      return { error: `No project in this environment can read ${url.host}/${url.repository}.` };
    }
    return {
      link: { host: url.host, repository: url.repository, number: url.number, url: parsed },
    };
  }
  const number = Number(parsed);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  if (input.project === null) {
    return { error: "Paste a full URL to link a pull request from another repository." };
  }
  const webUrl = input.project.webUrl(number);
  const webReference = webUrl === null ? null : parseChangeRequestUrl(webUrl);
  if (webUrl === null || webReference === null) {
    return { error: "Paste a full URL; this project's host has no known pull request URL." };
  }
  return {
    link: { ...webReference, url: webUrl },
  };
}
