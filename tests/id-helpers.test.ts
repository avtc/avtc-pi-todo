// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { describe, expect, test } from "vitest";
import {
  findSubtreeEndIndex,
  getItemDepth,
  getParentId,
  isDescendantOf,
  isTerminal,
  isValidStatus,
  parseId,
} from "../src/id-helpers.js";

describe("parseId", () => {
  test("parses top-level ID", () => expect(parseId("1")).toEqual(["1"]));
  test("parses nested ID", () => expect(parseId("2.3.4")).toEqual(["2", "3", "4"]));
});

describe("getParentId", () => {
  test("returns parent", () => expect(getParentId("2.3.4")).toBe("2.3"));
  test("returns undefined for top-level", () => expect(getParentId("1")).toBeUndefined());
});

describe("isValidStatus", () => {
  test("pending is valid", () => expect(isValidStatus("pending")).toBe(true));
  test("in_progress is valid", () => expect(isValidStatus("in_progress")).toBe(true));
  test("completed is valid", () => expect(isValidStatus("completed")).toBe(true));
  test("decomposed is valid", () => expect(isValidStatus("decomposed")).toBe(true));
  test("empty string is NOT valid", () => expect(isValidStatus("")).toBe(false));
  test("skipped is NOT valid", () => expect(isValidStatus("skipped")).toBe(false));
  test("random string is NOT valid", () => expect(isValidStatus("unknown")).toBe(false));
  test("case-sensitive: Pending is NOT valid", () => expect(isValidStatus("Pending")).toBe(false));
  test("case-sensitive: IN_PROGRESS is NOT valid", () => expect(isValidStatus("IN_PROGRESS")).toBe(false));
});

describe("getItemDepth", () => {
  test("top-level ID has depth 0", () => expect(getItemDepth("1")).toBe(0));
  test("child ID has depth 1", () => expect(getItemDepth("1.2")).toBe(1));
  test("grandchild ID has depth 2", () => expect(getItemDepth("1.2.3")).toBe(2));
  test("deeply nested ID has depth 5", () => expect(getItemDepth("1.2.3.4.5.6")).toBe(5));
  test("multi-digit segments work", () => expect(getItemDepth("10.20")).toBe(1));
});

describe("isTerminal", () => {
  test("completed is terminal", () => expect(isTerminal("completed")).toBe(true));
  test("decomposed is terminal", () => expect(isTerminal("decomposed")).toBe(true));
  test("pending is NOT terminal", () => expect(isTerminal("pending")).toBe(false));
  test("in_progress is NOT terminal", () => expect(isTerminal("in_progress")).toBe(false));
});

describe("findSubtreeEndIndex", () => {
  const items = [{ id: "1" }, { id: "1.1" }, { id: "1.1.1" }, { id: "1.2" }, { id: "2" }];
  test("returns startIndex when startIndex is out of bounds", () => {
    expect(findSubtreeEndIndex([{ id: "1" }, { id: "2" }], "2", 2)).toBe(2);
  });
  test("scans past direct children", () => {
    expect(findSubtreeEndIndex(items, "1", 1)).toBe(4);
  });
  test("scans past grandchildren", () => {
    expect(findSubtreeEndIndex(items, "1.1", 2)).toBe(3);
  });
  test("stops at non-descendant", () => {
    expect(findSubtreeEndIndex(items, "1", 1)).toBe(4); // stops before "2"
  });
  test("handles empty array", () => {
    expect(findSubtreeEndIndex([], "1", 0)).toBe(0);
  });
});

describe("isDescendantOf", () => {
  test("direct child is descendant", () => expect(isDescendantOf("1.1", "1")).toBe(true));
  test("grandchild is descendant", () => expect(isDescendantOf("1.1.2", "1")).toBe(true));
  test("great-grandchild is descendant", () => expect(isDescendantOf("1.1.2.3", "1")).toBe(true));
  test("sibling is NOT descendant", () => expect(isDescendantOf("2", "1")).toBe(false));
  test("unrelated nested is NOT descendant", () => expect(isDescendantOf("2.3", "1")).toBe(false));
  test("same ID is NOT descendant", () => expect(isDescendantOf("1", "1")).toBe(false));
  test("avoids prefix false match (10.1 vs 1)", () => expect(isDescendantOf("10.1", "1")).toBe(false));
  test("same-branch siblings are NOT descendants (1.1 vs 1.2)", () => expect(isDescendantOf("1.1", "1.2")).toBe(false));
  test("same-branch siblings are NOT descendants (1.2 vs 1.1)", () => expect(isDescendantOf("1.2", "1.1")).toBe(false));
  test("deep same-branch siblings are NOT descendants (1.1.1 vs 1.1.2)", () =>
    expect(isDescendantOf("1.1.1", "1.1.2")).toBe(false));
});
