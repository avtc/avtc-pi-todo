// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import type { TextContent } from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import { NO_SETUP_TOOL_OPTIONS, setupTool } from "./setup-tool.js";

describe("todo tool — init action", () => {
  test("creates items with stable IDs and first item in_progress", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    const result = await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "Research X", details: "Check docs for X" },
          { name: "Design Y", details: "Create design for Y" },
          { name: "Implement Z", details: "Code Z" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as TextContent).text;
    expect(text).toContain("In progress: ▶ 1: Research X");
    expect(text).toContain("Check docs for X");

    // List to verify state
    const listResult = await tools.list.execute("call-2", {}, undefined, undefined, ctx);
    const items = listResult.details.items;
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ id: "1", name: "Research X", details: "Check docs for X", status: "in_progress" });
    expect(items[1]).toEqual({ id: "2", name: "Design Y", details: "Create design for Y", status: "pending" });
    expect(items[2]).toEqual({ id: "3", name: "Implement Z", details: "Code Z", status: "pending" });
  });

  test("rejects re-init with new items when a plan exists, returns unfinished + guidance", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "First", details: "First details" },
          { name: "Second", details: "Second details" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    // Complete First so we have one completed + one in_progress
    await tools.complete.execute("c", { id: "1" }, undefined, undefined, ctx);

    // Re-init with new items is rejected
    const result = await tools.init.execute(
      "call-2",
      { items: [{ name: "New item", details: "New details" }] },
      undefined,
      undefined,
      ctx,
    );

    expect(result.details.error).toBe(true);
    const text = (result.content[0] as TextContent).text;
    expect(text).toContain("plan already exists");
    expect(text).toContain("todo_add");
    expect(text).toContain("items: []");
    // Returns the unfinished item (Second, in_progress) with full details
    expect(text).toContain("Second");
    expect(text).toContain("Second details");
    // Completed item (First) is not included
    expect(text).not.toMatch(/First details/);

    // State unchanged
    const listResult = await tools.list.execute("call-3", {}, undefined, undefined, ctx);
    expect(listResult.details.items).toHaveLength(2);
  });

  test("init with empty items on no existing plan returns guidance", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    const result = await tools.init.execute("call-1", { items: [] }, undefined, undefined, ctx);

    const text = (result.content[0] as TextContent).text;
    expect(text).toContain("No existing plan to clear");
    expect(result.details.error).toBeUndefined();

    const listResult = await tools.list.execute("call-2", {}, undefined, undefined, ctx);
    expect(listResult.details.items).toEqual([]);
  });

  test("init with empty items clears the list and returns unfinished items", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    // First init with items
    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "A details" },
          { name: "B", details: "B details" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Clear with empty items — returns the cleared unfinished items
    const result = await tools.init.execute("call-2", { items: [] }, undefined, undefined, ctx);
    const text = (result.content[0] as TextContent).text;
    expect(text).toContain("Cleared 2 unfinished item(s)");
    expect(text).toContain("re-add via todo_add");
    // Full details of cleared items are returned
    expect(text).toContain("A details");
    expect(text).toContain("B details");
    expect(result.details.error).toBeUndefined();

    // State is cleared
    const listResult = await tools.list.execute("call-3", {}, undefined, undefined, ctx);
    expect(listResult.details.items).toEqual([]);
  });

  test("init items without details field default to empty string", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    const result = await tools.init.execute(
      "call-1",
      { items: [{ name: "A" }, { name: "B" }] },
      undefined,
      undefined,
      ctx,
    );

    // Should succeed without error
    expect((result.content[0] as TextContent).text).not.toContain("Error");

    // Verify items have empty details
    const listResult = await tools.list.execute("call-2", {}, undefined, undefined, ctx);
    const items = listResult.details.items;
    expect(items).toHaveLength(2);
    expect(items[0].details).toBe("");
    expect(items[1].details).toBe("");
  });

  test("init with empty name field creates item with empty name", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    const result = await tools.init.execute(
      "call-1",
      { items: [{ name: "" }, { name: "Valid" }] },
      undefined,
      undefined,
      ctx,
    );

    // Should succeed — empty name is not validated
    expect((result.content[0] as TextContent).text).not.toContain("Error");

    const listResult = await tools.list.execute("call-2", {}, undefined, undefined, ctx);
    const items = listResult.details.items;
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("");
    expect(items[1].name).toBe("Valid");
  });
});

