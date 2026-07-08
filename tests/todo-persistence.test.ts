import type { TextContent } from "@earendil-works/pi-ai";
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { TodoItem } from "../src/types.js";
import { NO_SETUP_TOOL_OPTIONS, setupTool } from "./setup-tool.js";

describe("todo tool — persistence", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- appendEntry ---

  test("init calls pi.appendEntry with todo state (string IDs)", async () => {
    const { tools, appendEntryMock, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    expect(appendEntryMock).toHaveBeenCalledWith(
      "pi_todo",
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ id: "1", name: "A", status: "in_progress" }),
          expect.objectContaining({ id: "2", name: "B", status: "pending" }),
        ]),
      }),
    );
  });

  test("complete calls pi.appendEntry with updated state", async () => {
    const { tools, appendEntryMock, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    appendEntryMock.mockClear();

    await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);

    expect(appendEntryMock).toHaveBeenCalledWith(
      "pi_todo",
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ id: "1", status: "completed" }),
          expect.objectContaining({ id: "2", status: "in_progress" }),
        ]),
      }),
    );
  });

  // --- Restore from session branch entries ---

  test("restores from session branch entry on session_start", async () => {
    const branchEntry = {
      type: "custom",
      customType: "pi_todo",
      data: {
        items: [
          { id: "1", name: "Restored A", details: "restored a", status: "in_progress" },
          { id: "2", name: "Restored B", details: "restored b", status: "pending" },
        ],
      },
    };

    const { tools, ctx, handlers } = setupTool({
      getBranch: () => [branchEntry],
    });

    // Fire session_start with reason=reload to trigger restore
    for (const h of handlers.get("session_start") ?? []) {
      await h({ reason: "reload" }, ctx);
    }

    const result = await tools.list.execute("call-1", {}, undefined, undefined, ctx);
    const items = result.details.items;
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("Restored A");
    expect(items[0].status).toBe("in_progress");
    expect(items[1].name).toBe("Restored B");
    expect(items[1].status).toBe("pending");
  });

  test("restores from latest branch entry when multiple exist", async () => {
    const olderEntry = {
      type: "custom",
      customType: "pi_todo",
      data: {
        items: [{ id: "1", name: "Old", details: "old", status: "completed" }],
      },
    };
    const newerEntry = {
      type: "custom",
      customType: "pi_todo",
      data: {
        items: [
          { id: "1", name: "Old", details: "old", status: "completed" },
          { id: "2", name: "New", details: "new", status: "in_progress" },
        ],
      },
    };

    const { tools, ctx, handlers } = setupTool({
      getBranch: () => [olderEntry, newerEntry],
    });

    for (const h of handlers.get("session_start") ?? []) {
      await h({ reason: "reload" }, ctx);
    }

    const result = await tools.list.execute("call-1", {}, undefined, undefined, ctx);
    expect(result.details.items).toHaveLength(2);
    expect(result.details.items[1].name).toBe("New");
  });

  test("restores items on reload; subsequent add keeps contiguous ids", async () => {
    const branchEntry = {
      type: "custom",
      customType: "pi_todo",
      data: {
        // Real persisted state is always contiguous: no tool can create a gap
        // (no delete), so restore needs no renumbering.
        items: [
          { id: "1", name: "A", details: "a", status: "completed" },
          { id: "2", name: "B", details: "b", status: "in_progress" },
        ],
      },
    };

    const { tools, ctx, handlers } = setupTool({
      getBranch: () => [branchEntry],
    });

    for (const h of handlers.get("session_start") ?? []) {
      await h({ reason: "reload" }, ctx);
    }

    // Add a new item — ids stay contiguous (3), existing ids unchanged.
    const result = await tools.add.execute(
      "call-1",
      { items: [{ name: "C", details: "c" }] },
      undefined,
      undefined,
      ctx,
    );
    expect(result.details.items.map((i: TodoItem) => [i.id, i.name])).toEqual([
      ["1", "A"],
      ["2", "B"],
      ["3", "C"],
    ]);
  });

  // --- Empty state ---

  test("starts with empty state when no branch entry", async () => {
    const { tools, ctx, handlers } = setupTool(NO_SETUP_TOOL_OPTIONS);

    for (const h of handlers.get("session_start") ?? []) {
      await h({ reason: "reload" }, ctx);
    }

    const result = await tools.list.execute("call-1", {}, undefined, undefined, ctx);
    expect(result.details.items).toEqual([]);
  });

  // --- session_tree ---

  test("restores on session_tree", async () => {
    const branchEntry = {
      type: "custom",
      customType: "pi_todo",
      data: {
        items: [{ id: "1", name: "Tree", details: "tree", status: "in_progress" }],
      },
    };

    const { tools, ctx, fireSessionEvent } = setupTool({
      getBranch: () => [branchEntry],
    });

    fireSessionEvent("session_tree");

    const result = await tools.list.execute("call-1", {}, undefined, undefined, ctx);
    expect(result.details.items).toHaveLength(1);
    expect(result.details.items[0].name).toBe("Tree");
  });

  // --- Fork-leak: subagent sessions do not inherit parent TODO ---

  test("subagent session (PI_SUBAGENT_PARENT_PID set) does not inherit parent todo", async () => {
    const branchEntry = {
      type: "custom",
      customType: "pi_todo",
      data: {
        items: [{ id: "1", name: "Parent task", details: "from parent", status: "in_progress" }],
      },
    };

    process.env.PI_SUBAGENT_PARENT_PID = String(process.pid);
    try {
      const { tools, ctx, handlers } = setupTool({
        getBranch: () => [branchEntry],
      });

      // Fire session_start with reason=reload to trigger restore
      for (const h of handlers.get("session_start") ?? []) {
        await h({ reason: "reload" }, ctx);
      }

      const result = await tools.list.execute("call-1", {}, undefined, undefined, ctx);
      expect(result.details.items).toHaveLength(0);
    } finally {
      delete process.env.PI_SUBAGENT_PARENT_PID;
    }
  });

  // --- startup reason: `pi --session <id>` opens an existing session ---

  test("restores items on session_start reason=startup (pi --session resume)", async () => {
    // `pi --session <id>` opens an existing session whose branch carries the
    // last persisted pi_todo entry — startup must restore it (just like reload/resume).
    const branchEntry = {
      type: "custom",
      customType: "pi_todo",
      data: {
        items: [
          { id: "1", name: "Resumed A", details: "resumed", status: "in_progress" },
          { id: "2", name: "Resumed B", details: "resumed", status: "pending" },
        ],
      },
    };

    const { tools, ctx, handlers } = setupTool({
      getBranch: () => [branchEntry],
    });

    for (const h of handlers.get("session_start") ?? []) {
      await h({ reason: "startup" }, ctx);
    }

    const result = await tools.list.execute("call-1", {}, undefined, undefined, ctx);
    expect(result.details.items).toHaveLength(2);
    expect(result.details.items[0].name).toBe("Resumed A");
    expect(result.details.items[1].name).toBe("Resumed B");
  });

  test("startup reason does NOT restore TODO for a subagent (fork-session leak guard)", async () => {
    // A fork subagent runs with `pi --session <fork>` (startup) and its copied branch
    // DOES carry the host's pi_todo entries — but subagents must never inherit the
    // parent's task list. reconstructState() enforces this via PI_SUBAGENT_PARENT_PID.
    const branchEntry = {
      type: "custom",
      customType: "pi_todo",
      data: {
        items: [{ id: "1", name: "Parent task", details: "from parent", status: "in_progress" }],
      },
    };

    process.env.PI_SUBAGENT_PARENT_PID = String(process.pid);
    try {
      const { tools, ctx, handlers } = setupTool({
        getBranch: () => [branchEntry],
      });

      for (const h of handlers.get("session_start") ?? []) {
        await h({ reason: "startup" }, ctx);
      }

      const result = await tools.list.execute("call-1", {}, undefined, undefined, ctx);
      expect(result.details.items).toHaveLength(0);
    } finally {
      delete process.env.PI_SUBAGENT_PARENT_PID;
    }
  });

  test("startup reason with an EMPTY branch yields no items (clean new session)", async () => {
    // A clean new `pi` (no --session) has an empty branch → nothing to restore.
    const { tools, ctx, handlers } = setupTool({
      getBranch: () => [],
    });

    for (const h of handlers.get("session_start") ?? []) {
      await h({ reason: "startup" }, ctx);
    }

    const result = await tools.list.execute("call-1", {}, undefined, undefined, ctx);
    expect(result.details.items).toHaveLength(0);
  });

  // --- All-done tombstone ---

  test("all-done appends empty tombstone entry", async () => {
    const { tools, appendEntryMock, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      {
        items: [{ name: "Only", details: "only" }],
      },
      undefined,
      undefined,
      ctx,
    );

    appendEntryMock.mockClear();

    await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);

    // All-done appends empty tombstone to prevent stale state restoration
    expect(appendEntryMock).toHaveBeenCalledWith("pi_todo", { items: [] });
  });

  // --- Migration tests ---

  test("migrates numeric IDs to strings on restore", async () => {
    const branchEntry = {
      type: "custom",
      customType: "pi_todo",
      data: {
        items: [
          { id: 1, name: "Old A", details: "old a", status: "in_progress" },
          { id: 2, name: "Old B", details: "old b", status: "pending" },
        ],
      },
    };

    const { tools, ctx, handlers } = setupTool({
      getBranch: () => [branchEntry],
    });

    for (const h of handlers.get("session_start") ?? []) {
      await h({ reason: "reload" }, ctx);
    }

    const result = await tools.list.execute("call-1", {}, undefined, undefined, ctx);
    expect(result.details.items[0].id).toBe("1");
    expect(result.details.items[1].id).toBe("2");
    expect(result.details.items[0].name).toBe("Old A");
  });

  test("migrates skipped status to completed on restore", async () => {
    const branchEntry = {
      type: "custom",
      customType: "pi_todo",
      data: {
        items: [
          { id: "1", name: "Skipped", details: "skip", status: "skipped" },
          { id: "2", name: "Active", details: "active", status: "in_progress" },
        ],
      },
    };

    const { tools, ctx, handlers } = setupTool({
      getBranch: () => [branchEntry],
    });

    for (const h of handlers.get("session_start") ?? []) {
      await h({ reason: "reload" }, ctx);
    }

    const result = await tools.list.execute("call-1", {}, undefined, undefined, ctx);
    expect(result.details.items[0].status).toBe("completed"); // was "skipped"
    expect(result.details.items[0].name).toBe("Skipped");
    expect(result.details.items[1].status).toBe("in_progress");
  });

  test("migrates unknown status to pending on restore", async () => {
    const branchEntry = {
      type: "custom",
      customType: "pi_todo",
      data: {
        items: [
          { id: "1", name: "Unknown", details: "", status: "unknown_status" },
          { id: "2", name: "Active", details: "", status: "in_progress" },
        ],
      },
    };

    const { tools, ctx, handlers } = setupTool({
      getBranch: () => [branchEntry],
    });

    for (const h of handlers.get("session_start") ?? []) {
      await h({ reason: "reload" }, ctx);
    }

    const result = await tools.list.execute("call-1", {}, undefined, undefined, ctx);
    expect(result.details.items[0].status).toBe("pending"); // was "unknown_status"
    expect(result.details.items[0].name).toBe("Unknown");
    expect(result.details.items[1].status).toBe("in_progress");
  });

  test("migrates both numeric IDs and skipped status together", async () => {
    const branchEntry = {
      type: "custom",
      customType: "pi_todo",
      data: {
        items: [
          { id: 1, name: "Done", details: "done", status: "completed" },
          { id: 2, name: "Was Skipped", details: "skip", status: "skipped" },
          { id: 3, name: "Active", details: "active", status: "in_progress" },
        ],
      },
    };

    const { tools, ctx, handlers } = setupTool({
      getBranch: () => [branchEntry],
    });

    for (const h of handlers.get("session_start") ?? []) {
      await h({ reason: "reload" }, ctx);
    }

    const result = await tools.list.execute("call-1", {}, undefined, undefined, ctx);
    const items = result.details.items;
    expect(items[0].id).toBe("1");
    expect(items[0].status).toBe("completed");
    expect(items[1].id).toBe("2");
    expect(items[1].status).toBe("completed"); // migrated from skipped
    expect(items[2].id).toBe("3");
    expect(items[2].status).toBe("in_progress");
  });

  test("restores parentId on items from persisted state", async () => {
    const branchEntry = {
      type: "custom",
      customType: "pi_todo",
      data: {
        items: [
          { id: "1", name: "Parent", details: "parent", status: "decomposed" },
          { id: "1.1", parentId: "1", name: "Child", details: "child", status: "in_progress" },
          { id: "2", name: "Next", details: "next", status: "pending" },
        ],
      },
    };

    const { tools, ctx, handlers } = setupTool({
      getBranch: () => [branchEntry],
    });

    for (const h of handlers.get("session_start") ?? []) {
      await h({ reason: "reload" }, ctx);
    }

    const result = await tools.list.execute("call-1", {}, undefined, undefined, ctx);
    const items = result.details.items;
    expect(items).toHaveLength(3);
    expect(items[0].status).toBe("decomposed");
    expect(items[1].parentId).toBe("1");
    expect(items[1].id).toBe("1.1");
  });

  test("restores nested (decomposed parent) tree; add keeps ids stable", async () => {
    const branchEntry = {
      type: "custom",
      customType: "pi_todo",
      data: {
        // Contiguous tree with a decomposed parent + child.
        items: [
          { id: "1", name: "A", details: "a", status: "decomposed" },
          { id: "1.1", parentId: "1", name: "Child", details: "c", status: "completed" },
          { id: "2", name: "B", details: "b", status: "in_progress" },
        ],
      },
    };

    const { tools, ctx, handlers } = setupTool({
      getBranch: () => [branchEntry],
    });

    for (const h of handlers.get("session_start") ?? []) {
      await h({ reason: "reload" }, ctx);
    }

    // Add a top-level item — existing ids stay put, new one appends as 3.
    const result = await tools.add.execute("call-1", { items: [{ name: "New" }] }, undefined, undefined, ctx);
    const items = result.details.items;
    expect(items.map((i: TodoItem) => [i.id, i.parentId, i.name])).toEqual([
      ["1", undefined, "A"],
      ["1.1", "1", "Child"],
      ["2", undefined, "B"],
      ["3", undefined, "New"],
    ]);
  });

  test("appendEntry throwing does not propagate error", async () => {
    const { tools, ctx, appendEntryMock } = setupTool(NO_SETUP_TOOL_OPTIONS);

    appendEntryMock.mockImplementation(() => {
      throw new Error("disk full");
    });

    const result = await tools.init.execute(
      "call-1",
      { items: [{ name: "A", details: "" }] },
      undefined,
      undefined,
      ctx,
    );

    expect((result.content[0] as TextContent).text).not.toContain("Error");
    expect(appendEntryMock).toHaveBeenCalled();
  });

  test("restoring corrupt persisted data migrates gracefully", async () => {
    const branchEntry = {
      type: "custom",
      customType: "pi_todo",
      data: {
        items: [
          { id: undefined, name: null, details: "a", status: "pending" },
          { id: "2", name: "B", details: "b", status: "in_progress" },
        ],
      },
    };

    const { tools, ctx, handlers } = setupTool({
      getBranch: () => [branchEntry],
    });

    for (const h of handlers.get("session_start") ?? []) {
      await h({ reason: "reload" }, ctx);
    }

    const result = await tools.list.execute("call-1", {}, undefined, undefined, ctx);
    expect((result.content[0] as TextContent).text).not.toContain("Error");
    const items = result.details.items;
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("");
    expect(items[0].name).toBe("");
    expect(items[1].id).toBe("2");
    expect(items[1].name).toBe("B");
  });

  test("restoring data with non-array items falls back to empty state", async () => {
    const branchEntry = {
      type: "custom",
      customType: "pi_todo",
      data: {
        items: "not an array",
      },
    };

    const { tools, ctx, handlers } = setupTool({
      getBranch: () => [branchEntry],
    });

    for (const h of handlers.get("session_start") ?? []) {
      await h({ reason: "reload" }, ctx);
    }

    const result = await tools.list.execute("call-1", {}, undefined, undefined, ctx);
    expect(result.details.items).toEqual([]);
  });
});
