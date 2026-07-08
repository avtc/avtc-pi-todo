// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { describe, expect, test, vi } from "vitest";
import { NO_SETUP_TOOL_OPTIONS, setupTool } from "./setup-tool.js";

// Mock theme that wraps text with class markers for assertions
const theme = {
  fg: (cls: string, text: string) => `<${cls}>${text}</${cls}>`,
  bold: (text: string) => `<b>${text}</b>`,
};

describe("todo tool — renderCall", () => {
  test("renders todo_init with item count", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.init.renderCall({ items: [{ name: "A" }, { name: "B" }, { name: "C" }] }, theme);
    expect((result as unknown as { text: string }).text).toContain("<b>todo_init </b>");
    expect((result as unknown as { text: string }).text).toContain("3 items");
  });

  test("renders todo_complete with string ID", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.complete.renderCall({ id: "2" }, theme);
    expect((result as unknown as { text: string }).text).toContain("todo_complete");
    expect((result as unknown as { text: string }).text).toContain("2");
  });

  test("renders todo_add with parentId", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.add.renderCall({ items: [{ name: "X" }], parentId: "1" }, theme);
    expect((result as unknown as { text: string }).text).toContain("todo_add");
    expect((result as unknown as { text: string }).text).toContain("child of 1");
  });

  test("renders todo_add with beforeId", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.add.renderCall({ items: [{ name: "X" }], beforeId: "1.2" }, theme);
    expect((result as unknown as { text: string }).text).toContain("todo_add");
    expect((result as unknown as { text: string }).text).toContain("before 1.2");
  });

  test("renders todo_add with both parentId and beforeId", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.add.renderCall({ items: [{ name: "X" }], parentId: "1", beforeId: "1.1" }, theme);
    expect((result as unknown as { text: string }).text).toContain("child of 1");
    expect((result as unknown as { text: string }).text).toContain("before 1.1");
  });

  test("renders todo_list with status filter", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.list.renderCall({ status: "pending" }, theme);
    expect((result as unknown as { text: string }).text).toContain("todo_list");
    expect((result as unknown as { text: string }).text).toContain("pending");
  });

  test("renders todo_add plain (no parentId, no beforeId)", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.add.renderCall({ items: [{ name: "New task" }] }, theme);
    expect((result as unknown as { text: string }).text).toContain("todo_add");
    expect((result as unknown as { text: string }).text).toContain("1 items");
    expect((result as unknown as { text: string }).text).not.toContain("child of");
    expect((result as unknown as { text: string }).text).not.toContain("after");
  });

  test("renders todo_move with parentId", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.move.renderCall({ ids: ["2"], parentId: "1" }, theme);
    expect((result as unknown as { text: string }).text).toContain("todo_move");
    expect((result as unknown as { text: string }).text).toContain("under 1");
  });

  test("renders todo_move with beforeId", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.move.renderCall({ ids: ["2"], beforeId: "1" }, theme);
    expect((result as unknown as { text: string }).text).toContain("todo_move");
    expect((result as unknown as { text: string }).text).toContain("before 1");
  });

  test("renders todo_move with both parentId and beforeId", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.move.renderCall({ ids: ["2"], parentId: "1", beforeId: "1.1" }, theme);
    expect((result as unknown as { text: string }).text).toContain("todo_move");
    expect((result as unknown as { text: string }).text).toContain("under 1");
    expect((result as unknown as { text: string }).text).toContain("before 1.1");
  });

  test("renders todo_list", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.list.renderCall({}, theme);
    expect((result as unknown as { text: string }).text).toContain("todo_list");
  });
});

