import {
  EnvironmentId,
  IssueReadError,
  IssueUnavailableError,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type IssueDetail,
  type OrchestrationProjectShell,
  type OrchestrationV2ServerCommand,
  type ThreadIssueLink,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/unstable/ai";

import * as IssueService from "../../../issue/IssueService.ts";
import * as ThreadIssueService from "../../../issue/ThreadIssueService.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import { v2PullRequestThread } from "../../../orchestration-v2/testkit/pullRequestFixtures.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { IssuesToolkitHandlersLive, issueMarkdown } from "./handlers.ts";
import { IssuesToolkit } from "./tools.ts";

const PROJECT_ID = ProjectId.make("project-1");
const THREAD_ID = ThreadId.make("thread-1");

const testCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(7),
  digest: (_algorithm, data) => Effect.succeed(data),
});

const project: OrchestrationProjectShell = {
  id: PROJECT_ID,
  title: "Project",
  workspaceRoot: "/workspace/project",
  defaultModelSelection: null,
  scripts: [],
  repositoryIdentity: {
    canonicalKey: "github.com/t3tools/t3code",
    locator: {
      source: "git-remote",
      remoteName: "origin",
      remoteUrl: "git@github.com:T3Tools/T3Code.git",
    },
    provider: "github",
    displayName: "T3Tools/T3Code",
  },
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const linked: ThreadIssueLink = {
  tracker: "github",
  host: "github.com",
  id: "t3tools/t3code#5",
  displayKey: "t3tools/t3code#5",
  url: "https://github.com/t3tools/t3code/issues/5",
  source: "manual",
  linkedAt: "2026-08-10T00:00:00.000Z",
  snapshot: null,
};

const detail: IssueDetail = {
  tracker: "github",
  host: "github.com",
  id: "t3tools/t3code#9",
  displayKey: "t3tools/t3code#9",
  url: "https://github.com/t3tools/t3code/issues/9",
  title: "Sidebar flickers",
  state: "open",
  author: { login: "octocat", name: null, avatarUrl: null },
  labels: [{ name: "bug", color: null }],
  body: "Steps to reproduce.",
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: null,
  closedAt: null,
  commentCount: 1,
};

const makeHarness = Effect.fn("makeIssuesToolkitHarness")(function* (
  options: { readonly getIssue?: IssueService.IssueService["Service"]["getIssue"] } = {},
) {
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationV2ServerCommand>>([]);
  const thread = {
    ...v2PullRequestThread({
      id: THREAD_ID,
      projectId: PROJECT_ID,
      title: "Thread",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      pullRequests: [],
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      latestUserMessageAt: null,
    }),
    issues: [linked],
  };
  const services = Layer.mergeAll(
    Layer.mock(ProjectService.ProjectService)({
      getShell: () => Effect.succeedSome(project),
    }),
    Layer.mock(Orchestrator.OrchestratorV2)({
      getThreadShell: (id) => Effect.succeed(id === THREAD_ID ? thread : null),
      dispatch: (command) =>
        Ref.update(commands, (recorded) => [...recorded, command]).pipe(
          Effect.as({ sequence: 1, storedEvents: [] }),
        ),
    }),
    Layer.mock(IssueService.IssueService)({
      getIssue: options.getIssue ?? (() => Effect.succeed(detail)),
      listComments: () =>
        Effect.succeed({
          comments: [
            {
              id: "1",
              author: { login: "dev", name: null, avatarUrl: null },
              body: "On it.",
              createdAt: "2026-08-02T00:00:00Z",
              url: null,
            },
          ],
          nextCursor: null,
        }),
    }),
    Layer.succeed(Crypto.Crypto, testCrypto),
  );
  const dependencies = Layer.provideMerge(ThreadIssueService.layer, services);
  const toolkit = yield* IssuesToolkit.pipe(
    Effect.provide(IssuesToolkitHandlersLive.pipe(Layer.provide(dependencies))),
  );
  const call = <Name extends keyof typeof IssuesToolkit.tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map(
        (chunk) => chunk.at(-1)!.result as Tool.Success<(typeof IssuesToolkit.tools)[Name]>,
      ),
      Effect.provideService(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment-1"),
        threadId: THREAD_ID,
        providerSessionId: "provider-session-1",
        providerInstanceId: ProviderInstanceId.make("codex"),
        capabilities: new Set(["issues" as const]),
        issuedAt: 1,
      }),
      Effect.provide(dependencies),
    );
  return { commands, call };
});

describe("issue toolkit handlers", () => {
  it.effect("links a short reference in the project's repository as the agent", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("link_issue", { issue: "#9" });
      expect(result).toEqual({
        tracker: "github",
        key: "t3tools/t3code#9",
        url: "https://github.com/t3tools/t3code/issues/9",
        alreadyLinked: false,
      });
      expect(yield* Ref.get(harness.commands)).toMatchObject([
        {
          type: "thread.issue.link",
          threadId: THREAD_ID,
          tracker: "github",
          host: "github.com",
          id: "t3tools/t3code#9",
          source: "agent",
        },
      ]);
    }),
  );

  it.effect("does not relink, and unlinks only what is linked", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      expect(
        (yield* harness.call("link_issue", { issue: "https://github.com/T3Tools/T3Code/issues/5" }))
          .alreadyLinked,
      ).toBe(true);
      expect((yield* harness.call("unlink_issue", { issue: "#6" })).wasLinked).toBe(false);
      expect((yield* harness.call("unlink_issue", { issue: "#5" })).wasLinked).toBe(true);
      expect((yield* Ref.get(harness.commands)).map((command) => command.type)).toEqual([
        "thread.issue.unlink",
      ]);
    }),
  );

  it.effect("refuses to link what the tracker says is not an issue, but links offline", () =>
    Effect.gen(function* () {
      const refused = yield* makeHarness({
        getIssue: () => Effect.fail(new IssueReadError({ detail: "a pull request" })),
      });
      expect((yield* refused.call("link_issue", { issue: "#9" }).pipe(Effect.flip))._tag).toBe(
        "IssueReadError",
      );
      expect(yield* Ref.get(refused.commands)).toEqual([]);

      const offline = yield* makeHarness({
        getIssue: () =>
          Effect.fail(new IssueUnavailableError({ reason: "cli-missing", tracker: "github" })),
      });
      yield* offline.call("link_issue", { issue: "#9" });
      expect((yield* Ref.get(offline.commands)).length).toBe(1);
    }),
  );

  it.effect("lists links with their last known state", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      expect(yield* harness.call("list_linked_issues", {})).toEqual({
        issues: [
          {
            tracker: "github",
            key: "t3tools/t3code#5",
            url: "https://github.com/t3tools/t3code/issues/5",
            source: "manual",
            state: null,
            title: null,
            syncError: null,
          },
        ],
      });
    }),
  );
});

describe("issueMarkdown", () => {
  it("leads with the issue and caps long bodies; later pages carry comments only", () => {
    const page = {
      comments: [
        {
          id: "1",
          author: null,
          body: "x".repeat(5_000),
          createdAt: "2026-08-02T00:00:00Z",
          url: null,
        },
      ],
      nextCursor: "2",
    };
    const first = issueMarkdown(detail, page);
    expect(first.startsWith("# t3tools/t3code#9: Sidebar flickers")).toBe(true);
    expect(first).toContain("Labels: bug");
    expect(first).toContain("[…truncated 1000 characters]");
    expect(issueMarkdown(null, page).startsWith("## Comments")).toBe(true);
  });
});
