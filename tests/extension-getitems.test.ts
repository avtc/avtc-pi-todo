// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PiTodoApi } from "../src/extension.js";
import { _setBuiltInFollowUpDisabled } from "../src/hooks.js";
import type { TodoSettings } from "../src/schema.js";
import { _setGetTodoSettings } from "../src/settings-ui.js";
import {
  clearTodoSettings,
  FOLLOW_UP_ENABLED,
  getTestSettings,
  NO_SETUP_TOOL_OPTIONS,
  setupTool,
} from "./setup-tool.js";

/** Grab the PiTodoApi emitted on `pi-todo:ready` from the setupTool's emit mock. */
function apiFromSetup(setup: ReturnType<typeof setupTool>): PiTodoApi {
  const emit = setup.api.events.emit as unknown as { mock: { calls: unknown[][] } };
  const readyCall = emit.mock.calls.find((c) => c[0] === "pi-todo:ready");
  if (!readyCall) throw new Error("pi-todo:ready was never emitted");
  return readyCall[1] as PiTodoApi;
}

describe("PiTodoApi.getItems (read-only full-list getter)", () => {
  beforeEach(() => {
    _setGetTodoSettings(() => getTestSettings() as unknown as TodoSettings);
    _setBuiltInFollowUpDisabled(FOLLOW_UP_ENABLED);
    clearTodoSettings();
  });

  afterEach(() => {
    _setGetTodoSettings(null);
    _setBuiltInFollowUpDisabled(FOLLOW_UP_ENABLED);
    clearTodoSettings();
  });

  it("is present on the emitted API and is a function", () => {
    const setup = setupTool(NO_SETUP_TOOL_OPTIONS);
    setup.fireSessionEvent("session_start", { cwd: process.cwd() });
    const api = apiFromSetup(setup);
    expect(api).toHaveProperty("getItems");
    expect(typeof api.getItems).toBe("function");
  });

  it("returns [] when no items exist (no filter)", () => {
    const setup = setupTool(NO_SETUP_TOOL_OPTIONS);
    setup.fireSessionEvent("session_start", { cwd: process.cwd() });
    const api = apiFromSetup(setup);
    expect(api.getItems(null)).toEqual([]);
  });

  it("returns all items with null filter, each a shallow copy with parentId normalized to null", async () => {
    const setup = setupTool(NO_SETUP_TOOL_OPTIONS);
    const { tools, ctx } = setup;
    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "do A" },
          { name: "B", details: "do B" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    setup.fireSessionEvent("session_start", { cwd: process.cwd() });
    const api = apiFromSetup(setup);

    const items = api.getItems(null);
    expect(items.length).toBe(2);
    // shallow copy: each item is a fresh object (not the closure ref)
    expect(items).not.toBe((setup as unknown as { _items?: unknown[] })._items);
    // shape: id, parentId (string|null), name, details, status
    for (const item of items) {
      expect(typeof item.id).toBe("string");
      expect(item.parentId === null || typeof item.parentId === "string").toBe(true);
      expect(typeof item.name).toBe("string");
      expect(typeof item.details).toBe("string");
      expect(typeof item.status).toBe("string");
    }
  });

  it("filters by status=pending (exact match only)", async () => {
    const setup = setupTool(NO_SETUP_TOOL_OPTIONS);
    const { tools, ctx } = setup;
    // init creates 2 pending items; the first auto-promotes to in_progress.
    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "do A" },
          { name: "B", details: "do B" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    // A is in_progress; completing it promotes B (pending → in_progress).
    await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);
    setup.fireSessionEvent("session_start", { cwd: process.cwd() });
    const api = apiFromSetup(setup);

    const pending = api.getItems({ status: "pending" });
    expect(pending.length).toBe(0); // B was promoted; nothing pending now

    const inProgress = api.getItems({ status: "in_progress" });
    expect(inProgress.length).toBe(1);
    expect(inProgress[0].status).toBe("in_progress");
    expect(inProgress[0].name).toBe("B");

    const completed = api.getItems({ status: "completed" });
    expect(completed.length).toBe(1);
    expect(completed[0].status).toBe("completed");
    expect(completed[0].name).toBe("A");
  });

  it("status=completed includes decomposed (folder) items too", async () => {
    const setup = setupTool(NO_SETUP_TOOL_OPTIONS);
    const { tools, ctx } = setup;
    // init item 1; add a child under item 1 → item 1 becomes decomposed.
    await tools.init.execute(
      "call-1",
      { items: [{ name: "Parent", details: "parent goal" }] },
      undefined,
      undefined,
      ctx,
    );
    await tools.add.execute(
      "call-2",
      { items: [{ name: "Child", details: "child step" }], parentId: "1" },
      undefined,
      undefined,
      ctx,
    );
    setup.fireSessionEvent("session_start", { cwd: process.cwd() });
    const api = apiFromSetup(setup);

    const completed = api.getItems({ status: "completed" });
    // decomposed parent is included under "completed"
    expect(completed.some((i) => i.status === "decomposed" && i.name === "Parent")).toBe(true);
  });

  it("is read-only — does not mutate the live list when the caller mutates a returned item", async () => {
    const setup = setupTool(NO_SETUP_TOOL_OPTIONS);
    const { tools, ctx } = setup;
    // a single init item auto-promotes to in_progress.
    await tools.init.execute("call-1", { items: [{ name: "A", details: "do A" }] }, undefined, undefined, ctx);
    setup.fireSessionEvent("session_start", { cwd: process.cwd() });
    const api = apiFromSetup(setup);

    const items = api.getItems(null);
    expect(items.length).toBe(1);
    expect(items[0].status).toBe("in_progress");
    // mutate the returned shallow copy
    (items[0] as { name: string }).name = "MUTATED";
    (items[0] as { status: string }).status = "completed";
    // re-read: the live list is untouched
    const fresh = api.getItems(null);
    expect(fresh[0].name).toBe("A");
    expect(fresh[0].status).toBe("in_progress");
  });
});
