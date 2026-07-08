// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { describe, expect, test } from "vitest";
import { renumberTree } from "../src/renumbering.js";

interface Item {
  id: string;
  parentId?: string;
  name: string;
}

describe("renumberTree", () => {
  test("assigns sequential top-level ids in array order", () => {
    const items: Item[] = [
      { id: "7", name: "A" },
      { id: "9", name: "B" },
      { id: "12", name: "C" },
    ];
    renumberTree(items);
    expect(items.map((i) => i.id)).toEqual(["1", "2", "3"]);
  });

  test("numbers children per-parent and rewrites parentId", () => {
    const items: Item[] = [
      { id: "x", name: "A" },
      { id: "y", parentId: "x", name: "A1" },
      { id: "z", parentId: "x", name: "A2" },
      { id: "w", name: "B" },
    ];
    renumberTree(items);
    expect(items.map((i) => [i.id, i.parentId])).toEqual([
      ["1", undefined],
      ["1.1", "1"],
      ["1.2", "1"],
      ["2", undefined],
    ]);
  });

  test("cascades to deeply nested descendants", () => {
    const items: Item[] = [
      { id: "p", name: "A" },
      { id: "c", parentId: "p", name: "A1" },
      { id: "g", parentId: "c", name: "A1a" },
      { id: "gg", parentId: "g", name: "A1a1" },
    ];
    renumberTree(items);
    expect(items.map((i) => [i.id, i.parentId])).toEqual([
      ["1", undefined],
      ["1.1", "1"],
      ["1.1.1", "1.1"],
      ["1.1.1.1", "1.1.1"],
    ]);
  });

  test("no-op on an already-contiguous tree (ids stable)", () => {
    const items: Item[] = [
      { id: "1", name: "A" },
      { id: "1.1", parentId: "1", name: "A1" },
      { id: "2", name: "B" },
    ];
    renumberTree(items);
    expect(items.map((i) => i.id)).toEqual(["1", "1.1", "2"]);
    expect(items[1].parentId).toBe("1");
  });

  test("normalizes gaps to a contiguous tree (legacy/externally-restored data)", () => {
    // Gaps can't arise from any tool (no delete), but restored data may have them;
    // renumberTree self-heals by collapsing to contiguous positional ids.
    const items: Item[] = [
      { id: "1", name: "A" },
      { id: "4", name: "B" },
      { id: "6", name: "C" },
    ];
    renumberTree(items);
    expect(items.map((i) => i.id)).toEqual(["1", "2", "3"]);
  });

  test("normalizes gaps among children", () => {
    const items: Item[] = [
      { id: "1", name: "A" },
      { id: "1.1", parentId: "1", name: "A1" },
      { id: "1.5", parentId: "1", name: "A5" },
      { id: "2", name: "B" },
    ];
    renumberTree(items);
    expect(items.map((i) => [i.id, i.parentId])).toEqual([
      ["1", undefined],
      ["1.1", "1"],
      ["1.2", "1"],
      ["2", undefined],
    ]);
  });

  test("assigns positional ids to temp-id new items (add scenario)", () => {
    // handleAdd creates new items with placeholder ids (?0, ?1, ...); renumberTree
    // gives them their real positional ids.
    const items: Item[] = [
      { id: "1", name: "A" },
      { id: "?0", parentId: undefined, name: "New" },
      { id: "2", name: "B" },
    ];
    renumberTree(items);
    expect(items.map((i) => i.id)).toEqual(["1", "2", "3"]);
    expect(items[1].name).toBe("New");
  });

  test("empty array is a no-op", () => {
    const items: Item[] = [];
    renumberTree(items);
    expect(items).toEqual([]);
  });

  test("renumbers after a mid-list reorder (move scenario)", () => {
    // Moving "4" before "1" in [1,2,3,4,5] yields array [4,1,2,3,5] → positional
    // renumber collapses to [1,2,3,4,5] with 5 unchanged.
    const items: Item[] = [
      { id: "4", name: "D" },
      { id: "1", name: "A" },
      { id: "2", name: "B" },
      { id: "3", name: "C" },
      { id: "5", name: "E" },
    ];
    renumberTree(items);
    expect(items.map((i) => [i.id, i.name])).toEqual([
      ["1", "D"],
      ["2", "A"],
      ["3", "B"],
      ["4", "C"],
      ["5", "E"],
    ]);
  });

  test("reparent changes depth (promote child to top-level)", () => {
    // 1.1 reparented out to top-level, appended: array [1, B, A1]
    const items: Item[] = [
      { id: "1", name: "A" },
      { id: "2", name: "B" },
      { id: "1.1", parentId: undefined, name: "A1" },
    ];
    renumberTree(items);
    expect(items.map((i) => [i.id, i.parentId])).toEqual([
      ["1", undefined],
      ["2", undefined],
      ["3", undefined],
    ]);
  });
});
