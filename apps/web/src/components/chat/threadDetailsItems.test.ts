import { describe, expect, it } from "vite-plus/test";

import {
  resolveThreadDetailsCardItems,
  resolveThreadDetailsVisibility,
  resolveThreadHeaderItems,
  setThreadDetailsItem,
  setThreadHeaderItem,
  THREAD_DETAILS_ITEMS,
  THREAD_HEADER_ITEMS,
} from "./threadDetailsItems";

const usage = THREAD_DETAILS_ITEMS.find((item) => item.id === "usage")!;
const servers = THREAD_DETAILS_ITEMS.find((item) => item.id === "servers")!;
const openIn = THREAD_HEADER_ITEMS.find((item) => item.id === "openIn")!;

describe("thread details items", () => {
  it.each([
    { legacy: false, items: {}, usage: false },
    { legacy: true, items: {}, usage: true },
    { legacy: true, items: { usage: false }, usage: false },
    { legacy: false, items: { usage: true, retired: false }, usage: true },
  ])("resolves Usage from overrides and the retired Labs flag: %o", (row) => {
    const visibility = resolveThreadDetailsVisibility({
      threadDetailsItems: row.items,
      threadDetailsUsageEnabled: row.legacy,
    });
    expect(visibility.usage).toBe(row.usage);
    expect(visibility.servers).toBe(true);
  });

  it("stores only choices that differ from the default", () => {
    const legacyOn = { threadDetailsItems: {}, threadDetailsUsageEnabled: true };
    expect(setThreadDetailsItem(legacyOn, usage, false)).toEqual({ usage: false });
    expect(setThreadDetailsItem(legacyOn, usage, true)).toEqual({});

    const hidden = { threadDetailsItems: { servers: false }, threadDetailsUsageEnabled: false };
    expect(setThreadDetailsItem(hidden, servers, true)).toEqual({});
  });

  it("moves header items out of the card and ignores ids that cannot sit in the header", () => {
    const settings = {
      threadDetailsItems: {},
      threadDetailsUsageEnabled: false,
      threadHeaderItems: ["openIn", "servers", "retired"],
    };
    expect(resolveThreadHeaderItems(settings)).toMatchObject({ openIn: true, servers: false });
    expect(resolveThreadDetailsCardItems(settings)).toMatchObject({ openIn: false, servers: true });

    expect(setThreadHeaderItem(settings, openIn, false)).toEqual(["servers", "retired"]);
    expect(setThreadHeaderItem({ threadHeaderItems: [] }, openIn, true)).toEqual(["openIn"]);
  });
});
