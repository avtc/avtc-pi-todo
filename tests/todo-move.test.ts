import type { TextContent } from "@earendil-works/pi-ai";
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { describe, expect, test } from "vitest";
import type { TodoItem } from "../src/types.js";
import { NO_SETUP_TOOL_OPTIONS, setupTool } from "./setup-tool.js";

/**
 * Seeds a 3-item plan: A(1) in_progress, B(2) pending, C(3) pending.
 */
async function seedABC() {
  const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
  await tools.init.execute(
    "seed",
    {
      items: [
        { name: "A", details: "A details" },
        { name: "B", details: "B details" },
        { name: "C", details: "C details" },
      ],
    },
    undefined,
    undefined,
    ctx,
  );
  return { tools, ctx };
}

describe("todo_move — reorder with beforeId (top-level)", () => {
  test("moves a later item before an earlier one and renumbers", async () => {
    const { tools, ctx } = await seedABC();
    // Move C (3) before A (1). C should become id 1 and in_progress (now first).
    const result = await tools.move.execute("m1", { ids: ["3"], beforeId: "1" }, undefined, undefined, ctx);
    const items = result.details.items;

    expect(items.map((i: TodoItem) => [i.id, i.name])).toEqual([
      ["1", "C"],
      ["2", "A"],
      ["3", "B"],
    ]);
    // C moved to the front → it is the new active item
    expect(items[0].status).toBe("in_progress");
    expect(items[1].status).toBe("pending");
    expect(items[2].status).toBe("pending");
    expect(result.details.movedItems).toEqual(["1"]); // C's new id
  });

  test("moving a pending item before the in_progress item re-elects it (unblock case)", async () => {
    const { tools, ctx } = await seedABC();
    // A is in_progress. Move B (2) before A (1) → B becomes the active item.
    await tools.move.execute("m1", { ids: ["2"], beforeId: "1" }, undefined, undefined, ctx);
    const list = await tools.list.execute("l", {}, undefined, undefined, ctx);
    const items = list.details.items;

    expect(items.map((i: TodoItem) => [i.id, i.name, i.status])).toEqual([
      ["1", "B", "in_progress"],
      ["2", "A", "pending"],
      ["3", "C", "pending"],
    ]);
  });

  test("moving the in_progress item itself keeps it active when it stays first (normalizeInProgress no-op)", async () => {
    const { tools, ctx } = await seedABC();
    // A(1) is in_progress. Move A itself before B(2) — A re-inserts at the front
    // (still first), so normalizeInProgress must leave it in_progress (no spurious
    // demote+re-promote, no dropped active state).
    const result = await tools.move.execute("m1", { ids: ["1"], beforeId: "2" }, undefined, undefined, ctx);
    const items = result.details.items;

    expect(items.map((i: TodoItem) => [i.id, i.name, i.status])).toEqual([
      ["1", "A", "in_progress"],
      ["2", "B", "pending"],
      ["3", "C", "pending"],
    ]);
  });

  test("moving an item to a later position keeps the earlier active item", async () => {
    const { tools, ctx } = await seedABC();
    // A(1) in_progress. Move B (2) before C (3) — reordering later items only.
    await tools.move.execute("m1", { ids: ["2"], beforeId: "3" }, undefined, undefined, ctx);
    const list = await tools.list.execute("l", {}, undefined, undefined, ctx);
    const items = list.details.items;

    expect(items.map((i: TodoItem) => [i.id, i.name, i.status])).toEqual([
      ["1", "A", "in_progress"],
      ["2", "B", "pending"],
      ["3", "C", "pending"],
    ]);
    // ids are stable because relative order is unchanged
  });

  test("moving the active item later re-elects the new first item", async () => {
    const { tools, ctx } = await seedABC();
    // A(1) in_progress. Move A before C (3) — A moves down, B becomes first.
    await tools.move.execute("m1", { ids: ["1"], beforeId: "3" }, undefined, undefined, ctx);
    const list = await tools.list.execute("l", {}, undefined, undefined, ctx);
    const items = list.details.items;

    // B is now first → it becomes the active item; A is demoted (invariant:
    // first non-terminal = in_progress after a move).
    expect(items.map((i: TodoItem) => [i.id, i.name, i.status])).toEqual([
      ["1", "B", "in_progress"],
      ["2", "A", "pending"],
      ["3", "C", "pending"],
    ]);
  });

  test("appends to top-level when neither beforeId nor parentId given", async () => {
    const { tools, ctx } = await seedABC();
    // Move A (1, in_progress) to the end.
    await tools.move.execute("m1", { ids: ["1"] }, undefined, undefined, ctx);
    const list = await tools.list.execute("l", {}, undefined, undefined, ctx);
    const items = list.details.items;

    expect(items.map((i: TodoItem) => [i.id, i.name, i.status])).toEqual([
      ["1", "B", "in_progress"], // B is now first → promoted
      ["2", "C", "pending"],
      ["3", "A", "pending"], // A demoted since it's no longer first
    ]);
  });

  test("moves multiple items as a block in input-array order", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute(
      "s",
      {
        items: [
          { name: "A", details: "" },
          { name: "B", details: "" },
          { name: "C", details: "" },
          { name: "D", details: "" },
          { name: "E", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    // Move D(4) and B(2) before A(1), in that order → D then B at the front.
    const result = await tools.move.execute("m1", { ids: ["4", "2"], beforeId: "1" }, undefined, undefined, ctx);
    const list = await tools.list.execute("l", {}, undefined, undefined, ctx);
    const items = list.details.items;

    expect(items.map((i: TodoItem) => [i.id, i.name])).toEqual([
      ["1", "D"],
      ["2", "B"],
      ["3", "A"],
      ["4", "C"],
      ["5", "E"],
    ]);
    // First item (D) becomes active
    expect(items[0].status).toBe("in_progress");
    // movedItems reports the originally-selected tops' NEW ids, in input order.
    expect(result.details.movedItems).toEqual(["1", "2"]); // D→1, B→2
  });
});

describe("todo_move — reparent with parentId", () => {
  test("moves items under a parent, inserted after existing children", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute(
      "s",
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
    // Decompose A(1) with child 1.1
    await tools.add.execute("a1", { items: [{ name: "A1", details: "" }], parentId: "1" }, undefined, undefined, ctx);
    // Now move B(2) under A(1) → becomes 1.2 (after existing 1.1)
    const result = await tools.move.execute("m1", { ids: ["2"], parentId: "1" }, undefined, undefined, ctx);
    const items = result.details.items;

    // A decomposed, A1 = 1.1, B reparented as 1.2
    expect(items.map((i: TodoItem) => [i.id, i.name, i.parentId])).toEqual([
      ["1", "A", undefined],
      ["1.1", "A1", "1"],
      ["1.2", "B", "1"],
      ["2", "C", undefined], // C renumbered 3 → 2 (B left the top level)
    ]);
    expect(items.find((i: TodoItem) => i.name === "A")?.status).toBe("decomposed");
    expect(result.details.movedItems).toEqual(["1.2"]);
  });

  test("reparenting a top-level item into a decomposed parent with multiple children appends after last child", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute(
      "s",
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
    // A(1) decomposed with 1.1, 1.2
    await tools.add.execute("a1", { items: [{ name: "A1", details: "" }], parentId: "1" }, undefined, undefined, ctx);
    await tools.add.execute("a2", { items: [{ name: "A2", details: "" }], parentId: "1" }, undefined, undefined, ctx);
    // Move C(3) under A(1) → must become 1.3 (after 1.1, 1.2)
    const result = await tools.move.execute("m1", { ids: ["3"], parentId: "1" }, undefined, undefined, ctx);
    const items = result.details.items;

    expect(items.map((i: TodoItem) => [i.id, i.name])).toEqual([
      ["1", "A"],
      ["1.1", "A1"],
      ["1.2", "A2"],
      ["1.3", "C"], // appended after last existing child
      ["2", "B"],
      ["3", "D"], // renumbered: B=2, D=3
    ]);
    expect(result.details.movedItems).toEqual(["1.3"]);
  });

  test("promotes a child to top-level (reparent out)", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute(
      "s",
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
    await tools.add.execute("a1", { items: [{ name: "A1", details: "" }], parentId: "1" }, undefined, undefined, ctx);
    // A1 (1.1) is in_progress (auto-promoted as first child). Move it to top-level (append).
    await tools.move.execute("m1", { ids: ["1.1"] }, undefined, undefined, ctx);
    const list = await tools.list.execute("l", {}, undefined, undefined, ctx);
    const items = list.details.items;

    // A reverted to pending (childless folder) and, being first, becomes active;
    // A1 is appended at top-level as id 3 and demoted.
    expect(items.map((i: TodoItem) => [i.id, i.name, i.parentId, i.status])).toEqual([
      ["1", "A", undefined, "in_progress"],
      ["2", "B", undefined, "pending"],
      ["3", "A1", undefined, "pending"],
    ]);
  });

  test("auto-reverts a decomposed parent to pending when its last child moves out", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute(
      "s",
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
    await tools.add.execute("a1", { items: [{ name: "A1", details: "" }], parentId: "1" }, undefined, undefined, ctx);
    // A is decomposed (has only child A1). Move A1 out → A reverts to pending,
    // and as the first non-terminal item it becomes the active item.
    await tools.move.execute("m1", { ids: ["1.1"] }, undefined, undefined, ctx);
    const list = await tools.list.execute("l", {}, undefined, undefined, ctx);
    const items = list.details.items;

    const a = items.find((i: TodoItem) => i.name === "A");
    expect(a?.status).toBe("in_progress");
    expect(a?.id).toBe("1");
    expect(a?.parentId).toBeUndefined();
  });

  test("moving under an in_progress parent decomposes it", async () => {
    const { tools, ctx } = await seedABC(); // A(1) in_progress
    // Move B(2) under A(1) — A should become decomposed, then B (1.1) promoted.
    const result = await tools.move.execute("m1", { ids: ["2"], parentId: "1" }, undefined, undefined, ctx);
    const items = result.details.items;

    expect(items.find((i: TodoItem) => i.name === "A")?.status).toBe("decomposed");
    // First non-terminal is now B (1.1) under A
    expect(items.find((i: TodoItem) => i.name === "B")?.status).toBe("in_progress");
  });
});

describe("todo_move — subtree moves", () => {
  test("moving a parent brings its whole subtree (renumbered)", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute(
      "s",
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
    // A(1) decomposed: 1.1, 1.1.1 (grandchild)
    await tools.add.execute("a1", { items: [{ name: "A1", details: "" }], parentId: "1" }, undefined, undefined, ctx);
    await tools.add.execute("g", { items: [{ name: "GC", details: "" }], parentId: "1.1" }, undefined, undefined, ctx);
    // Move A (with subtree) before C (3).
    const result = await tools.move.execute("m1", { ids: ["1"], beforeId: "3" }, undefined, undefined, ctx);
    const items = result.details.items;

    expect(items.map((i: TodoItem) => [i.id, i.name, i.parentId])).toEqual([
      ["1", "B", undefined],
      ["2", "A", undefined], // A subtree moved before C, renumbered
      ["2.1", "A1", "2"],
      ["2.1.1", "GC", "2.1"],
      ["3", "C", undefined],
    ]);
  });

  test("reparenting a subtree changes depth of all descendants", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute(
      "s",
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
    // B(2) decomposed: 2.1, 2.1.1
    await tools.add.execute("b1", { items: [{ name: "B1", details: "" }], parentId: "2" }, undefined, undefined, ctx);
    await tools.add.execute("g", { items: [{ name: "GC", details: "" }], parentId: "2.1" }, undefined, undefined, ctx);
    // Move B's whole subtree under A(1). A becomes decomposed; B → 1.1, B1 → 1.1.1, GC → 1.1.1.1
    const result = await tools.move.execute("m1", { ids: ["2"], parentId: "1" }, undefined, undefined, ctx);
    const items = result.details.items;

    expect(items.map((i: TodoItem) => [i.id, i.name, i.parentId])).toEqual([
      ["1", "A", undefined],
      ["1.1", "B", "1"],
      ["1.1.1", "B1", "1.1"],
      ["1.1.1.1", "GC", "1.1.1"],
      ["2", "C", undefined],
    ]);
    expect(items.find((i: TodoItem) => i.name === "A")?.status).toBe("decomposed");
  });
});

describe("todo_move — compaction safety", () => {
  test("does NOT trigger compaction (unlike todo_complete)", async () => {
    const { tools, ctx, compactMock } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute(
      "s",
      {
        items: [
          { name: "A", details: "A details" },
          { name: "B", details: "B details" },
          { name: "C", details: "C details" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    await tools.move.execute("m1", { ids: ["3"], beforeId: "1" }, undefined, undefined, ctx);
    expect(compactMock).not.toHaveBeenCalled();
  });
});

describe("todo_move — display text", () => {
  test("displayText shows moved items at new position and ▶ current item", async () => {
    const { tools, ctx } = await seedABC();
    const result = await tools.move.execute("m1", { ids: ["3"], beforeId: "1" }, undefined, undefined, ctx);
    const text = (result.content[0] as TextContent).text;
    // Moved item C is now id 1 and (being first) in_progress, so it shows ▶.
    expect(text).toContain("▶ 1 C");
    // Promoted current item line
    expect(text).toContain("In progress: ▶ 1: C");
    expect(text).toContain("C details");
  });

  test("reordering a folder renders the WHOLE moved subtree (top + descendants)", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute(
      "s",
      {
        items: [
          { name: "Alpha", details: "" },
          { name: "Beta", details: "" },
          { name: "Gamma", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    // Beta as a folder with two children
    await tools.add.execute(
      "a1",
      {
        items: [
          { name: "Beta-1", details: "" },
          { name: "Beta-2", details: "" },
        ],
        parentId: "2",
      },
      undefined,
      undefined,
      ctx,
    );
    // Beta is 2 (folder), children 2.1/2.2; Gamma is 3.
    // Reorder: move Beta (with its subtree) to the end (append → top-level).
    const result = await tools.move.execute("m1", { ids: ["2"] }, undefined, undefined, ctx);
    const text = (result.content[0] as TextContent).text;
    // The moved top (now id 3) AND its descendants (3.1, 3.2) must both render.
    expect(text).toContain("📁 3 Beta");
    expect(text).toContain("3.1 Beta-1");
    expect(text).toContain("3.2 Beta-2");
  });

  test("reparenting a folder renders its descendants nested under the destination parent", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute(
      "s",
      {
        items: [
          { name: "Alpha", details: "" },
          { name: "Beta", details: "" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    // Beta(2) becomes a folder with a child and a grandchild.
    await tools.add.execute(
      "a1",
      { items: [{ name: "Beta-1", details: "" }], parentId: "2" },
      undefined,
      undefined,
      ctx,
    );
    await tools.add.execute(
      "a2",
      { items: [{ name: "Beta-1a", details: "" }], parentId: "2.1" },
      undefined,
      undefined,
      ctx,
    );
    // Reparent the whole Beta subtree under Alpha(1). Alpha's id stays 1; Beta becomes 1.x.
    const result = await tools.move.execute("m1", { ids: ["2"], parentId: "1" }, undefined, undefined, ctx);
    const text = (result.content[0] as TextContent).text;
    // Destination parent header + the moved folder AND its nested descendants.
    expect(text).toContain("📁 1 Alpha");
    expect(text).toContain("1.1 Beta");
    expect(text).toContain("1.1.1 Beta-1");
    expect(text).toContain("1.1.1.1 Beta-1a");
  });

  test("inserts before beforeId when both provided and beforeId is inside parentId", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute(
      "s",
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
    await tools.add.execute("a1", { items: [{ name: "A1", details: "" }], parentId: "1" }, undefined, undefined, ctx);
    await tools.add.execute("a2", { items: [{ name: "A2", details: "" }], parentId: "1" }, undefined, undefined, ctx);
    // Move B to be a child of A, before A1
    const result = await tools.move.execute(
      "m1",
      { ids: ["2"], parentId: "1", beforeId: "1.1" },
      undefined,
      undefined,
      ctx,
    );
    // B should be child of A before A1
    const items = result.details.items;
    expect(items.find((i: TodoItem) => i.name === "B")?.parentId).toBe("1");
    expect(items.find((i: TodoItem) => i.name === "B")?.id).toBe("1.1");
    expect(items.find((i: TodoItem) => i.name === "A1")?.id).toBe("1.2");
  });

  test("errors when both parentId and beforeId provided but beforeId outside parentId", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute(
      "s",
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
    await tools.add.execute("a1", { items: [{ name: "A1", details: "" }], parentId: "1" }, undefined, undefined, ctx);
    // beforeId "2" is not a child of parentId "1"
    const result = await tools.move.execute(
      "m1",
      { ids: ["2"], parentId: "1", beforeId: "2" },
      undefined,
      undefined,
      ctx,
    );
    expect(result.details.error).toBe(true);
    expect((result.content[0] as TextContent).text).toContain("not a direct child");
  });

  test("rejects grandchild beforeId (deeper descendant corrupts tree)", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute("s", { items: [{ name: "A", details: "" }] }, undefined, undefined, ctx);
    await tools.add.execute("a1", { items: [{ name: "A1", details: "" }], parentId: "1" }, undefined, undefined, ctx);
    await tools.add.execute(
      "a2",
      { items: [{ name: "A1a", details: "" }], parentId: "1.1" },
      undefined,
      undefined,
      ctx,
    );
    await tools.add.execute("a3", { items: [{ name: "B", details: "" }] }, undefined, undefined, ctx);
    // beforeId "1.1.1" is a descendant of parentId "1" but NOT a direct child — must reject
    const result = await tools.move.execute(
      "m1",
      { ids: ["2"], parentId: "1", beforeId: "1.1.1" },
      undefined,
      undefined,
      ctx,
    );
    expect(result.details.error).toBe(true);
    expect((result.content[0] as TextContent).text).toContain("not a direct child");
  });

  test("moves multiple items with both parentId and beforeId", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute("s", { items: [{ name: "A", details: "" }] }, undefined, undefined, ctx);
    await tools.add.execute("a1", { items: [{ name: "A1", details: "" }], parentId: "1" }, undefined, undefined, ctx);
    await tools.add.execute("a2", { items: [{ name: "B", details: "" }] }, undefined, undefined, ctx);
    await tools.add.execute("a3", { items: [{ name: "C", details: "" }] }, undefined, undefined, ctx);
    // Move B and C to be children of A, before A1
    const result = await tools.move.execute(
      "m1",
      { ids: ["2", "3"], parentId: "1", beforeId: "1.1" },
      undefined,
      undefined,
      ctx,
    );
    const items = result.details.items;
    expect(items.find((i: TodoItem) => i.name === "B")?.parentId).toBe("1");
    expect(items.find((i: TodoItem) => i.name === "C")?.parentId).toBe("1");
    expect(items.find((i: TodoItem) => i.name === "A1")?.id).toBe("1.3");
  });

  test("rejects beforeId equal to parentId (item is not its own parent)", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute(
      "s",
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
    await tools.add.execute("a1", { items: [{ name: "A1", details: "" }], parentId: "1" }, undefined, undefined, ctx);
    // beforeId "1" equals parentId "1" — not a direct child
    const result = await tools.move.execute(
      "m1",
      { ids: ["2"], parentId: "1", beforeId: "1" },
      undefined,
      undefined,
      ctx,
    );
    expect(result.details.error).toBe(true);
    expect((result.content[0] as TextContent).text).toContain("not a direct child");
  });

  test("rejects moving before an item that is itself being moved (both provided)", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute("s", { items: [{ name: "A", details: "" }] }, undefined, undefined, ctx);
    await tools.add.execute("a1", { items: [{ name: "A1", details: "" }], parentId: "1" }, undefined, undefined, ctx);
    await tools.add.execute("a2", { items: [{ name: "A2", details: "" }], parentId: "1" }, undefined, undefined, ctx);
    await tools.add.execute("a3", { items: [{ name: "B", details: "" }] }, undefined, undefined, ctx);
    // beforeId "1.1" is a direct child of parentId "1" but is itself in the moved
    // set (ids: ["1.1", "2"]) → must reject via the moved-subtree guard.
    const result = await tools.move.execute(
      "m1",
      { ids: ["1.1", "2"], parentId: "1", beforeId: "1.1" },
      undefined,
      undefined,
      ctx,
    );
    expect(result.details.error).toBe(true);
    expect((result.content[0] as TextContent).text).toContain("part of the moved subtree");
  });
});

describe("todo_move — error cases", () => {
  test("rejects empty ids", async () => {
    const { tools, ctx } = await seedABC();
    const result = await tools.move.execute("m1", { ids: [] }, undefined, undefined, ctx);
    expect(result.details.error).toBe(true);
    expect((result.content[0] as TextContent).text).toContain("ids array must not be empty");
  });

  test("rejects unknown id (lists valid ids)", async () => {
    const { tools, ctx } = await seedABC();
    const result = await tools.move.execute("m1", { ids: ["9"] }, undefined, undefined, ctx);
    expect(result.details.error).toBe(true);
    expect((result.content[0] as TextContent).text).toContain("'9' not found");
    expect((result.content[0] as TextContent).text).toContain("1, 2, 3");
  });

  test("rejects duplicate id in selection", async () => {
    const { tools, ctx } = await seedABC();
    const result = await tools.move.execute("m1", { ids: ["2", "2"] }, undefined, undefined, ctx);
    expect(result.details.error).toBe(true);
    expect((result.content[0] as TextContent).text).toContain("duplicate id '2'");
  });

  test("rejects descendant in selection (move parent alone)", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute("s", { items: [{ name: "A", details: "" }] }, undefined, undefined, ctx);
    await tools.add.execute("a1", { items: [{ name: "A1", details: "" }], parentId: "1" }, undefined, undefined, ctx);
    const result = await tools.move.execute("m1", { ids: ["1", "1.1"] }, undefined, undefined, ctx);
    expect(result.details.error).toBe(true);
    expect((result.content[0] as TextContent).text).toContain("descendant");
    expect((result.content[0] as TextContent).text).toContain("move '1' alone");
  });

  test("rejects cycle: moving under own descendant", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute(
      "s",
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
    await tools.add.execute("a1", { items: [{ name: "A1", details: "" }], parentId: "1" }, undefined, undefined, ctx);
    // Move A(1) under A1(1.1) — A1 is A's descendant → cycle
    const result = await tools.move.execute("m1", { ids: ["1"], parentId: "1.1" }, undefined, undefined, ctx);
    expect(result.details.error).toBe(true);
    expect((result.content[0] as TextContent).text).toContain("cycle");
  });

  test("rejects cycle: moving under self", async () => {
    const { tools, ctx } = await seedABC();
    const result = await tools.move.execute("m1", { ids: ["1"], parentId: "1" }, undefined, undefined, ctx);
    expect(result.details.error).toBe(true);
    expect((result.content[0] as TextContent).text).toContain("cycle");
  });

  test("rejects moving before an item in the moved subtree", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute(
      "s",
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
    await tools.add.execute("a1", { items: [{ name: "A1", details: "" }], parentId: "1" }, undefined, undefined, ctx);
    // Move A(1) before A1(1.1) — A1 is in A's subtree
    const result = await tools.move.execute("m1", { ids: ["1"], beforeId: "1.1" }, undefined, undefined, ctx);
    expect(result.details.error).toBe(true);
    expect((result.content[0] as TextContent).text).toContain("part of the moved subtree");
  });

  test("rejects moving before self", async () => {
    const { tools, ctx } = await seedABC();
    const result = await tools.move.execute("m1", { ids: ["2"], beforeId: "2" }, undefined, undefined, ctx);
    expect(result.details.error).toBe(true);
    expect((result.content[0] as TextContent).text).toContain("part of the moved subtree");
  });

  test("rejects unknown parentId", async () => {
    const { tools, ctx } = await seedABC();
    const result = await tools.move.execute("m1", { ids: ["2"], parentId: "9" }, undefined, undefined, ctx);
    expect(result.details.error).toBe(true);
    expect((result.content[0] as TextContent).text).toContain("parentId '9' not found");
  });

  test("rejects moving under a completed parent", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);
    await tools.init.execute(
      "s",
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
    // Complete A (plain top-level item) → A is completed, B promoted.
    await tools.complete.execute("c1", { id: "1" }, undefined, undefined, ctx);
    // Now move C under the completed A — must be rejected.
    const result = await tools.move.execute("m1", { ids: ["3"], parentId: "1" }, undefined, undefined, ctx);
    expect(result.details.error).toBe(true);
    expect((result.content[0] as TextContent).text).toContain("completed item");
  });

  test("rejects unknown beforeId", async () => {
    const { tools, ctx } = await seedABC();
    const result = await tools.move.execute("m1", { ids: ["2"], beforeId: "9" }, undefined, undefined, ctx);
    expect(result.details.error).toBe(true);
    expect((result.content[0] as TextContent).text).toContain("beforeId '9' not found");
  });

  test("does not mutate state on error", async () => {
    const { tools, ctx } = await seedABC();
    await tools.move.execute("m1", { ids: ["9"] }, undefined, undefined, ctx);
    const list = await tools.list.execute("l", {}, undefined, undefined, ctx);
    expect(list.details.items.map((i: TodoItem) => i.id)).toEqual(["1", "2", "3"]);
  });
});
