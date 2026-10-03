import {
  type IssueComment,
  type IssueCommentPage,
  type IssueCommentsInput,
  type IssueDetail,
  type IssueRef,
  IssueReadError,
  IssueUnavailableError,
  type PullRequestActor,
} from "@t3tools/contracts";
import {
  type GitIssueTracker,
  gitIssueLink,
  normalizeThreadIssueKey,
  parseGitIssueId,
  projectIssueDefaults,
} from "@t3tools/shared/threadIssues";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as ProjectService from "../project/ProjectService.ts";
import { decodeNotesJson } from "../pullRequest/gitLabMergeRequestJson.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import * as GitLabCli from "../sourceControl/GitLabCli.ts";

const READ_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 1_000_000;
const DEFAULT_COMMENT_LIMIT = 30;
const MAX_COMMENT_LIMIT = 100;
/** Long enough that a viewer opening an issue and an agent reading it share one request. */
const DETAIL_TTL = Duration.seconds(30);
/** Hosts every environment may read issues from; any other host must be the project's own. */
const PUBLIC_HOSTS: Record<GitIssueTracker, string> = {
  github: "github.com",
  gitlab: "gitlab.com",
};

/** Compared by value, so equal references share one cached read. */
class IssueCacheKey extends Data.Class<IssueRef> {}

const GitHubUser = Schema.NullOr(
  Schema.Struct({
    login: Schema.String,
    avatar_url: Schema.optional(Schema.NullOr(Schema.String)),
    type: Schema.optional(Schema.String),
  }),
);

const GitHubIssueJson = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  state: Schema.String,
  user: GitHubUser,
  labels: Schema.Array(
    Schema.Union([
      Schema.String,
      Schema.Struct({ name: Schema.String, color: Schema.optional(Schema.NullOr(Schema.String)) }),
    ]),
  ),
  body: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.NullOr(Schema.String),
  closed_at: Schema.NullOr(Schema.String),
  state_reason: Schema.optional(Schema.NullOr(Schema.String)),
  comments: Schema.Number,
  html_url: Schema.String,
  /** Present when the number belongs to a pull request, which GitHub also serves as an issue. */
  pull_request: Schema.optional(Schema.Unknown),
});

const GitHubCommentsJson = Schema.Array(
  Schema.Struct({
    id: Schema.Number,
    user: GitHubUser,
    body: Schema.NullOr(Schema.String),
    created_at: Schema.String,
    html_url: Schema.NullOr(Schema.String),
  }),
);

const GitLabUser = Schema.NullOr(
  Schema.Struct({
    username: Schema.String,
    name: Schema.optional(Schema.NullOr(Schema.String)),
    avatar_url: Schema.optional(Schema.NullOr(Schema.String)),
    bot: Schema.optional(Schema.Boolean),
  }),
);

const GitLabIssueJson = Schema.Struct({
  iid: Schema.Number,
  title: Schema.String,
  state: Schema.String,
  author: GitLabUser,
  labels: Schema.Array(Schema.String),
  description: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.NullOr(Schema.String),
  closed_at: Schema.NullOr(Schema.String),
  user_notes_count: Schema.Number,
  web_url: Schema.String,
});

const decodeJson =
  <S extends Schema.Top>(schema: S) =>
  (stdout: string) =>
    Schema.decodeEffect(Schema.fromJsonString(schema))(stdout).pipe(
      Effect.mapError(
        (cause) =>
          new IssueReadError({ detail: "The tracker returned an unexpected reply.", cause }),
      ),
    );

function gitHubActor(user: typeof GitHubUser.Type): PullRequestActor | null {
  if (user === null || user.login.trim() === "") return null;
  return {
    login: user.login,
    name: null,
    avatarUrl: user.avatar_url ?? null,
    ...(user.type === "Bot" ? { isBot: true } : {}),
  };
}

function gitLabActor(user: typeof GitLabUser.Type): PullRequestActor | null {
  if (user === null || user.username.trim() === "") return null;
  return {
    login: user.username,
    name: user.name ?? null,
    avatarUrl: user.avatar_url ?? null,
    ...(user.bot === true ? { isBot: true } : {}),
  };
}

/** GitHub greys out issues closed as not planned or as duplicates; anything else closed is done. */
function gitHubClosedReason(json: typeof GitHubIssueJson.Type): Pick<IssueDetail, "closedReason"> {
  if (json.state !== "closed") return {};
  return {
    closedReason:
      json.state_reason === "not_planned" || json.state_reason === "duplicate"
        ? "not-planned"
        : "completed",
  };
}

/** A repository path as an API path, each segment encoded. */
function gitHubRepositoryPath(repository: string): string {
  return repository.split("/").map(encodeURIComponent).join("/");
}