describe("todo tool — list action", () => {
  test("returns all items with id, name, status", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "Alpha", details: "A details" },
          { name: "Beta", details: "B details" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    const result = await tools.list.execute("call-2", {}, undefined, undefined, ctx);

    const text = (result.content[0] as TextContent).text;
    expect(text).toContain("Alpha");
    expect(text).toContain("Beta");

    const items = result.details.items;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ id: "1", name: "Alpha", details: "A details", status: "in_progress" });
    expect(items[1]).toEqual({ id: "2", name: "Beta", details: "B details", status: "pending" });
  });

  test("returns empty when no items", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    const result = await tools.list.execute("call-1", {}, undefined, undefined, ctx);

    expect((result.content[0] as TextContent).text).toContain("No todos");
    expect(result.details.items).toEqual([]);
  });

  test("filters by status", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
          { name: "C", details: "c" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Complete item "1"
    await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);

    // Filter by completed
    const result = await tools.list.execute("call-3", { status: "completed" }, undefined, undefined, ctx);
    const items = result.details.items;
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("A");
    expect(items[0].status).toBe("completed");
    expect((result.content[0] as TextContent).text).toContain("completed items: 1");
  });

  test("status filter matching zero items returns empty list", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

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

    // All items are pending/in_progress — filter by completed should return 0
    const result = await tools.list.execute("call-2", { status: "completed" }, undefined, undefined, ctx);
    expect(result.details.items).toHaveLength(0);
    expect((result.content[0] as TextContent).text).toContain("completed items: 0");
  });

  test("filters by parentId (direct children only)", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "Parent", details: "" },
          { name: "Other", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    await tools.add.execute(
      "c2",
      {
        items: [
          { name: "Child1", details: "" },
          { name: "Child2", details: "" },
        ],
        parentId: "1",
      },
      undefined,
      undefined,
      ctx,
    );

    const result = await tools.list.execute("c3", { parentId: "1" }, undefined, undefined, ctx);
    const items = result.details.items;
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("1.1");
    expect(items[0].name).toBe("Child1");
    expect(items[1].id).toBe("1.2");
    expect(items[1].name).toBe("Child2");
    expect((result.content[0] as TextContent).text).toContain("Children of '1'");
  });

  test("parentId filter on 3+ level hierarchy returns only direct children", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    // Build: 1 (Parent) → 1.1 (Child) → 1.1.1 (Grandchild), 1.1.2 (Grandchild2)
    await tools.add.execute("c1", { items: [{ name: "Parent", details: "" }] }, undefined, undefined, ctx);
    await tools.add.execute(
      "c2",
      { items: [{ name: "Child", details: "" }], parentId: "1" },
      undefined,
      undefined,
      ctx,
    );
    await tools.add.execute(
      "c3",
      {
        items: [
          { name: "Grandchild", details: "" },
          { name: "Grandchild2", details: "" },
        ],
        parentId: "1.1",
      },
      undefined,
      undefined,
      ctx,
    );

    // parentId="1" → only direct child 1.1, NOT grandchildren 1.1.1/1.1.2
    const result1 = await tools.list.execute("c4", { parentId: "1" }, undefined, undefined, ctx);
    expect(result1.details.items).toHaveLength(1);
    expect(result1.details.items[0].id).toBe("1.1");

    // parentId="1.1" → only direct children 1.1.1 and 1.1.2
    const result2 = await tools.list.execute("c5", { parentId: "1.1" }, undefined, undefined, ctx);
    expect(result2.details.items).toHaveLength(2);
    expect(result2.details.items.map((i: { id: string; status?: string; name?: string }) => i.id)).toEqual([
      "1.1.1",
      "1.1.2",
    ]);
  });

  test("list with non-existent parentId returns empty items", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.add.execute("c1", { items: [{ name: "A", details: "" }] }, undefined, undefined, ctx);

    const result = await tools.list.execute("c2", { parentId: "100" }, undefined, undefined, ctx);
    expect(result.details.items).toHaveLength(0);
    expect((result.content[0] as TextContent).text).toContain("Children of '100'");
    expect((result.content[0] as TextContent).text).toContain("0 items");
  });

  test("positional range with fromId and toId", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
          { name: "C", details: "c" },
          { name: "D", details: "d" },
          { name: "E", details: "e" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // fromId "1" inclusive, toId "3" exclusive → items at positions 1 and 2
    const result = await tools.list.execute("call-2", { fromId: "2", toId: "4" }, undefined, undefined, ctx);

    const items = result.details.items;
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("B");
    expect(items[1].name).toBe("C");
    expect((result.content[0] as TextContent).text).toContain("Showing 2 of 5 items");
  });

  test("fromId only (no toId) returns from that position to end", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
          { name: "C", details: "c" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    const result = await tools.list.execute("call-2", { fromId: "2" }, undefined, undefined, ctx);
    const items = result.details.items;
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("B");
    expect(items[1].name).toBe("C");
  });

  test("toId only (no fromId) returns from start to that position", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
          { name: "C", details: "c" },
          { name: "D", details: "d" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    const result = await tools.list.execute("call-2", { toId: "3" }, undefined, undefined, ctx);
    const items = result.details.items;
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("A");
    expect(items[1].name).toBe("B");
  });

  test("returns empty when fromId not found (defaults to start)", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

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

    // fromId "9" not found → fromIdx = -1 → start = 0, but toId "1" → only position 0
    const result = await tools.list.execute("call-2", { fromId: "10", toId: "2" }, undefined, undefined, ctx);
    const items = result.details.items;
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("A");
    expect((result.content[0] as TextContent).text).toContain("fromId '10' not found");
  });

  test("returns all items from start when toId not found", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
          { name: "C", details: "c" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // toId "99" not found → end defaults to items.length → all items from start
    const result = await tools.list.execute("call-2", { toId: "100" }, undefined, undefined, ctx);
    const items = result.details.items;
    expect(items).toHaveLength(3);
    expect(items.map((i: { id: string; status?: string; name?: string }) => i.name)).toEqual(["A", "B", "C"]);
    expect((result.content[0] as TextContent).text).toContain("toId '100' not found");
  });

  test("returns empty list when fromId > toId (inverted range)", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
          { name: "C", details: "c" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // fromId "3" > toId "1" → start > end → filter matches nothing
    const result = await tools.list.execute("call-2", { fromId: "3", toId: "1" }, undefined, undefined, ctx);
    const items = result.details.items;
    expect(items).toHaveLength(0);
    expect((result.content[0] as TextContent).text).toContain("0 of 3 items");
  });

  test("combines status + parentId filters", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.add.execute("c1", { items: [{ name: "Parent", details: "" }] }, undefined, undefined, ctx);
    // Add children: 0.1, 0.2
    await tools.add.execute(
      "c2",
      {
        items: [
          { name: "Child1", details: "" },
          { name: "Child2", details: "" },
          { name: "Child3", details: "" },
        ],
        parentId: "1",
      },
      undefined,
      undefined,
      ctx,
    );
    // Complete Child1 (0.1) — auto-advances to Child2 (0.2)
    await tools.complete.execute("c3", { id: "1.1" }, undefined, undefined, ctx);

    // Filter: pending children of Parent
    const result = await tools.list.execute("c4", { parentId: "1", status: "pending" }, undefined, undefined, ctx);
    const items = result.details.items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("1.3");
    expect(items[0].name).toBe("Child3");
    expect(items[0].status).toBe("pending");
  });

  test("combines status + fromId/toId filters", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "c1",
      {
        items: [
          { name: "A", details: "" },
          { name: "B", details: "" },
          { name: "C", details: "" },
          { name: "D", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    // Complete A (0) and C (2)
    await tools.complete.execute("c2", { id: "1" }, undefined, undefined, ctx);
    // After completing 0, B is in_progress. Complete B too.
    await tools.complete.execute("c3", { id: "2" }, undefined, undefined, ctx);
    // Now C is in_progress. Complete C.
    await tools.complete.execute("c4", { id: "3" }, undefined, undefined, ctx);

    // Filter: completed items in range fromId "1" to "3" → B(1) and C(2)
    const result = await tools.list.execute(
      "c5",
      { status: "completed", fromId: "2", toId: "4" },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("B");
    expect(items[1].name).toBe("C");
  });

  test("fromId/toId on hierarchical list respects flat order with children", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    // Build: Parent(0) > Child1(1.1) > Grandchild(1.1.1), Child2(1.2), Next(1)
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "Parent", details: "" },
          { name: "Next", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    await tools.add.execute(
      "c2",
      {
        items: [
          { name: "Child1", details: "" },
          { name: "Child2", details: "" },
        ],
        parentId: "1",
      },
      undefined,
      undefined,
      ctx,
    );
    await tools.add.execute(
      "c3",
      { items: [{ name: "Grandchild", details: "" }], parentId: "1.1" },
      undefined,
      undefined,
      ctx,
    );

    // Flat order: Parent(0), Child1(1.1), Grandchild(1.1.1), Child2(1.2), Next(1)
    // fromId "1.1" inclusive, toId "1.2" exclusive → Child1(1.1), Grandchild(1.1.1)
    const result1 = await tools.list.execute("c4", { fromId: "1.1", toId: "1.2" }, undefined, undefined, ctx);
    const items1 = result1.details.items;
    expect(items1).toHaveLength(2);
    expect(items1.map((i: { id: string; status?: string; name?: string }) => i.id)).toEqual(["1.1", "1.1.1"]);

    // fromId "1.2" inclusive, toId "2" exclusive → Child2(1.2)
    const result2 = await tools.list.execute("c5", { fromId: "1.2", toId: "2" }, undefined, undefined, ctx);
    const items2 = result2.details.items;
    expect(items2).toHaveLength(1);
    expect(items2[0].id).toBe("1.2");

    // fromId "1" inclusive, toId "1" exclusive → entire subtree of Parent
    const result3 = await tools.list.execute("c6", { fromId: "1", toId: "2" }, undefined, undefined, ctx);
    const items3 = result3.details.items;
    expect(items3).toHaveLength(4);
    expect(items3.map((i: { id: string; status?: string; name?: string }) => i.id)).toEqual([
      "1",
      "1.1",
      "1.1.1",
      "1.2",
    ]);
  });

  test("combines parentId + fromId/toId filters", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    // Build: Parent(0) > Child1(1.1) > Grandchild(1.1.1), Child2(1.2), Next(1)
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "Parent", details: "" },
          { name: "Next", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    await tools.add.execute(
      "c2",
      {
        items: [
          { name: "Child1", details: "" },
          { name: "Child2", details: "" },
        ],
        parentId: "1",
      },
      undefined,
      undefined,
      ctx,
    );
    await tools.add.execute(
      "c3",
      { items: [{ name: "Grandchild", details: "" }], parentId: "1.1" },
      undefined,
      undefined,
      ctx,
    );

    // parentId="1" + fromId="1.2" → direct children of 1 at or after position of 0.2
    // Flat order: Parent(0), Child1(1.1), Grandchild(1.1.1), Child2(1.2), Next(1)
    // Direct children of 0: Child1(1.1), Child2(1.2)
    // After applying fromId="1.2" (position 3): only Child2(1.2) passes
    const result = await tools.list.execute("c4", { parentId: "1", fromId: "1.2" }, undefined, undefined, ctx);
    const items = result.details.items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("1.2");
    expect(items[0].name).toBe("Child2");
  });

  test("filters by status=decomposed", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    // Init: A(0), B(1), C(2)
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "A", details: "" },
          { name: "B", details: "" },
          { name: "C", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    // Decompose A via parentId → A becomes decomposed
    await tools.add.execute("c2", { items: [{ name: "A.1", details: "" }], parentId: "1" }, undefined, undefined, ctx);
    // Complete B
    await tools.complete.execute("c3", { id: "2" }, undefined, undefined, ctx);

    // Filter by decomposed
    const result = await tools.list.execute("c4", { status: "decomposed" }, undefined, undefined, ctx);
    const items = result.details.items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("1");
    expect(items[0].name).toBe("A");
    expect(items[0].status).toBe("decomposed");
    expect((result.content[0] as TextContent).text).toContain("decomposed items: 1");
  });

  test("filters by status=in_progress", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    // Init: A(1, in_progress), B(2, pending), C(3, pending)
    await tools.init.execute(
      "c1",
      {
        items: [
          { name: "A", details: "" },
          { name: "B", details: "" },
          { name: "C", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Filter by in_progress — should return only A
    const result = await tools.list.execute("c2", { status: "in_progress" }, undefined, undefined, ctx);
    const items = result.details.items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("1");
    expect(items[0].name).toBe("A");
    expect(items[0].status).toBe("in_progress");
    expect((result.content[0] as TextContent).text).toContain("in_progress items: 1");
  });
});

describe("todo tool — add action", () => {
  test("appends items to existing list", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      { items: [{ name: "First", details: "First details" }] },
      undefined,
      undefined,
      ctx,
    );

    const _result = await tools.add.execute(
      "call-2",
      { items: [{ name: "Second", details: "Second details" }] },
      undefined,
      undefined,
      ctx,
    );

    const listResult = await tools.list.execute("call-3", {}, undefined, undefined, ctx);
    const items = listResult.details.items;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ id: "1", name: "First", details: "First details", status: "in_progress" });
    expect(items[1]).toEqual({ id: "2", name: "Second", details: "Second details", status: "pending" });
  });

  test("add to empty list auto-advances first item", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    const result = await tools.init.execute(
      "call-1",
      { items: [{ name: "Standalone", details: "Only item" }] },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as TextContent).text;
    expect(text).toContain("In progress: ▶ 1: Standalone");
    expect(text).toContain("Only item");

    const listResult = await tools.list.execute("call-2", {}, undefined, undefined, ctx);
    expect(listResult.details.items[0].status).toBe("in_progress");
  });

  test("add requires items parameter", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = await tools.add.execute("call-1", { items: [] }, undefined, undefined, ctx);
    expect((result.content[0] as TextContent).text).toContain("Error");
  });

  test("add rejects empty items array", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = await tools.add.execute("call-1", { items: [] }, undefined, undefined, ctx);
    expect((result.content[0] as TextContent).text).toContain("Error");
    expect((result.content[0] as TextContent).text).toContain("empty");
    expect(result.details.error).toBe(true);
  });

  test("add with empty name field creates item with empty name", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute("c1", { items: [{ name: "First" }] }, undefined, undefined, ctx);

    const result = await tools.add.execute("c2", { items: [{ name: "" }] }, undefined, undefined, ctx);

    // Should succeed — empty name is not validated
    expect((result.content[0] as TextContent).text).not.toContain("Error");

    const listResult = await tools.list.execute("c3", {}, undefined, undefined, ctx);
    const items = listResult.details.items;
    expect(items).toHaveLength(2);
    expect(items[1].name).toBe("");
  });

  test("add after all items completed (all-done clearing) works fresh", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    // Init and complete all items to trigger all-done clearing
    await tools.init.execute("c1", { items: [{ name: "A", details: "" }] }, undefined, undefined, ctx);
    const completeResult = await tools.complete.execute("c2", { id: "1" }, undefined, undefined, ctx);
    // Verify all-done clearing happened
    expect((completeResult.content[0] as TextContent).text).toContain("List cleared");

    // Now add new items — should start fresh with ID "1"
    const addResult = await tools.init.execute(
      "c3",
      { items: [{ name: "New", details: "Fresh start" }] },
      undefined,
      undefined,
      ctx,
    );
    const items = addResult.details.items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("1");
    expect(items[0].name).toBe("New");
    expect(items[0].status).toBe("in_progress"); // auto-advanced
  });
});

