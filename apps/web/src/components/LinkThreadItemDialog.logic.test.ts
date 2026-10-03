import { describe, expect, it } from "vite-plus/test";

import { linkThreadItemKindOf } from "./LinkThreadItemDialog";

describe("linkThreadItemKindOf", () => {
  it.each([
    ["https://github.com/pingdotgg/t3code/pull/42", "pull-request"],
    ["  https://github.com/pingdotgg/t3code/issues/42  ", "issue"],
    ["https://gitlab.com/group/sub/repo/-/merge_requests/7", "pull-request"],
    ["https://gitlab.com/group/sub/repo/-/issues/7", "issue"],
    ["https://gitlab.example.com/group/repo/-/work_items/7", "issue"],
  ] as const)("reads %s as a %s", (reference, kind) => {
    expect(linkThreadItemKindOf(reference)).toBe(kind);
  });

  it.each(["42", "#42", "owner/repo#42", "https://example.com/owner/repo/issues/42", ""])(
    "leaves %j to the chosen kind",
    (reference) => {
      expect(linkThreadItemKindOf(reference)).toBeNull();
    },
  );
});