/** Pages are numbered from 1; the cursor is that number, opaque to callers. */
function pageOf(cursor: string | undefined): number {
  const page = cursor === undefined ? 1 : Number(cursor);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

function commentLimitOf(limit: number | undefined): number {
  return Math.min(limit ?? DEFAULT_COMMENT_LIMIT, MAX_COMMENT_LIMIT);
}

/** Reads issues from the tracker that owns them, through the CLI credentials of this environment. */
export class IssueService extends Context.Service<
  IssueService,
  {
    readonly getIssue: (
      ref: IssueRef,
    ) => Effect.Effect<IssueDetail, IssueUnavailableError | IssueReadError>;
    /** Comments oldest first, a page at a time. */
    readonly listComments: (
      input: IssueCommentsInput,
    ) => Effect.Effect<IssueCommentPage, IssueUnavailableError | IssueReadError>;
  }
>()("t3/issue/IssueService") {}

const make = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService;
  const github = yield* GitHubCli.GitHubCli;
  const gitlab = yield* GitLabCli.GitLabCli;

  const resolve = Effect.fn("IssueService.resolve")(function* (ref: IssueRef) {
    const key = normalizeThreadIssueKey(ref);
    if (key.tracker !== "github" && key.tracker !== "gitlab") {
      return yield* new IssueUnavailableError({
        reason: "tracker-unsupported",
        tracker: key.tracker,
      });
    }
    const tracker: GitIssueTracker = key.tracker;
    const parsed = parseGitIssueId(key.id);
    if (parsed === null) {
      return yield* new IssueReadError({ detail: "The issue id is not `owner/repo#number`." });
    }
    const project = yield* projects
      .getById(ref.projectId)
      .pipe(
        Effect.mapError(
          (cause) => new IssueReadError({ detail: "The project could not be read.", cause }),
        ),
      );
    if (Option.isNone(project)) {
      return yield* new IssueReadError({ detail: "The project does not exist." });
    }
    // The CLI sends its credentials to the host it is pointed at, so only known hosts are read.
    const projectDefaults = projectIssueDefaults(project.value.repositoryIdentity);
    const projectHost = projectDefaults?.tracker === tracker ? projectDefaults.host : null;
    if (key.host !== PUBLIC_HOSTS[tracker] && key.host !== projectHost) {
      return yield* new IssueReadError({
        detail: `Issues on ${key.host} can only be read from a project hosted there.`,
      });
    }
    return {
      issue: gitIssueLink(tracker, key.host, parsed.repository, parsed.number),
      cwd: project.value.workspaceRoot,
    };
  });

  const runGitHub = (cwd: string, host: string, endpoint: string) =>
    github
      .execute({
        cwd,
        args: ["api", "--hostname", host, endpoint],
        env: { GH_PROMPT_DISABLED: "1" },
        timeoutMs: READ_TIMEOUT_MS,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        rateLimitHost: host,
      })
      .pipe(
        Effect.map((output) => output.stdout),
        Effect.mapError((cause) => {
          switch (cause._tag) {
            case "GitHubCliUnavailableError":
              return new IssueUnavailableError({ reason: "cli-missing", tracker: "github", cause });
            case "GitHubCliAuthenticationError":
              return new IssueUnavailableError({
                reason: "cli-unauthenticated",
                tracker: "github",
                cause,
              });
            case "GitHubCliRateLimitError":
              return new IssueUnavailableError({
                reason: "rate-limited",
                tracker: "github",
                cause,
              });
            default:
              return new IssueReadError({
                detail:
                  cause._tag === "GitHubCliCommandError" && cause.httpStatus === 404
                    ? "GitHub has no such issue, or this account cannot see it."
                    : "GitHub could not be read.",
                cause,
              });
          }
        }),
      );

  const runGitLab = (cwd: string, host: string, endpoint: string) =>
    gitlab
      .execute({
        cwd,
        args: ["api", "--hostname", host, endpoint],
        timeoutMs: READ_TIMEOUT_MS,
        maxOutputBytes: MAX_OUTPUT_BYTES,
      })
      .pipe(
        Effect.map((output) => output.stdout),
        Effect.mapError((cause) => {
          switch (cause._tag) {
            case "GitLabCliUnavailableError":
              return new IssueUnavailableError({ reason: "cli-missing", tracker: "gitlab", cause });
            case "GitLabCliAuthenticationError":
              return new IssueUnavailableError({
                reason: "cli-unauthenticated",
                tracker: "gitlab",
                cause,
              });
            case "GitLabCliRateLimitError":
              return new IssueUnavailableError({
                reason: "rate-limited",
                tracker: "gitlab",
                cause,
              });
            default:
              return new IssueReadError({ detail: "GitLab could not be read.", cause });
          }
        }),
      );

  const gitLabProject = (repository: string) => encodeURIComponent(repository);

  const readIssue = Effect.fn("IssueService.readIssue")(function* (ref: IssueRef) {
    const { issue, cwd } = yield* resolve(ref);
    const identity = {
      tracker: issue.tracker,
      host: issue.host,
      id: issue.id,
      displayKey: issue.displayKey,
    };
    if (issue.tracker === "github") {
      const json = yield* runGitHub(
        cwd,
        issue.host,
        `repos/${gitHubRepositoryPath(issue.repository)}/issues/${issue.number}`,
      ).pipe(Effect.flatMap(decodeJson(GitHubIssueJson)));
      if (json.pull_request !== undefined) {
        return yield* new IssueReadError({
          detail: `${issue.displayKey} is a pull request; link it as one instead.`,
        });
      }
      return {
        ...identity,
        url: json.html_url,
        title: json.title,
        state: json.state === "closed" ? "closed" : "open",
        author: gitHubActor(json.user),
        labels: json.labels.flatMap((label) =>
          typeof label === "string"
            ? [{ name: label, color: null }]
            : label.name.trim() === ""
              ? []
              : [{ name: label.name, color: label.color?.trim() || null }],
        ),
        body: json.body ?? "",
        createdAt: json.created_at,
        updatedAt: json.updated_at,
        closedAt: json.closed_at,
        ...gitHubClosedReason(json),
        commentCount: json.comments,
      } satisfies IssueDetail;
    }
    const json = yield* runGitLab(
      cwd,
      issue.host,
      `projects/${gitLabProject(issue.repository)}/issues/${issue.number}`,
    ).pipe(Effect.flatMap(decodeJson(GitLabIssueJson)));
    return {
      ...identity,
      url: json.web_url,
      title: json.title,
      state: json.state === "closed" ? "closed" : "open",
      author: gitLabActor(json.author),
      labels: json.labels
        .filter((name) => name.trim() !== "")
        .map((name) => ({ name, color: null })),
      body: json.description ?? "",
      createdAt: json.created_at,
      updatedAt: json.updated_at,
      closedAt: json.closed_at,
      commentCount: json.user_notes_count,
    } satisfies IssueDetail;
  });

  const details = yield* Cache.makeWith((key: IssueCacheKey) => readIssue(key), {
    capacity: 256,
    timeToLive: (exit) => (Exit.isSuccess(exit) ? DETAIL_TTL : Duration.zero),
  });

  const getIssue = (ref: IssueRef) =>
    Cache.get(
      details,
      new IssueCacheKey({ projectId: ref.projectId, ...normalizeThreadIssueKey(ref) }),
    );

  const listComments = Effect.fn("IssueService.listComments")(function* (
    input: IssueCommentsInput,
  ) {
    const { issue, cwd } = yield* resolve(input);
    const page = pageOf(input.cursor);
    const limit = commentLimitOf(input.limit);
    let comments: ReadonlyArray<IssueComment>;
    let fullPage: boolean;
    if (issue.tracker === "github") {
      const json = yield* runGitHub(
        cwd,
        issue.host,
        `repos/${gitHubRepositoryPath(issue.repository)}/issues/${issue.number}/comments?per_page=${limit}&page=${page}`,
      ).pipe(Effect.flatMap(decodeJson(GitHubCommentsJson)));
      fullPage = json.length === limit;
      comments = json.map((comment) => ({
        id: String(comment.id),
        author: gitHubActor(comment.user),
        body: comment.body ?? "",
        createdAt: comment.created_at,
        url: comment.html_url,
      }));
    } else {
      const json = yield* runGitLab(
        cwd,
        issue.host,
        `projects/${gitLabProject(issue.repository)}/issues/${issue.number}/notes?sort=asc&order_by=created_at&per_page=${limit}&page=${page}`,
      );
      const notes = decodeNotesJson(json);
      if (Result.isFailure(notes)) {
        return yield* new IssueReadError({
          detail: "The tracker returned an unexpected reply.",
          cause: notes.failure,
        });
      }
      // The page is sized before system notes ("changed the label") are dropped.
      fullPage = notes.success.rawCount === limit;
      comments = notes.success.comments.map((note) => ({
        id: note.id,
        author: note.author,
        body: note.body,
        createdAt: note.createdAt,
        url: `${issue.url}#note_${note.id}`,
      }));
    }
    return { comments, nextCursor: fullPage ? String(page + 1) : null } satisfies IssueCommentPage;
  });

  return IssueService.of({ getIssue, listComments });
});

export const layer = Layer.effect(IssueService, make);
