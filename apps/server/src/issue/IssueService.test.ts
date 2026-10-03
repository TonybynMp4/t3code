import { ProjectId, type RepositoryIdentity } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as ProjectService from "../project/ProjectService.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import * as GitLabCli from "../sourceControl/GitLabCli.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as IssueService from "./IssueService.ts";

const PROJECT_ID = ProjectId.make("project-1");

const output = (stdout: unknown) => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout: JSON.stringify(stdout),
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const gitHubIssue = {
  number: 7,
  title: "Crash on start",
  state: "open",
  user: { login: "octocat", avatar_url: "https://avatars/octocat", type: "User" },
  labels: [{ name: "bug", color: "d73a4a" }],
  body: "It crashes.",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-02T00:00:00Z",
  closed_at: null,
  comments: 3,
  html_url: "https://github.com/acme/app/issues/7",
};

const run = <A, E>(
  effect: Effect.Effect<A, E, IssueService.IssueService>,
  clis: {
    readonly github?: GitHubCli.GitHubCli["Service"]["execute"];
    readonly gitlab?: GitLabCli.GitLabCli["Service"]["execute"];
    readonly repositoryIdentity?: RepositoryIdentity;
    readonly resolveHandle?: SourceControlProviderRegistry.SourceControlProviderRegistry["Service"]["resolveHandle"];
  },
) =>
  effect.pipe(
    Effect.provide(
      IssueService.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(GitHubCli.GitHubCli)({
              execute: clis.github ?? (() => Effect.die("unexpected gh call")),
            }),
            Layer.mock(GitLabCli.GitLabCli)({
              execute: clis.gitlab ?? (() => Effect.die("unexpected glab call")),
            }),
            Layer.mock(ProjectService.ProjectService)({
              getById: () =>
                Effect.succeedSome({
                  id: PROJECT_ID,
                  title: "App",
                  workspaceRoot: "/workspace/app",
                  defaultModelSelection: null,
                  scripts: [],
                  createdAt: "2026-09-01T00:00:00.000Z",
                  updatedAt: "2026-09-01T00:00:00.000Z",
                  deletedAt: null,
                  ...(clis.repositoryIdentity
                    ? { repositoryIdentity: clis.repositoryIdentity }
                    : {}),
                }),
            }),
            Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
              resolveLink: () => undefined,
              resolveHandle: clis.resolveHandle ?? (() => Effect.die("unexpected provider probe")),
            }),
          ),
        ),
      ),
    ),
  );

const githubRef = {
  projectId: PROJECT_ID,
  tracker: "github",
  host: "GitHub.com",
  id: "Acme/App#7",
};

