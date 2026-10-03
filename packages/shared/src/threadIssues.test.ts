import { describe, expect, it } from "vite-plus/test";

import {
  parseGitIssueId,
  parseIssueUrl,
  projectIssueDefaults,
  resolveIssueReference,
  threadIssueKeysEqual,
} from "./threadIssues.ts";

describe("parseIssueUrl", () => {
  it("reads GitHub issues, Enterprise included", () => {
    expect(parseIssueUrl("https://github.com/PingDotGG/T3Code/issues/42#issuecomment-1")).toEqual({
      tracker: "github",
      host: "github.com",
      id: "pingdotgg/t3code#42",
      repository: "pingdotgg/t3code",
      number: 42,
      displayKey: "pingdotgg/t3code#42",
      url: "https://github.com/pingdotgg/t3code/issues/42",
    });
    expect(parseIssueUrl("https://github.acme.dev/team/app/issues/7")?.host).toBe(
      "github.acme.dev",
    );
  });

  it("reads GitLab issues and work items from nested groups on any host", () => {
    expect(parseIssueUrl("https://git.acme.dev/a/b/c/-/issues/3")).toMatchObject({
      tracker: "gitlab",
      host: "git.acme.dev",
      id: "a/b/c#3",
      url: "https://git.acme.dev/a/b/c/-/issues/3",
    });
    expect(parseIssueUrl("https://gitlab.com/a/b/-/work_items/9")?.id).toBe("a/b#9");
  });

  it("rejects change requests and anything it cannot place", () => {
    for (const url of [
      "https://github.com/a/b/pull/1",
      "https://gitlab.com/a/b/-/merge_requests/1",
      "https://example.com/a/b/issues/1",
      "https://github.com/a/b/issues/0",
      "https://github.com/a/b/issues",
      "mailto:someone@github.com",
      "not a url",
    ]) {
      expect(parseIssueUrl(url), url).toBeNull();
    }
  });
});

describe("issue keys", () => {
  it("round-trips git issue ids", () => {
    expect(parseGitIssueId("Group/Sub/Repo#12")).toEqual({
      repository: "group/sub/repo",
      number: 12,
    });
    expect(parseGitIssueId("PROJ-12")).toBeNull();
  });

  it("compares case-insensitively and keeps trackers apart", () => {
    const key = { tracker: "github", host: "github.com", id: "a/b#1" };
    expect(threadIssueKeysEqual(key, { ...key, host: "GitHub.com", id: "A/B#1" })).toBe(true);
    expect(threadIssueKeysEqual(key, { ...key, tracker: "gitlab" })).toBe(false);
  });
});

describe("resolveIssueReference", () => {
  const identity = (canonicalKey: string, provider: string) => {
    const [, owner, name] = canonicalKey.split("/");
    return {
      canonicalKey,
      locator: { source: "git-remote" as const, remoteName: "origin", remoteUrl: "" },
      provider,
      displayName: `${owner}/${name}`,
    };
  };
  const defaults = projectIssueDefaults(identity("github.com/PingDotGG/T3Code", "github"));

  it("completes short references with the project's own repository", () => {
    expect(defaults).toEqual({
      tracker: "github",
      host: "github.com",
      repository: "pingdotgg/t3code",
    });
    expect(resolveIssueReference("#154", defaults)?.id).toBe("pingdotgg/t3code#154");
    expect(resolveIssueReference("154", defaults)?.id).toBe("pingdotgg/t3code#154");
    expect(resolveIssueReference("other/repo#3", defaults)?.id).toBe("other/repo#3");
  });

  it("takes URLs as they are and needs a known tracker for anything shorter", () => {
    expect(resolveIssueReference("https://gitlab.com/a/b/-/issues/2", defaults)?.tracker).toBe(
      "gitlab",
    );
    expect(projectIssueDefaults(identity("bitbucket.org/a/b", "bitbucket"))).toBeNull();
    expect(resolveIssueReference("#154", null)).toBeNull();
    expect(resolveIssueReference("PROJ-12", defaults)).toBeNull();
  });
});
