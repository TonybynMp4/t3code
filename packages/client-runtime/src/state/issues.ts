import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

/**
 * Issue reads and linking for one client. Reads go through the environment's tracker CLI
 * credentials; linking goes through the server so it can check the issue exists first.
 */
export function createIssueEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    /** One issue as its tracker reports it. */
    detail: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:issues:detail",
      tag: WS_METHODS.issuesDetail,
      staleTimeMs: 60_000,
      idleTtlMs: 5 * 60_000,
    }),
    /** A page of an issue's comments, oldest first. */
    comments: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:issues:comments",
      tag: WS_METHODS.issuesComments,
      staleTimeMs: 60_000,
      idleTtlMs: 5 * 60_000,
    }),
    link: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:link",
      tag: WS_METHODS.issuesLink,
      scheduler: createAtomCommandScheduler(),
      concurrency: {
        mode: "singleFlight",
        key: ({ environmentId, input }) =>
          JSON.stringify([environmentId, input.threadId, input.reference]),
      },
    }),
  };
}