describe("todo tool — renderResult", () => {
  test("renders init result with displayText from details", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const displayText = "▶ 1 A\n○ 2 B\n\nIn progress: ▶ 1: A\nDetails here";
    const result = tools.init.renderResult(
      {
        content: [{ type: "text", text: displayText }],
        details: {
          items: [
            { id: "1", name: "A", status: "in_progress" },
            { id: "2", name: "B", status: "pending" },
          ],
          displayText,
        },
      },
      {},
      theme,
    );
    // Uses displayText from details — matches what the model sees
    expect((result as unknown as { text: string }).text).toContain("▶ 1 A");
    expect((result as unknown as { text: string }).text).toContain("○ 2 B");
    expect((result as unknown as { text: string }).text).toContain("In progress: ▶ 1: A");
    expect((result as unknown as { text: string }).text).toContain("Details here");
  });

  test("renders init result fallback to item list when no displayText", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.init.renderResult(
      {
        content: [{ type: "text", text: "some text" }],
        details: {
          items: [
            { id: "1", name: "A", status: "in_progress" },
            { id: "2", name: "B", status: "pending" },
          ],
        },
      },
      {},
      theme,
    );
    // Falls back to formatItemList(items)
    expect((result as unknown as { text: string }).text).toContain("▶ 1 A");
    expect((result as unknown as { text: string }).text).toContain("○ 2 B");
  });

  test("renders add result with displayText from details", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const displayText = "○ 3 New item";
    const result = tools.add.renderResult(
      {
        content: [{ type: "text", text: displayText }],
        details: { items: [{ id: "1" }, { id: "3", name: "New item" }], newItems: ["3"], displayText },
      },
      {},
      theme,
    );
    // Uses displayText from details — matches what the model sees
    expect((result as unknown as { text: string }).text).toContain("○ 3 New item");
  });

  test("renders add result fallback when no displayText", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.add.renderResult(
      {
        content: [{ type: "text", text: "○ 3 New item" }],
        details: { items: [{ id: "1" }, { id: "3", name: "New item" }], newItems: ["3"] },
      },
      {},
      theme,
    );
    // Falls back to formatItemList(items)
    expect((result as unknown as { text: string }).text).toContain("○ 3 New item");
  });

  test("renders complete result with displayText from details", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const displayText = "✅ 1\n\nIn progress: ▶ 2: Next task\nDo the next thing";
    const result = tools.complete.renderResult(
      {
        content: [{ type: "text", text: displayText }],
        details: {
          items: [
            { id: "1", status: "completed" },
            { id: "2", status: "in_progress" },
          ],
          displayText,
        },
      },
      {},
      theme,
    );
    // Uses displayText from details — matches what the model sees
    expect((result as unknown as { text: string }).text).toContain("✅ 1");
    expect((result as unknown as { text: string }).text).toContain("In progress: ▶ 2: Next task");
    expect((result as unknown as { text: string }).text).toContain("Do the next thing");
  });

  test("renders complete result fallback with done count from details", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.complete.renderResult(
      {
        content: [{ type: "text", text: "✅ 1\nIn progress: ▶ 2: Next task\nDo the next thing" }],
        details: {
          items: [
            { id: "1", status: "completed" },
            { id: "2", status: "in_progress" },
          ],
        },
      },
      {},
      theme,
    );
    // Fallback: shows done count
    expect((result as unknown as { text: string }).text).toContain("Completed");
    expect((result as unknown as { text: string }).text).toContain("1/2 done");
  });

  test("renders complete result — all done shows generic message", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.complete.renderResult(
      {
        content: [{ type: "text", text: "✅ 1 Task A\n\nAll todos done. List cleared." }],
        details: { items: [] },
      },
      {},
      theme,
    );
    // Details-based rendering: empty items → generic message
    expect((result as unknown as { text: string }).text).toContain("All todos done");
  });

  test("renders complete result — all done fallback when no content", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.complete.renderResult(
      {
        content: [{ type: "text", text: "" }],
        details: { items: [] },
      },
      {},
      theme,
    );
    expect((result as unknown as { text: string }).text).toContain("All todos done");
  });

  test("renders complete result with done count including decomposed", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.complete.renderResult(
      {
        content: [{ type: "text", text: "✅ 1, 2\nIn progress: ▶ 3: Next\nDetails" }],
        details: {
          items: [
            { id: "1", status: "completed" },
            { id: "2", status: "decomposed" },
            { id: "3", status: "in_progress" },
          ],
        },
      },
      {},
      theme,
    );
    // Details-based rendering: decomposed counts as done
    expect((result as unknown as { text: string }).text).toContain("Completed");
    expect((result as unknown as { text: string }).text).toContain("2/3 done");
  });

  test("renders list result with displayText from details", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const displayText = "▶ 1 A\n○ 2 B\n○ 3 C";
    const result = tools.list.renderResult(
      {
        content: [{ type: "text", text: displayText }],
        details: { items: [{ id: "1" }, { id: "2" }, { id: "3" }], displayText },
      },
      {},
      theme,
    );
    // Uses displayText from details — matches what the model sees
    expect((result as unknown as { text: string }).text).toContain("▶ 1 A");
    expect((result as unknown as { text: string }).text).toContain("○ 2 B");
    expect((result as unknown as { text: string }).text).toContain("○ 3 C");
  });

  test("renders list result fallback to item list when no displayText", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.list.renderResult(
      {
        content: [{ type: "text", text: "" }],
        details: {
          items: [
            { id: "1", name: "A" },
            { id: "2", name: "B" },
          ],
          total: 5,
        },
      },
      {},
      theme,
    );
    // Falls back to formatItemList(items)
    expect((result as unknown as { text: string }).text).toContain("○ 1 A");
    expect((result as unknown as { text: string }).text).toContain("○ 2 B");
  });

  test("renders result without details (fallback)", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.list.renderResult(
      {
        content: [{ type: "text", text: "fallback text" }],
      },
      {},
      theme,
    );
    expect((result as unknown as { text: string }).text).toContain("fallback text");
  });

  test("renders error result as plain text (no success checkmark)", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.init.renderResult(
      {
        content: [{ type: "text", text: "Error: items array required for init" }],
        details: { items: [], error: true },
      },
      {},
      theme,
    );
    expect((result as unknown as { text: string }).text).toContain("Error:");
    expect((result as unknown as { text: string }).text).not.toContain("✓");
  });

  test("renders complete error as plain text", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.complete.renderResult(
      {
        content: [{ type: "text", text: "Error: invalid IDs: 5" }],
        details: { items: [], error: true },
      },
      {},
      theme,
    );
    expect((result as unknown as { text: string }).text).toContain("Error:");
    expect((result as unknown as { text: string }).text).not.toContain("✓");
    expect((result as unknown as { text: string }).text).not.toContain("Completed");
  });
});

