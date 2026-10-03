import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

/** One issue as its tracker reports it, read through the environment's CLI credentials. */
export const issueDetail = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:issues:detail",
  tag: WS_METHODS.issuesDetail,
  staleTimeMs: 60_000,
  idleTtlMs: 5 * 60_000,
});

/** A page of an issue's comments, oldest first. */
export const issueComments = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:issues:comments",
  tag: WS_METHODS.issuesComments,
  staleTimeMs: 60_000,
  idleTtlMs: 5 * 60_000,
});