describe("add with parentId", () => {
  test("adds children and marks parent decomposed", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "Parent", details: "" },
          { name: "Next", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    const result = await tools.add.execute(
      "c2",
      { items: [{ name: "Child1", details: "" }], parentId: "1" },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    expect(items[0].id).toBe("1");
    expect(items[0].status).toBe("decomposed");
    expect(items[1].id).toBe("1.1");
    expect(items[1].parentId).toBe("1");
    expect(items[1].status).toBe("in_progress"); // auto-advanced to first child
  });

  test("decomposes in_progress item that was promoted after complete", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "A", details: "" },
          { name: "B", details: "" },
          { name: "C", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Complete A → B becomes in_progress
    await tools.complete.execute("c2", { id: "1" }, undefined, undefined, ctx);

    // Decompose B (currently in_progress)
    const result = await tools.add.execute(
      "c3",
      {
        items: [
          { name: "B.1", details: "" },
          { name: "B.2", details: "" },
        ],
        parentId: "2",
      },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    // B should now be decomposed, B.1 should be in_progress
    const b = items.find((i: { id: string; status?: string; name?: string }) => i.id === "2");
    if (!b) throw new Error("item not found");
    expect(b.status).toBe("decomposed");

    const b1 = items.find((i: { id: string; status?: string; name?: string }) => i.id === "2.1");
    if (!b1) throw new Error("item not found");
    expect(b1.parentId).toBe("2");
    expect(b1.status).toBe("in_progress");

    const b2 = items.find((i: { id: string; status?: string; name?: string }) => i.id === "2.2");
    if (!b2) throw new Error("item not found");
    expect(b2.parentId).toBe("2");
    expect(b2.status).toBe("pending");

    // C should remain pending
    const c = items.find((i: { id: string; status?: string; name?: string }) => i.id === "3");
    if (!c) throw new Error("item not found");
    expect(c.status).toBe("pending");
  });

  test("adds multiple children with sequential IDs", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute("c1", { items: [{ name: "Parent", details: "" }] }, undefined, undefined, ctx);

    const result = await tools.add.execute(
      "c2",
      {
        items: [
          { name: "A", details: "" },
          { name: "B", details: "" },
        ],
        parentId: "1",
      },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    expect(items[1].id).toBe("1.1");
    expect(items[2].id).toBe("1.2");
  });

  test("returns error for invalid parentId", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute("c1", { items: [{ name: "A", details: "" }] }, undefined, undefined, ctx);

    const result = await tools.add.execute(
      "c2",
      { items: [{ name: "Child", details: "" }], parentId: "10" },
      undefined,
      undefined,
      ctx,
    );
    expect((result.content[0] as TextContent).text).toContain("Error");
    expect(result.details.error).toBe(true);
  });

  test("inserts after entire subtree when grandchildren exist", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "Parent", details: "" },
          { name: "Next", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    // Decompose parent with first child
    await tools.add.execute(
      "c2",
      { items: [{ name: "Child1", details: "" }], parentId: "1" },
      undefined,
      undefined,
      ctx,
    );
    // Add grandchild under Child1
    await tools.add.execute(
      "c3",
      { items: [{ name: "Grandchild", details: "" }], parentId: "1.1" },
      undefined,
      undefined,
      ctx,
    );
    // Now add second child to parent — should go after grandchild
    const result = await tools.add.execute(
      "c4",
      { items: [{ name: "Child2", details: "" }], parentId: "1" },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    // Expected order: Parent(0), Child1(1.1), Grandchild(1.1.1), Child2(1.2), Next(1)
    expect(items[0].id).toBe("1");
    expect(items[0].status).toBe("decomposed");
    expect(items[1].id).toBe("1.1");
    expect(items[2].id).toBe("1.1.1");
    expect(items[3].id).toBe("1.2"); // Child2 inserted after entire subtree
    expect(items[3].parentId).toBe("1");
    expect(items[4].id).toBe("2"); // Next untouched
  });

  test("errors when both parentId and beforeId provided but beforeId is outside parentId", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "Parent", details: "" },
          { name: "Other", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Both parentId and beforeId set, but beforeId ("2") is not a child of parentId ("1")
    const result = await tools.add.execute(
      "c2",
      { items: [{ name: "Child", details: "" }], parentId: "1", beforeId: "2" },
      undefined,
      undefined,
      ctx,
    );
    expect(result.details.error).toBe(true);
    expect((result.content[0] as TextContent).text).toContain("not a direct child");
    expect((result.content[0] as TextContent).text).toContain("beforeId must be a child of parentId");
  });

  test("inserts before beforeId when both provided and beforeId is inside parentId", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [{ name: "Parent", details: "" }],
      },
      undefined,
      undefined,
      ctx,
    );
    // Add existing child "1.1"
    await tools.add.execute(
      "c2",
      { items: [{ name: "Existing", details: "" }], parentId: "1" },
      undefined,
      undefined,
      ctx,
    );

    // Add new child before "1.1" under parent "1"
    const result = await tools.add.execute(
      "c3",
      { items: [{ name: "NewChild", details: "" }], parentId: "1", beforeId: "1.1" },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    // Should insert as child of "1" before "1.1" (which gets renumbered)
    expect(items[0].status).toBe("decomposed");
    expect(items[1].name).toBe("NewChild");
    expect(items[1].parentId).toBe("1");
    expect(items[2].name).toBe("Existing");
  });

  test("rejects grandchild beforeId (deeper descendant would corrupt tree)", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute("c1", { items: [{ name: "Parent", details: "" }] }, undefined, undefined, ctx);
    // Build 1.1 → 1.1.1 (grandchild)
    await tools.add.execute(
      "c2",
      { items: [{ name: "Child", details: "" }], parentId: "1" },
      undefined,
      undefined,
      ctx,
    );
    await tools.add.execute(
      "c3",
      { items: [{ name: "Grandchild", details: "" }], parentId: "1.1" },
      undefined,
      undefined,
      ctx,
    );
    // beforeId "1.1.1" is a descendant of parentId "1" but NOT a direct child — must reject
    const result = await tools.add.execute(
      "c4",
      { items: [{ name: "New", details: "" }], parentId: "1", beforeId: "1.1.1" },
      undefined,
      undefined,
      ctx,
    );
    expect(result.details.error).toBe(true);
    expect((result.content[0] as TextContent).text).toContain("not a direct child");
  });

  test("appends children to already-decomposed item", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute("c1", { items: [{ name: "Parent", details: "" }] }, undefined, undefined, ctx);
    // First decomposition: add Child1, Child2
    await tools.add.execute(
      "c2",
      {
        items: [
          { name: "Child1", details: "" },
          { name: "Child2", details: "" },
        ],
        parentId: "1",
      },
      undefined,
      undefined,
      ctx,
    );

    // Second add to same parent — parent already decomposed
    const result = await tools.add.execute(
      "c3",
      { items: [{ name: "Child3", details: "" }], parentId: "1" },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    // Parent stays decomposed, new child appended after existing children
    expect(items[0].id).toBe("1");
    expect(items[0].status).toBe("decomposed");
    expect(items[1].id).toBe("1.1");
    expect(items[2].id).toBe("1.2");
    expect(items[3].id).toBe("1.3"); // New child
    expect(items[3].parentId).toBe("1");
  });

  test("appends children to nested item with existing children", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "Root", details: "" },
          { name: "Other", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    // Decompose Root → Child1(1.1)
    await tools.add.execute(
      "c2",
      { items: [{ name: "Child1", details: "" }], parentId: "1" },
      undefined,
      undefined,
      ctx,
    );
    // Decompose Child1(1.1) → Grandchild1(0.1.1), Grandchild2(0.1.2)
    await tools.add.execute(
      "c3",
      {
        items: [
          { name: "GC1", details: "" },
          { name: "GC2", details: "" },
        ],
        parentId: "1.1",
      },
      undefined,
      undefined,
      ctx,
    );

    // Now append another child to 0.1 — should get ID 0.1.3, placed after 0.1.2
    const result = await tools.add.execute(
      "c4",
      { items: [{ name: "GC3", details: "" }], parentId: "1.1" },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    // Flat order: Root(0), Child1(0.1, decomposed), GC1(0.1.1), GC2(0.1.2), GC3(0.1.3), Other(1)
    expect(items[0]).toMatchObject({ id: "1", status: "decomposed" });
    expect(items[1]).toMatchObject({ id: "1.1", parentId: "1", status: "decomposed" });
    expect(items[2]).toMatchObject({ id: "1.1.1", parentId: "1.1" });
    expect(items[3]).toMatchObject({ id: "1.1.2", parentId: "1.1" });
    expect(items[4]).toMatchObject({ id: "1.1.3", parentId: "1.1", name: "GC3" });
    expect(items[5]).toMatchObject({ id: "2", name: "Other" });
  });

  test("adds deeply-nested children (3+ levels)", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "Root", details: "" },
          { name: "Other", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Level 1: decompose Root → Child(0.1)
    await tools.add.execute(
      "c2",
      { items: [{ name: "Child", details: "" }], parentId: "1" },
      undefined,
      undefined,
      ctx,
    );
    // Level 2: decompose Child(0.1) → Grandchild(1.1.1)
    await tools.add.execute(
      "c3",
      { items: [{ name: "Grandchild", details: "" }], parentId: "1.1" },
      undefined,
      undefined,
      ctx,
    );
    // Level 3: decompose Grandchild(1.1.1) → GreatGrandchild(0.1.1.1)
    await tools.add.execute(
      "c4",
      { items: [{ name: "GreatGrandchild", details: "" }], parentId: "1.1.1" },
      undefined,
      undefined,
      ctx,
    );

    const result = await tools.list.execute("c5", {}, undefined, undefined, ctx);
    const items = result.details.items;

    // Verify full hierarchy and all decomposed except deepest
    expect(items[0]).toMatchObject({ id: "1", status: "decomposed" });
    expect(items[1]).toMatchObject({ id: "1.1", parentId: "1", status: "decomposed" });
    expect(items[2]).toMatchObject({ id: "1.1.1", parentId: "1.1", status: "decomposed" });
    expect(items[3]).toMatchObject({ id: "1.1.1.1", parentId: "1.1.1", status: "in_progress" });
    expect(items[4]).toMatchObject({ id: "2", status: "pending" });
  });

  test("add with parentId rejects completed parent", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    // Init and complete item 0
    await tools.add.execute("c1", { items: [{ name: "A" }, { name: "B" }] }, undefined, undefined, ctx);
    await tools.complete.execute("c2", { id: "1" }, undefined, undefined, ctx);

    // Try to add children to the completed item
    const result = await tools.add.execute(
      "c3",
      { items: [{ name: "A.1" }], parentId: "1" },
      undefined,
      undefined,
      ctx,
    );
    expect((result.content[0] as TextContent).text).toContain("Error");
    expect((result.content[0] as TextContent).text).toContain("completed");
    expect(result.details.error).toBe(true);
  });
});

