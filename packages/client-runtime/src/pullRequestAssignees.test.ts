import { describe, expect, it } from "@effect/vitest";

import {
  assigneeDraftChange,
  mergeAssigneeCandidates,
  toggleAssigneeDraft,
} from "./pullRequestAssignees.ts";

const person = (login: string, isAssigned = false, name: string | null = null) => ({
  login,
  name,
  avatarUrl: null,
  id: login,
  isAssigned,
});

describe("mergeAssigneeCandidates", () => {
  it("narrows the loaded people by login or name", () => {
    const loaded = [person("ada"), person("grace", false, "Grace Hopper"), person("linus")];
    expect(mergeAssigneeCandidates(loaded, [], "HOP").map((entry) => entry.login)).toEqual([
      "grace",
    ]);
  });

  it("adds people only the host's search found, after the loaded ones", () => {
    const loaded = [person("ada"), person("adam")];
    const searched = [person("adam"), person("adalbert")];
    expect(mergeAssigneeCandidates(loaded, searched, "ada").map((entry) => entry.login)).toEqual([
      "ada",
      "adam",
      "adalbert",
    ]);
  });

  it("keeps the loaded entry for somebody both lists name, since assigning updates that one", () => {
    const loaded = [person("ada", true)];
    const searched = [person("ada", false)];
    expect(mergeAssigneeCandidates(loaded, searched, "ada")).toEqual([person("ada", true)]);
  });
});

describe("toggleAssigneeDraft", () => {
  const logins = (draft: ReadonlyArray<{ readonly login: string }>) =>
    draft.map((entry) => entry.login);

  it("adds and removes people where several may be assigned", () => {
    const added = toggleAssigneeDraft([person("ada")], person("grace"), 200);
    expect(logins(added)).toEqual(["ada", "grace"]);
    expect(logins(toggleAssigneeDraft(added, person("ada"), 200))).toEqual(["grace"]);
  });

  it("replaces the assignee where the host keeps only one", () => {
    expect(logins(toggleAssigneeDraft([person("ada")], person("grace"), 1))).toEqual(["grace"]);
    expect(toggleAssigneeDraft([person("ada")], person("ada"), 1)).toEqual([]);
  });

  it("refuses somebody past the limit, but still lets one be removed", () => {
    const full = [person("ada"), person("grace")];
    expect(logins(toggleAssigneeDraft(full, person("linus"), 2))).toEqual(["ada", "grace"]);
    expect(logins(toggleAssigneeDraft(full, person("ada"), 2))).toEqual(["grace"]);
  });

  it("adds anybody where the host has not said how many it keeps", () => {
    expect(logins(toggleAssigneeDraft([person("ada")], person("grace"), undefined))).toEqual([
      "ada",
      "grace",
    ]);
  });
});

describe("assigneeDraftChange", () => {
  it("is null when the pick ends where it began, whatever the order", () => {
    expect(
      assigneeDraftChange([person("ada"), person("grace")], [person("grace"), person("ada")]),
    ).toBeNull();
  });

  it("names who was added and who was removed", () => {
    const change = assigneeDraftChange([person("ada")], [person("grace")]);
    expect(change?.added.map((entry) => entry.login)).toEqual(["grace"]);
    expect(change?.removed.map((entry) => entry.login)).toEqual(["ada"]);
  });
});