describe("IssueService", () => {
  it.effect("reads a GitHub issue once while the read is fresh", () => {
    const calls: Array<ReadonlyArray<string>> = [];
    return run(
      Effect.gen(function* () {
        const issues = yield* IssueService.IssueService;
        const detail = yield* issues.getIssue(githubRef);
        yield* issues.getIssue({ ...githubRef, id: "acme/app#7" });
        assert.deepEqual(calls, [["api", "--hostname", "github.com", "repos/acme/app/issues/7"]]);
        assert.deepInclude(detail, {
          tracker: "github",
          id: "acme/app#7",
          displayKey: "acme/app#7",
          state: "open",
          title: "Crash on start",
          body: "It crashes.",
          commentCount: 3,
        });
        assert.deepEqual(detail.labels, [{ name: "bug", color: "d73a4a" }]);
        assert.equal(detail.author?.login, "octocat");
      }),
      {
        github: (input) => {
          calls.push(input.args);
          return Effect.succeed(output(gitHubIssue));
        },
      },
    );
  });

  it.effect("refuses a pull request served under /issues", () =>
    run(
      Effect.gen(function* () {
        const issues = yield* IssueService.IssueService;
        const error = yield* Effect.flip(issues.getIssue(githubRef));
        assert.equal(error._tag, "IssueReadError");
        assert.match(error.message, /pull request/);
      }),
      { github: () => Effect.succeed(output({ ...gitHubIssue, pull_request: {} })) },
    ),
  );

  it.effect("names the missing login and unsupported trackers", () =>
    run(
      Effect.gen(function* () {
        const issues = yield* IssueService.IssueService;
        const unauthenticated = yield* Effect.flip(issues.getIssue(githubRef));
        assert.deepInclude(unauthenticated, {
          _tag: "IssueUnavailableError",
          reason: "cli-unauthenticated",
        });
        const jira = yield* Effect.flip(
          issues.getIssue({ ...githubRef, tracker: "jira", id: "PROJ-1" }),
        );
        assert.deepInclude(jira, { _tag: "IssueUnavailableError", reason: "tracker-unsupported" });
      }),
      {
        github: () =>
          Effect.fail(
            new GitHubCli.GitHubCliAuthenticationError({
              command: "gh",
              cwd: "/workspace/app",
              cause: new Error("auth"),
            }),
          ),
      },
    ),
  );

  it.effect("keeps why a GitHub issue closed", () =>
    run(
      Effect.gen(function* () {
        const issues = yield* IssueService.IssueService;
        const detail = yield* issues.getIssue(githubRef);
        assert.equal(detail.state, "closed");
        assert.equal(detail.closedReason, "not-planned");
      }),
      {
        github: () =>
          Effect.succeed(
            output({
              ...gitHubIssue,
              state: "closed",
              state_reason: "not_planned",
              closed_at: "2026-09-03T00:00:00Z",
            }),
          ),
      },
    ),
  );

  it.effect("reads only the public hosts and the project's own", () =>
    run(
      Effect.gen(function* () {
        const issues = yield* IssueService.IssueService;
        const error = yield* Effect.flip(
          issues.getIssue({ ...githubRef, host: "github.attacker.example" }),
        );
        assert.equal(error._tag, "IssueReadError");
      }),
      {},
    ),
  );

  it.effect("tells a rate limit apart from an unreadable issue", () =>
    run(
      Effect.gen(function* () {
        const issues = yield* IssueService.IssueService;
        const error = yield* Effect.flip(issues.getIssue(githubRef));
        assert.deepInclude(error, { _tag: "IssueUnavailableError", reason: "rate-limited" });
      }),
      {
        github: () =>
          Effect.fail(
            new GitHubCli.GitHubCliRateLimitError({
              command: "gh",
              cwd: "/workspace/app",
              cause: new Error("rate limited"),
            }),
          ),
      },
    ),
  );

  it.effect("pages GitLab notes without system notes", () => {
    const endpoints: Array<string> = [];
    return run(
      Effect.gen(function* () {
        const issues = yield* IssueService.IssueService;
        const page = yield* issues.listComments({
          projectId: PROJECT_ID,
          tracker: "gitlab",
          host: "gitlab.com",
          id: "group/sub/app#3",
          limit: 2,
        });
        assert.deepEqual(endpoints, [
          "projects/group%2Fsub%2Fapp/issues/3/notes?sort=asc&order_by=created_at&per_page=2&page=1",
        ]);
        assert.deepEqual(
          page.comments.map((comment) => [comment.author?.login, comment.body, comment.url]),
          [["dev", "Looking into it", "https://gitlab.com/group/sub/app/-/issues/3#note_2"]],
        );
        assert.equal(page.nextCursor, "2");
      }),
      {
        gitlab: (input) => {
          endpoints.push(input.args[3]!);
          return Effect.succeed(
            output([
              {
                id: 1,
                author: { username: "dev" },
                body: "added ~bug label",
                created_at: "2026-09-01T00:00:00Z",
                system: true,
              },
              {
                id: 2,
                author: { username: "dev" },
                body: "Looking into it",
                created_at: "2026-09-01T01:00:00Z",
                system: false,
              },
            ]),
          );
        },
      },
    );
  });
  describe("on a self-hosted remote whose host name names no tracker", () => {
    const remoteUrl = "git@codefactory.example:group/app.git";
    const repositoryIdentity: RepositoryIdentity = {
      canonicalKey: "codefactory.example/group/app",
      locator: { source: "git-remote", remoteName: "origin", remoteUrl },
      displayName: "group/app",
      provider: "unknown",
      owner: "group",
      name: "app",
    };
    const refinedTo = (kind: "gitlab" | "unknown", probes: Array<string>) =>
      ((input) => {
        probes.push(input.cwd);
        return Effect.succeed({
          provider: {} as never,
          context: {
            provider: { kind, name: "codefactory.example", baseUrl: "https://codefactory.example" },
            remoteName: "origin",
            remoteUrl,
          },
        });
      }) satisfies SourceControlProviderRegistry.SourceControlProviderRegistry["Service"]["resolveHandle"];
    const selfHostedRef = {
      projectId: PROJECT_ID,
      tracker: "gitlab",
      host: "codefactory.example",
      id: "group/app#3",
    };

    it.effect("reads its issues once glab claims the host, asking only once", () => {
      const probes: Array<string> = [];
      const calls: Array<ReadonlyArray<string>> = [];
      return run(
        Effect.gen(function* () {
          const issues = yield* IssueService.IssueService;
          const defaults = yield* issues.projectDefaults({
            workspaceRoot: "/workspace/app",
            repositoryIdentity,
          });
          assert.deepEqual(defaults, {
            tracker: "gitlab",
            host: "codefactory.example",
            repository: "group/app",
          });
          const detail = yield* issues.getIssue(selfHostedRef);
          assert.equal(detail.title, "Crash on start");
          assert.deepEqual(calls, [
            ["api", "--hostname", "codefactory.example", "projects/group%2Fapp/issues/3"],
          ]);
          assert.deepEqual(probes, ["/workspace/app"]);
        }),
        {
          repositoryIdentity,
          resolveHandle: refinedTo("gitlab", probes),
          gitlab: (input) => {
            calls.push(input.args);
            return Effect.succeed(
              output({
                iid: 3,
                title: "Crash on start",
                state: "opened",
                author: { username: "dev" },
                labels: [],
                description: "",
                created_at: "2026-09-01T00:00:00Z",
                updated_at: "2026-09-02T00:00:00Z",
                closed_at: null,
                user_notes_count: 0,
                web_url: "https://codefactory.example/group/app/-/issues/3",
              }),
            );
          },
        },
      );
    });

    it.effect("still refuses the host when no CLI claims it", () =>
      run(
        Effect.gen(function* () {
          const issues = yield* IssueService.IssueService;
          const error = yield* Effect.flip(issues.getIssue(selfHostedRef));
          assert.equal(error._tag, "IssueReadError");
        }),
        { repositoryIdentity, resolveHandle: refinedTo("unknown", []) },
      ),
    );
  });
});