describe("add with beforeId (top-level)", () => {
  test("inserts before target and renumbers subsequent items", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "A", details: "" },
          { name: "B", details: "" },
          { name: "C", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Insert before B (id "2") — New takes id 2, B and C shift
    const result = await tools.add.execute(
      "c2",
      { items: [{ name: "New", details: "" }], beforeId: "2" },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    expect(items[0].id).toBe("1"); // A - unchanged
    expect(items[1].name).toBe("New"); // inserted, takes B's slot
    expect(items[1].id).toBe("2");
    expect(items[2].id).toBe("3"); // B shifted
    expect(items[2].name).toBe("B");
    expect(items[3].id).toBe("4"); // C shifted
    expect(items[3].name).toBe("C");
  });

  test("append gets the correct id after a beforeId renumber", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "A", details: "" },
          { name: "B", details: "" },
          { name: "C", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Insert before B — renumbers B→3, C→4 (positional rederive via renumberTree).
    await tools.add.execute("c2", { items: [{ name: "New", details: "" }], beforeId: "2" }, undefined, undefined, ctx);

    // Plain append — renumberTree assigns the next positional top-level id "5".
    const result = await tools.add.execute("c3", { items: [{ name: "X", details: "" }] }, undefined, undefined, ctx);
    const xItem = result.details.items.find((i: { id: string; status?: string; name?: string }) => i.name === "X");
    if (!xItem) throw new Error("item not found");
    expect(xItem.id).toBe("5");
  });

  test("returns error for invalid beforeId", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute("c1", { items: [{ name: "A", details: "" }] }, undefined, undefined, ctx);

    const result = await tools.add.execute(
      "c2",
      { items: [{ name: "New", details: "" }], beforeId: "10" },
      undefined,
      undefined,
      ctx,
    );
    expect((result.content[0] as TextContent).text).toContain("Error");
    expect(result.details.error).toBe(true);
  });

  test("errors when both parentId and beforeId provided but beforeId outside parentId", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "A", details: "" },
          { name: "B", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    const result = await tools.add.execute(
      "c2",
      { items: [{ name: "Child", details: "" }], parentId: "1", beforeId: "2" },
      undefined,
      undefined,
      ctx,
    );
    expect(result.details.error).toBe(true);
    expect((result.content[0] as TextContent).text).toContain("not a direct child");
  });

  test("inserts before target without disturbing an earlier subtree", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    // Init A, B, C
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "A", details: "" },
          { name: "B", details: "" },
          { name: "C", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    // Decompose A with children 1.1, 1.2
    await tools.add.execute(
      "c2",
      {
        items: [
          { name: "A1", details: "" },
          { name: "A2", details: "" },
        ],
        parentId: "1",
      },
      undefined,
      undefined,
      ctx,
    );
    // Add grandchild under A1
    await tools.add.execute(
      "c3",
      { items: [{ name: "A1a", details: "" }], parentId: "1.1" },
      undefined,
      undefined,
      ctx,
    );

    // Insert before B (id "2") — A's subtree stays intact, New takes id 2
    const result = await tools.add.execute(
      "c4",
      { items: [{ name: "New", details: "" }], beforeId: "2" },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    // Expected order: A(1), A1(1.1), A1a(1.1.1), A2(1.2), New(2), B(3), C(4)
    expect(items[0].id).toBe("1");
    expect(items[1].id).toBe("1.1");
    expect(items[2].id).toBe("1.1.1");
    expect(items[3].id).toBe("1.2");
    expect(items[4].name).toBe("New");
    expect(items[4].id).toBe("2");
    expect(items[5].id).toBe("3"); // B renumbered from 2
    expect(items[6].id).toBe("4"); // C renumbered from 3
  });

  test("inserts multiple items before target and renumbers subsequent items", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "A", details: "" },
          { name: "B", details: "" },
          { name: "C", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Insert 3 items before B (id "2") — B and C should shift by 3
    const result = await tools.add.execute(
      "c2",
      {
        items: [
          { name: "X", details: "" },
          { name: "Y", details: "" },
          { name: "Z", details: "" },
        ],
        beforeId: "2",
      },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    expect(items).toHaveLength(6);
    // A stays
    expect(items[0].id).toBe("1");
    expect(items[0].name).toBe("A");
    // X, Y, Z inserted as 2, 3, 4
    expect(items[1].id).toBe("2");
    expect(items[1].name).toBe("X");
    expect(items[2].id).toBe("3");
    expect(items[2].name).toBe("Y");
    expect(items[3].id).toBe("4");
    expect(items[3].name).toBe("Z");
    // B renumbered from 2 → 5
    expect(items[4].id).toBe("5");
    expect(items[4].name).toBe("B");
    // C renumbered from 3 → 6
    expect(items[5].id).toBe("6");
    expect(items[5].name).toBe("C");
  });

  test("inserts before first item renumbers all subsequent items", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "A", details: "" },
          { name: "B", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Insert before first item A (id "1") — A and B shift
    const result = await tools.add.execute(
      "c2",
      { items: [{ name: "New", details: "" }], beforeId: "1" },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    expect(items).toHaveLength(3);
    expect(items[0].id).toBe("1");
    expect(items[0].name).toBe("New");
    expect(items[1].id).toBe("2"); // A shifted
    expect(items[1].name).toBe("A");
    expect(items[2].id).toBe("3"); // B shifted
    expect(items[2].name).toBe("B");
  });

  test("inserts before only item in list", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute("c1", { items: [{ name: "Solo", details: "" }] }, undefined, undefined, ctx);

    // Insert before the single item
    const result = await tools.add.execute(
      "c2",
      { items: [{ name: "New", details: "" }], beforeId: "1" },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("1");
    expect(items[0].name).toBe("New");
    expect(items[1].id).toBe("2");
    expect(items[1].name).toBe("Solo");
  });

  test("inserts before completed item and renumbers", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "A", details: "" },
          { name: "B", details: "" },
          { name: "C", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Complete A (id "1")
    await tools.complete.execute("c2", { id: "1" }, undefined, undefined, ctx);
    // B is now in_progress. Insert before completed A.
    // Under the uniform invariant (first non-terminal = in_progress), inserting
    // New at the front makes New the active item and demotes B.
    const result = await tools.add.execute(
      "c3",
      { items: [{ name: "New", details: "" }], beforeId: "1" },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    expect(items[0].id).toBe("1");
    expect(items[0].name).toBe("New");
    expect(items[0].status).toBe("in_progress");
    expect(items[1].id).toBe("2");
    expect(items[1].name).toBe("A");
    expect(items[1].status).toBe("completed");
    expect(items[2].id).toBe("3");
    expect(items[2].name).toBe("B");
    expect(items[2].status).toBe("pending");
    expect(items[3].id).toBe("4");
    expect(items[3].name).toBe("C");
  });

  test("transfers in_progress to new item when inserting before the in_progress target", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "A", details: "A details" },
          { name: "B", details: "B details" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    // A (id 1) is in_progress, B (id 2) is pending

    // Insert before A (the in_progress item)
    const result = await tools.add.execute(
      "c2",
      { items: [{ name: "New Priority", details: "Must do first" }], beforeId: "1" },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    // New item takes id 1 and becomes in_progress (lowest-numbered non-terminal)
    expect(items[0].id).toBe("1");
    expect(items[0].name).toBe("New Priority");
    expect(items[0].status).toBe("in_progress");
    // A shifted to id 2 and demoted to pending
    expect(items[1].id).toBe("2");
    expect(items[1].name).toBe("A");
    expect(items[1].status).toBe("pending");
    // B shifted to id 3, still pending
    expect(items[2].id).toBe("3");
    expect(items[2].name).toBe("B");
    expect(items[2].status).toBe("pending");
  });

  test("transfers in_progress when inserting multiple items before in_progress target", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "A", details: "" },
          { name: "B", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    const result = await tools.add.execute(
      "c2",
      {
        items: [
          { name: "New 1", details: "" },
          { name: "New 2", details: "" },
        ],
        beforeId: "1",
      },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    // First new item becomes in_progress
    expect(items[0].id).toBe("1");
    expect(items[0].name).toBe("New 1");
    expect(items[0].status).toBe("in_progress");
    // Second new item is pending
    expect(items[1].id).toBe("2");
    expect(items[1].name).toBe("New 2");
    expect(items[1].status).toBe("pending");
    // A shifted to 3, pending
    expect(items[2].id).toBe("3");
    expect(items[2].name).toBe("A");
    expect(items[2].status).toBe("pending");
  });
});