describe("todo tool — widget rendering", () => {
  const theme = {
    fg: (cls: string, text: string) => `<${cls}>${text}</${cls}>`,
    bold: (text: string) => `<b>${text}</b>`,
  };

  const HAS_UI = true;
  const HAS_NO_UI = false;

  const makeCtx = (setWidget: (name: string, widget: unknown) => void, hasUI: boolean) => ({
    hasUI,
    ui: { setWidget },
    sessionManager: { getBranch: () => [] },
    getContextUsage: () => Promise.resolve({ tokens: 1000, contextWindow: 100000, percent: 1 }),
  });

  test("init sets widget with correct format", async () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const setWidget = vi.fn();
    const ctx = makeCtx(setWidget, HAS_UI);

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "Task A", details: "Do A" },
          { name: "Task B", details: "Do B" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    expect(setWidget).toHaveBeenCalledWith("todo", expect.any(Function));
    const renderFn = setWidget.mock.calls[0][1];
    const rendered = renderFn({}, theme);
    // 0/2 done, first item is in_progress
    expect(rendered.text).toContain("0/2");
    expect(rendered.text).toContain("1: Task A");
    expect(rendered.text).toContain("TODO:");
  });

  test("complete updates widget with progress", async () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const setWidget = vi.fn();
    const ctx = makeCtx(setWidget, HAS_UI);

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "Task A", details: "Do A" },
          { name: "Task B", details: "Do B" },
          { name: "Task C", details: "Do C" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    setWidget.mockClear();
    await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);

    expect(setWidget).toHaveBeenCalledWith("todo", expect.any(Function));
    const renderFn = setWidget.mock.calls[0][1];
    const rendered = renderFn({}, theme);
    // 1/3 done, Task B is now in_progress
    expect(rendered.text).toContain("1/3");
    expect(rendered.text).toContain("2: Task B");
  });

  test("all-done clears widget", async () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const setWidget = vi.fn();
    const ctx = makeCtx(setWidget, HAS_UI);

    await tools.init.execute(
      "call-1",
      {
        items: [{ name: "Task A", details: "Do A" }],
      },
      undefined,
      undefined,
      ctx,
    );

    setWidget.mockClear();
    await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);

    expect(setWidget).toHaveBeenCalledWith("todo", undefined);
  });

  test("no UI — setWidget never called", async () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const setWidget = vi.fn();
    const ctx = makeCtx(setWidget, HAS_NO_UI);

    await tools.init.execute(
      "call-1",
      {
        items: [{ name: "Task A", details: "Do A" }],
      },
      undefined,
      undefined,
      ctx,
    );

    expect(setWidget).not.toHaveBeenCalled();
  });
});

describe("todo tool — renderResult collapsed/expanded mode", () => {
  test("collapsed mode truncates displayText to 12 lines with expand hint", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    // Create displayText with 20 lines
    const lines = Array.from({ length: 20 }, (_, i) => `▶ ${i + 1} Task ${i + 1}`);
    const displayText = lines.join("\n");
    const result = tools.list.renderResult(
      {
        content: [{ type: "text", text: displayText }],
        details: { items: [], displayText },
      },
      { expanded: false },
      theme,
    );
    const renderedLines = (result as unknown as { text: string }).text.split("\n");
    // Should have 12 lines of content + 1 expand hint = 13 lines total
    expect(renderedLines.length).toBe(13);
    expect((result as unknown as { text: string }).text).toContain("Ctrl+O to expand");
  });

  test("expanded mode shows full displayText without truncation", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const lines = Array.from({ length: 20 }, (_, i) => `▶ ${i + 1} Task ${i + 1}`);
    const displayText = lines.join("\n");
    const result = tools.list.renderResult(
      {
        content: [{ type: "text", text: displayText }],
        details: { items: [], displayText },
      },
      { expanded: true },
      theme,
    );
    const renderedLines = (result as unknown as { text: string }).text.split("\n");
    expect(renderedLines.length).toBe(20);
    expect((result as unknown as { text: string }).text).not.toContain("Ctrl+O to expand");
    expect((result as unknown as { text: string }).text).toContain("Task 20");
  });

  test("collapsed mode does not truncate when content fits within 12 lines", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const lines = Array.from({ length: 5 }, (_, i) => `▶ ${i + 1} Task ${i + 1}`);
    const displayText = lines.join("\n");
    const result = tools.list.renderResult(
      {
        content: [{ type: "text", text: displayText }],
        details: { items: [], displayText },
      },
      { expanded: false },
      theme,
    );
    expect((result as unknown as { text: string }).text).not.toContain("Ctrl+O to expand");
    expect((result as unknown as { text: string }).text).toContain("Task 5");
  });

  test("boundary: exactly 12 lines does not truncate", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const lines = Array.from({ length: 12 }, (_, i) => `▶ ${i + 1} Task ${i + 1}`);
    const displayText = lines.join("\n");
    const result = tools.list.renderResult(
      {
        content: [{ type: "text", text: displayText }],
        details: { items: [], displayText },
      },
      { expanded: false },
      theme,
    );
    expect((result as unknown as { text: string }).text).not.toContain("Ctrl+O to expand");
    expect((result as unknown as { text: string }).text).toContain("Task 12");
  });

  test("boundary: exactly 13 lines truncates to 12", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const lines = Array.from({ length: 13 }, (_, i) => `▶ ${i + 1} Task ${i + 1}`);
    const displayText = lines.join("\n");
    const result = tools.list.renderResult(
      {
        content: [{ type: "text", text: displayText }],
        details: { items: [], displayText },
      },
      { expanded: false },
      theme,
    );
    expect((result as unknown as { text: string }).text).toContain("Ctrl+O to expand");
    expect((result as unknown as { text: string }).text).toContain("Task 12");
    expect((result as unknown as { text: string }).text).not.toContain("Task 13");
  });

  test("empty displayText does not produce spurious expand hint", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const result = tools.list.renderResult(
      {
        content: [{ type: "text", text: "" }],
        details: { items: [], displayText: "" },
      },
      { expanded: false },
      theme,
    );
    expect((result as unknown as { text: string }).text).not.toContain("Ctrl+O to expand");
  });

  test("collapsed mode truncates init result", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const lines = Array.from({ length: 20 }, (_, i) => `▶ ${i + 1} Task ${i + 1}`);
    const displayText = lines.join("\n");
    const result = tools.init.renderResult(
      {
        content: [{ type: "text", text: displayText }],
        details: { items: [], displayText },
      },
      { expanded: false },
      theme,
    );
    expect((result as unknown as { text: string }).text).toContain("Ctrl+O to expand");
  });

  test("collapsed mode truncates add result", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const lines = Array.from({ length: 20 }, (_, i) => `▶ ${i + 1} Task ${i + 1}`);
    const displayText = lines.join("\n");
    const result = tools.add.renderResult(
      {
        content: [{ type: "text", text: displayText }],
        details: { items: [], displayText },
      },
      { expanded: false },
      theme,
    );
    expect((result as unknown as { text: string }).text).toContain("Ctrl+O to expand");
  });

  test("collapsed mode truncates complete result", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const lines = Array.from({ length: 20 }, (_, i) => `▶ ${i + 1} Task ${i + 1}`);
    const displayText = lines.join("\n");
    const result = tools.complete.renderResult(
      {
        content: [{ type: "text", text: displayText }],
        details: { items: [], displayText },
      },
      { expanded: false },
      theme,
    );
    expect((result as unknown as { text: string }).text).toContain("Ctrl+O to expand");
  });

  test("default (no options) behaves as collapsed mode", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const lines = Array.from({ length: 20 }, (_, i) => `▶ ${i + 1} Task ${i + 1}`);
    const displayText = lines.join("\n");
    const result = tools.list.renderResult(
      {
        content: [{ type: "text", text: displayText }],
        details: { items: [], displayText },
      },
      {},
      theme,
    );
    expect((result as unknown as { text: string }).text).toContain("Ctrl+O to expand");
  });

  test("error results are not truncated", () => {
    const { tools } = setupTool(NO_SETUP_TOOL_OPTIONS);
    const errorText = "Error: something went wrong with a very long error message";
    const result = tools.init.renderResult(
      {
        content: [{ type: "text", text: errorText }],
        details: { items: [], error: true },
      },
      { expanded: false },
      theme,
    );
    expect((result as unknown as { text: string }).text).toContain(errorText);
    expect((result as unknown as { text: string }).text).not.toContain("Ctrl+O to expand");
  });
});