describe("add with beforeId (nested)", () => {
  test("inserts as sibling before nested item, renumbers target", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "Parent", details: "" },
          { name: "Next", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    await tools.add.execute(
      "c2",
      { items: [{ name: "Child1", details: "" }], parentId: "1" },
      undefined,
      undefined,
      ctx,
    );

    // Insert before Child1 (1.1) — Sibling takes 1.1, Child1 shifts to 1.2
    const result = await tools.add.execute(
      "c3",
      { items: [{ name: "Sibling", details: "" }], beforeId: "1.1" },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    expect(items[1].id).toBe("1.1"); // new sibling, takes Child1's slot
    expect(items[1].name).toBe("Sibling");
    expect(items[1].parentId).toBe("1"); // same parent
    expect(items[2].id).toBe("1.2"); // Child1 shifted
    expect(items[2].name).toBe("Child1");
    expect(items[3].id).toBe("2"); // top-level unchanged
  });

  test("inserts before nested target cascading to its grandchildren", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "Parent", details: "" },
          { name: "Next", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    // Decompose Parent → Child (1.1)
    await tools.add.execute(
      "c2",
      { items: [{ name: "Child", details: "" }], parentId: "1" },
      undefined,
      undefined,
      ctx,
    );
    // Add grandchild under Child (1.1.1)
    await tools.add.execute(
      "c3",
      { items: [{ name: "Grandchild", details: "" }], parentId: "1.1" },
      undefined,
      undefined,
      ctx,
    );

    // Insert before Child (1.1) — Sibling takes 1.1, Child → 1.2, Grandchild → 1.2.1
    const result = await tools.add.execute(
      "c4",
      { items: [{ name: "Sibling", details: "" }], beforeId: "1.1" },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    // Expected order: Parent(1), Sibling(1.1), Child(1.2), Grandchild(1.2.1), Next(2)
    expect(items[0].id).toBe("1");
    expect(items[1].id).toBe("1.1");
    expect(items[1].name).toBe("Sibling");
    expect(items[2].id).toBe("1.2");
    expect(items[2].name).toBe("Child");
    expect(items[3].id).toBe("1.2.1");
    expect(items[3].name).toBe("Grandchild");
    expect(items[4].id).toBe("2");
    expect(items[4].name).toBe("Next");
  });

  test("inserts sibling before decomposed nested item with children", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "Parent", details: "" },
          { name: "Next", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    // Decompose Parent → Child1 (1.1), Child2 (1.2)
    await tools.add.execute(
      "c2",
      {
        items: [
          { name: "Child1", details: "" },
          { name: "Child2", details: "" },
        ],
        parentId: "1",
      },
      undefined,
      undefined,
      ctx,
    );
    // Decompose Child1 → Grandchild (1.1.1)
    await tools.add.execute(
      "c3",
      { items: [{ name: "Grandchild", details: "" }], parentId: "1.1" },
      undefined,
      undefined,
      ctx,
    );

    // Verify Child1 is decomposed
    const listBefore = await tools.list.execute("c4", {}, undefined, undefined, ctx);
    const child1 = listBefore.details.items.find((i: { id: string; status?: string; name?: string }) => i.id === "1.1");
    if (!child1) throw new Error("item not found");
    expect(child1.status).toBe("decomposed");

    // Insert before decomposed Child1 — NewSibling takes 1.1, Child1 → 1.2 (+ Grandchild → 1.2.1), Child2 → 1.3
    const result = await tools.add.execute(
      "c5",
      { items: [{ name: "NewSibling", details: "" }], beforeId: "1.1" },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    const newSibling = items.find((i: { id: string; status?: string; name?: string }) => i.name === "NewSibling");
    if (!newSibling) throw new Error("item not found");
    expect(newSibling.parentId).toBe("1");
    expect(newSibling.id).toBe("1.1");
    // NewSibling appears before Child1 (now 1.2) in flat order
    const newIdx = items.findIndex((i: { id: string; status?: string; name?: string }) => i.name === "NewSibling");
    const child1Idx = items.findIndex((i: { id: string; status?: string; name?: string }) => i.name === "Child1");
    expect(newIdx).toBeLessThan(child1Idx);
  });

  test("inserts sibling before first child of parent", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "Parent", details: "" },
          { name: "Next", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    // Decompose Parent → Child1, Child2, Child3
    await tools.add.execute(
      "c2",
      {
        items: [
          { name: "Child1", details: "" },
          { name: "Child2", details: "" },
          { name: "Child3", details: "" },
        ],
        parentId: "1",
      },
      undefined,
      undefined,
      ctx,
    );

    // Insert before first child (1.1)
    const result = await tools.add.execute(
      "c3",
      { items: [{ name: "NewSibling", details: "" }], beforeId: "1.1" },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    // NewSibling takes 1.1, all existing children shift by 1
    const newSibling = items.find((i: { id: string; status?: string; name?: string }) => i.name === "NewSibling");
    if (!newSibling) throw new Error("item not found");
    expect(newSibling.parentId).toBe("1");
    expect(newSibling.id).toBe("1.1");
    expect(
      (items.find((i: { id: string; status?: string; name?: string }) => i.name === "Child1") as { id: string }).id,
    ).toBe("1.2");
    expect(
      (items.find((i: { id: string; status?: string; name?: string }) => i.name === "Child2") as { id: string }).id,
    ).toBe("1.3");
    expect(
      (items.find((i: { id: string; status?: string; name?: string }) => i.name === "Child3") as { id: string }).id,
    ).toBe("1.4");

    // Flat order: Parent, NewSibling, Child1, Child2, Child3, Next
    const newIdx = items.findIndex((i: { id: string; status?: string; name?: string }) => i.name === "NewSibling");
    const parentIdx = items.findIndex((i: { id: string; status?: string; name?: string }) => i.id === "1");
    const child1Idx = items.findIndex((i: { id: string; status?: string; name?: string }) => i.name === "Child1");
    const nextIdx = items.findIndex((i: { id: string; status?: string; name?: string }) => i.id === "2");
    expect(newIdx).toBeGreaterThan(parentIdx);
    expect(newIdx).toBeLessThan(child1Idx);
    expect(child1Idx).toBeLessThan(nextIdx);
  });

  test("transfers in_progress to new sibling when inserting before in_progress nested item", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "Parent", details: "" },
          { name: "Next", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    await tools.add.execute(
      "c2",
      { items: [{ name: "Child1", details: "" }], parentId: "1" },
      undefined,
      undefined,
      ctx,
    );
    // Parent(1, decomposed), Child1(1.1, in_progress), Next(2, pending)

    // Insert before Child1 (the in_progress nested item)
    const result = await tools.add.execute(
      "c3",
      { items: [{ name: "New Sibling", details: "" }], beforeId: "1.1" },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    // New Sibling takes id 1.1 and becomes in_progress
    expect(items[1].id).toBe("1.1");
    expect(items[1].name).toBe("New Sibling");
    expect(items[1].status).toBe("in_progress");
    // Child1 shifted to 1.2, demoted to pending
    expect(items[2].id).toBe("1.2");
    expect(items[2].name).toBe("Child1");
    expect(items[2].status).toBe("pending");
  });

  test("does NOT transfer in_progress when an earlier top-level item is in_progress", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "A", details: "" },
          { name: "Parent", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    // A(1, in_progress), Parent(2, pending)

    // Add child to Parent
    await tools.add.execute(
      "c2",
      { items: [{ name: "Child", details: "" }], parentId: "2" },
      undefined,
      undefined,
      ctx,
    );
    // A(1, in_progress), Parent(2, decomposed), Child(2.1, pending)

    // Insert before Child — should NOT become in_progress because A(1) is in_progress
    const result = await tools.add.execute(
      "c3",
      { items: [{ name: "New Sibling", details: "" }], beforeId: "2.1" },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;

    // A still in_progress
    expect(items[0].status).toBe("in_progress");
    // New Sibling is pending (A is in_progress before it)
    expect(items[2].id).toBe("2.1");
    expect(items[2].name).toBe("New Sibling");
    expect(items[2].status).toBe("pending");
    // Child shifted to 2.2, pending
    expect(items[3].id).toBe("2.2");
    expect(items[3].name).toBe("Child");
    expect(items[3].status).toBe("pending");
  });
});

describe("todo tool — complete action", () => {
  test("marks item completed and promotes next pending", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "First", details: "First details" },
          { name: "Second", details: "Second details" },
          { name: "Third", details: "Third details" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    const result = await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);

    // Should show next item with ▶ format
    const text = (result.content[0] as TextContent).text;
    expect(text).toContain("In progress: ▶ 2: Second");
    expect(text).toContain("Second details");

    const listResult = await tools.list.execute("call-3", {}, undefined, undefined, ctx);
    const items = listResult.details.items;
    expect(items[0].status).toBe("completed");
    expect(items[1].status).toBe("in_progress");
    expect(items[2].status).toBe("pending");
  });

  test("sequential complete promotes next pending", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
          { name: "C", details: "c" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Complete A then B sequentially
    await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);
    const result = await tools.complete.execute("call-3", { id: "2" }, undefined, undefined, ctx);

    // Should show item "C" as next in_progress
    expect((result.content[0] as TextContent).text).toContain("In progress: ▶ 3: C");

    const listResult = await tools.list.execute("call-4", {}, undefined, undefined, ctx);
    expect(listResult.details.items[0].status).toBe("completed");
    expect(listResult.details.items[1].status).toBe("completed");
    expect(listResult.details.items[2].status).toBe("in_progress");
  });

  test("all done clears state with summary", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      {
        items: [{ name: "Only", details: "Only details" }],
      },
      undefined,
      undefined,
      ctx,
    );

    const result = await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);

    const text = (result.content[0] as TextContent).text;
    expect(text).toContain("All todos done");
    expect(text).toContain("✅ 1 Only");
    expect(text).toContain("List cleared");

    // State should be cleared
    const listResult = await tools.list.execute("call-3", {}, undefined, undefined, ctx);
    expect(listResult.details.items).toEqual([]);
  });

  test("all done with decomposed items shows 📁 icon", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "Parent", details: "p" },
          { name: "Other", details: "o" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Decompose "Parent" by adding children
    await tools.add.execute("call-2", { items: [{ name: "Child" }], parentId: "1" }, undefined, undefined, ctx);

    // Complete the child
    await tools.complete.execute("call-3", { id: "1.1" }, undefined, undefined, ctx);

    // Complete "Other" — should trigger all-done
    const result = await tools.complete.execute("call-4", { id: "2" }, undefined, undefined, ctx);

    const text = (result.content[0] as TextContent).text;
    expect(text).toContain("All todos done");
    expect(text).toContain("📁 1 Parent");
    expect(text).toContain("✅ 2 Other");
  });

  test("all done triggered by completing in_progress when only decomposed items remain", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "Parent", details: "p" },
          { name: "Task", details: "t" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Decompose "Parent" by adding child, then complete the child
    await tools.add.execute("call-2", { items: [{ name: "Child" }], parentId: "1" }, undefined, undefined, ctx);
    await tools.complete.execute("call-3", { id: "1.1" }, undefined, undefined, ctx);

    // "Task" ("1") is in_progress. Complete it — only decomposed "Parent" remains.
    // Should trigger all-done clearing.
    const result = await tools.complete.execute("call-4", { id: "2" }, undefined, undefined, ctx);

    const text = (result.content[0] as TextContent).text;
    expect(text).toContain("All todos done");
    expect(text).toContain("📁 1 Parent");
    expect(text).toContain("✅ 2 Task");
  });

  test("complete non-in-progress item does not change current in_progress", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "Current", details: "Working on this" },
          { name: "Later", details: "Do later" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Complete item "1" (not the current in_progress "1")
    const _result = await tools.complete.execute("call-2", { id: "2" }, undefined, undefined, ctx);

    // Item "1" should still be in_progress, no promotion
    const listResult = await tools.list.execute("call-3", {}, undefined, undefined, ctx);
    const items = listResult.details.items;
    expect(items[0].status).toBe("in_progress"); // unchanged
    expect(items[1].status).toBe("completed"); // directly completed
  });

  test("completing already-completed item is a no-op", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
          { name: "C", details: "c" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Complete "B" (not current in_progress)
    await tools.complete.execute("call-2", { id: "2" }, undefined, undefined, ctx);

    // Complete "C" (also not current in_progress)
    const _result = await tools.complete.execute("call-3", { id: "3" }, undefined, undefined, ctx);

    const listResult = await tools.list.execute("call-4", {}, undefined, undefined, ctx);
    const items = listResult.details.items;
    expect(items[0].status).toBe("in_progress"); // A still active
    expect(items[1].status).toBe("completed"); // B completed
    expect(items[2].status).toBe("completed"); // C completed
  });

  test("rejects invalid ID with error message", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      {
        items: [{ name: "A", details: "a" }],
      },
      undefined,
      undefined,
      ctx,
    );

    const result = await tools.complete.execute("call-2", { id: "100" }, undefined, undefined, ctx);

    const text = (result.content[0] as TextContent).text;
    expect(text).toContain("Error");
    expect(text).toContain("invalid ID");
    expect(text).toContain("100");
    expect(result.details.error).toBe(true);
  });

  test("rejects invalid ID on empty state", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    const result = await tools.complete.execute("call-1", { id: "1" }, undefined, undefined, ctx);

    expect((result.content[0] as TextContent).text).toContain("Error");
    expect((result.content[0] as TextContent).text).toContain("invalid ID");
    expect(result.details.error).toBe(true);
  });

  test("rejects invalid ID without modifying state", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

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

    // Invalid ID — should not modify state
    const result = await tools.complete.execute("call-2", { id: "100" }, undefined, undefined, ctx);

    expect((result.content[0] as TextContent).text).toContain("Error");
    expect((result.content[0] as TextContent).text).toContain("invalid ID");
    expect((result.content[0] as TextContent).text).toContain("100");
    expect(result.details.error).toBe(true);

    // Item "1" should NOT have been completed
    const listResult = await tools.list.execute("call-3", {}, undefined, undefined, ctx);
    expect(listResult.details.items[0].status).toBe("in_progress");
  });

  test("completing same item twice is idempotent", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
          { name: "C", details: "c" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Complete item "1" (in_progress)
    const result = await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);

    // Should succeed — item 0 completed, B promoted to in_progress
    expect((result.content[0] as TextContent).text).toContain("In progress: ▶ 2: B");
    const items = result.details.items;
    expect(
      (items.find((i: { id: string; status?: string; name?: string }) => i.id === "1") as { status: string }).status,
    ).toBe("completed");
    expect(
      (items.find((i: { id: string; status?: string; name?: string }) => i.id === "2") as { status: string }).status,
    ).toBe("in_progress");
    expect(
      (items.find((i: { id: string; status?: string; name?: string }) => i.id === "3") as { status: string }).status,
    ).toBe("pending");
  });

  test("completing children of decomposed item advances through subtree", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.add.execute("call-1", { items: [{ name: "Parent" }, { name: "Next" }] }, undefined, undefined, ctx);

    // Decompose "Parent"
    await tools.add.execute(
      "call-2",
      { items: [{ name: "Child1" }, { name: "Child2" }], parentId: "1" },
      undefined,
      undefined,
      ctx,
    );

    // Complete child "1.1" → should auto-advance to "1.2"
    const result1 = await tools.complete.execute("call-3", { id: "1.1" }, undefined, undefined, ctx);
    expect((result1.content[0] as TextContent).text).toContain("In progress: ▶ 1.2: Child2");

    // Complete child "1.2" → should auto-advance to "2" (next top-level)
    const result2 = await tools.complete.execute("call-4", { id: "1.2" }, undefined, undefined, ctx);
    expect((result2.content[0] as TextContent).text).toContain("In progress: ▶ 2: Next");
  });

  test("completing decomposed parent is a no-op regardless of children state", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.add.execute("call-1", { items: [{ name: "Parent" }, { name: "Next" }] }, undefined, undefined, ctx);

    // Decompose "Parent" by adding children
    await tools.add.execute(
      "call-2",
      { items: [{ name: "Child1" }, { name: "Child2" }], parentId: "1" },
      undefined,
      undefined,
      ctx,
    );

    // Complete one child — other remains pending
    await tools.complete.execute("call-3", { id: "1.1" }, undefined, undefined, ctx);

    // Complete decomposed parent — should be a no-op (decomposed is already terminal)
    const result = await tools.complete.execute("call-4", { id: "1" }, undefined, undefined, ctx);
    expect((result.content[0] as TextContent).text).not.toContain("Error");
    expect((result.content[0] as TextContent).text).toContain("✅ 1");

    // Parent stays decomposed
    const parent = result.details.items.find((i: { id: string; status?: string; name?: string }) => i.id === "1");
    if (!parent) throw new Error("item not found");
    expect(parent.status).toBe("decomposed");

    // Complete remaining child, then parent should still be decomposed
    const result2 = await tools.complete.execute("call-5", { id: "1.2" }, undefined, undefined, ctx);
    const parent2 = result2.details.items.find((i: { id: string; status?: string; name?: string }) => i.id === "1");
    if (!parent2) throw new Error("item not found");
    expect(parent2.status).toBe("decomposed");
  });

  test("completing decomposed parent with decomposed children (nested decomposition)", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.add.execute("call-1", { items: [{ name: "Parent" }, { name: "Next" }] }, undefined, undefined, ctx);

    // Decompose parent by adding children
    await tools.add.execute(
      "call-2",
      { items: [{ name: "Child1" }, { name: "Child2" }], parentId: "1" },
      undefined,
      undefined,
      ctx,
    );

    // Decompose Child1 by adding grandchildren
    await tools.add.execute("call-3", { items: [{ name: "Grandchild1" }], parentId: "1.1" }, undefined, undefined, ctx);

    // Verify structure: Parent(decomposed), Child1(decomposed), Grandchild1(in_progress), Child2(pending)
    // Note: grandchild 1.1.1 is inserted right after 1.1 in flat list order,
    // so autoAdvance promotes 1.1.1 (first pending) before 1.2.
    const listBefore = await tools.list.execute("call-4", {}, undefined, undefined, ctx);
    const itemsBefore = listBefore.details.items;
    expect(
      (itemsBefore.find((i: { id: string; status?: string; name?: string }) => i.id === "1") as { status: string })
        .status,
    ).toBe("decomposed");
    expect(
      (itemsBefore.find((i: { id: string; status?: string; name?: string }) => i.id === "1.1") as { status: string })
        .status,
    ).toBe("decomposed");
    expect(
      (itemsBefore.find((i: { id: string; status?: string; name?: string }) => i.id === "1.1.1") as { status: string })
        .status,
    ).toBe("in_progress");
    expect(
      (itemsBefore.find((i: { id: string; status?: string; name?: string }) => i.id === "1.2") as { status: string })
        .status,
    ).toBe("pending");

    // Complete all descendants + parent sequentially
    await tools.complete.execute("call-5", { id: "1.1.1" }, undefined, undefined, ctx);
    await tools.complete.execute("call-6", { id: "1.1" }, undefined, undefined, ctx);
    const promotedResult = await tools.complete.execute("call-7", { id: "1.2" }, undefined, undefined, ctx);
    const result = await tools.complete.execute("call-8", { id: "1" }, undefined, undefined, ctx);
    const items = result.details.items;

    // Parent stays decomposed, Child1 stays decomposed, others completed
    expect(
      (items.find((i: { id: string; status?: string; name?: string }) => i.id === "1") as { status: string }).status,
    ).toBe("decomposed");
    expect(
      (items.find((i: { id: string; status?: string; name?: string }) => i.id === "1.1") as { status: string }).status,
    ).toBe("decomposed");
    expect(
      (items.find((i: { id: string; status?: string; name?: string }) => i.id === "1.1.1") as { status: string })
        .status,
    ).toBe("completed");
    expect(
      (items.find((i: { id: string; status?: string; name?: string }) => i.id === "1.2") as { status: string }).status,
    ).toBe("completed");

    // Next item (id "2") should be promoted when last child was completed
    expect((promotedResult.content[0] as TextContent).text).toContain("In progress: ▶ 2: Next");
  });

  test("complete parent + ALL children sequentially", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.add.execute("call-1", { items: [{ name: "Parent" }, { name: "Next" }] }, undefined, undefined, ctx);

    // Decompose "Parent" by adding children
    await tools.add.execute(
      "call-2",
      { items: [{ name: "Child1" }, { name: "Child2" }], parentId: "1" },
      undefined,
      undefined,
      ctx,
    );

    // Complete children then parent sequentially
    await tools.complete.execute("call-3", { id: "1.1" }, undefined, undefined, ctx);
    await tools.complete.execute("call-4", { id: "1.2" }, undefined, undefined, ctx);
    const result = await tools.complete.execute("call-5", { id: "1" }, undefined, undefined, ctx);
    expect((result.content[0] as TextContent).text).not.toContain("Error");

    const items = result.details.items;
    const parent = items.find((i: { id: string; status?: string; name?: string }) => i.id === "1");
    if (!parent) throw new Error("item not found");
    const child1 = items.find((i: { id: string; status?: string; name?: string }) => i.id === "1.1");
    if (!child1) throw new Error("item not found");
    const child2 = items.find((i: { id: string; status?: string; name?: string }) => i.id === "1.2");
    if (!child2) throw new Error("item not found");
    const next = items.find((i: { id: string; status?: string; name?: string }) => i.id === "2");
    if (!next) throw new Error("item not found");

    // Parent stays decomposed (complete skips decomposed items)
    expect(parent.status).toBe("decomposed");
    // Children are completed
    expect(child1.status).toBe("completed");
    expect(child2.status).toBe("completed");
    // Next item is promoted to in_progress
    expect(next.status).toBe("in_progress");
  });

  test("completing decomposed parent is no-op even with pending children", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.add.execute("call-1", { items: [{ name: "Parent" }, { name: "Next" }] }, undefined, undefined, ctx);

    // Decompose "Parent" by adding children
    await tools.add.execute(
      "call-2",
      { items: [{ name: "Child1" }, { name: "Child2" }], parentId: "1" },
      undefined,
      undefined,
      ctx,
    );

    // Complete decomposed parent while children are still pending — no-op, no error
    const result = await tools.complete.execute("call-3", { id: "1" }, undefined, undefined, ctx);

    expect((result.content[0] as TextContent).text).not.toContain("Error");
    expect((result.content[0] as TextContent).text).toContain("✅ 1");

    // Parent should still be decomposed
    const parent = result.details.items.find((i: { id: string; status?: string; name?: string }) => i.id === "1");
    if (!parent) throw new Error("item not found");
    expect(parent.status).toBe("decomposed");
  });

  test("completing decomposed parent skips it — stays decomposed", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    // Init: Parent, Next
    await tools.add.execute(
      "c1",
      {
        items: [
          { name: "Parent", details: "" },
          { name: "Next", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    // Decompose parent: adds Child (1.1)
    await tools.add.execute(
      "c2",
      { items: [{ name: "Child", details: "" }], parentId: "1" },
      undefined,
      undefined,
      ctx,
    );
    // Complete the child first
    await tools.complete.execute("c3", { id: "1.1" }, undefined, undefined, ctx);

    // Now complete the decomposed parent — should be skipped since decomposed is already terminal
    const result = await tools.complete.execute("c4", { id: "1" }, undefined, undefined, ctx);
    expect((result.content[0] as TextContent).text).not.toContain("Error");

    // Verify parent stays decomposed (not changed to completed)
    const list = await tools.list.execute("c5", {}, undefined, undefined, ctx);
    const parent = list.details.items.find((i: { id: string; status?: string; name?: string }) => i.id === "1");
    if (!parent) throw new Error("item not found");
    expect(parent.status).toBe("decomposed");
  });

  test("complete with already-completed item — no state change, no error", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "c1",
      {
        items: [
          { name: "X", details: "" },
          { name: "Y", details: "" },
          { name: "Z", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    await tools.complete.execute("c2", { id: "1" }, undefined, undefined, ctx);
    await tools.complete.execute("c3", { id: "2" }, undefined, undefined, ctx);
    // X and Y are completed, Z is in_progress

    // Complete X again — already completed
    const result = await tools.complete.execute("c4", { id: "1" }, undefined, undefined, ctx);
    expect((result.content[0] as TextContent).text).not.toContain("Error");

    // Verify no state change — Z is still in_progress
    const list = await tools.list.execute("c5", {}, undefined, undefined, ctx);
    const items = list.details.items;
    expect(items[0].status).toBe("completed"); // X
    expect(items[1].status).toBe("completed"); // Y
    expect(items[2].status).toBe("in_progress"); // Z unchanged
  });
});
