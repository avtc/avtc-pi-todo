// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import type { TextContent } from "@earendil-works/pi-ai";
/**
 * Integration tests for the todo tool — full workflow scenarios.
 *
 * These tests exercise complete end-to-end flows combining multiple actions,
 * persistence, auto-promotion, all-done cleanup, and settings interactions.
 */
import { describe, expect, test } from "vitest";
import { NO_SETUP_TOOL_OPTIONS, setupTool } from "./setup-tool.js";

describe("full lifecycle — brainstorming workflow", () => {
  test("init research items → complete one by one → all done → re-init for design", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    // Phase 1: Brainstorming research items
    const initResult = await tools.init.execute(
      "c1",
      {
        items: [
          { name: "Research existing solutions", details: "Search for similar tools in the ecosystem" },
          { name: "Check API docs", details: "Read pi extension API documentation" },
          { name: "Build PoC", details: "Create proof of concept for state persistence" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    expect((initResult.content[0] as TextContent).text).toContain("In progress: ▶ 1: Research existing solutions");

    // Complete research
    const complete1 = await tools.complete.execute("c2", { id: "1" }, undefined, undefined, ctx);
    expect((complete1.content[0] as TextContent).text).toContain("In progress: ▶ 2: Check API docs");

    // Complete API docs
    const complete2 = await tools.complete.execute("c3", { id: "2" }, undefined, undefined, ctx);
    expect((complete2.content[0] as TextContent).text).toContain("In progress: ▶ 3: Build PoC");

    // Complete PoC — triggers all-done
    const complete3 = await tools.complete.execute("c4", { id: "3" }, undefined, undefined, ctx);
    expect((complete3.content[0] as TextContent).text).toContain("All todos done");
    expect((complete3.content[0] as TextContent).text).toContain("✅ 1 Research existing solutions");
    expect((complete3.content[0] as TextContent).text).toContain("✅ 2 Check API docs");
    expect((complete3.content[0] as TextContent).text).toContain("✅ 3 Build PoC");
    expect((complete3.content[0] as TextContent).text).toContain("List cleared");

    // State should be cleared — can re-init
    const _reInit = await tools.init.execute(
      "c5",
      {
        items: [
          { name: "Write design doc", details: "Create design document" },
          { name: "Review with user", details: "Present design sections" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // IDs restart from "1" after all-done cleanup
    const listResult = await tools.list.execute("c6", {}, undefined, undefined, ctx);
    expect(listResult.details.items).toHaveLength(2);
    expect(listResult.details.items[0].id).toBe("1");
    expect(listResult.details.items[1].id).toBe("2");
  });
});

describe("full lifecycle — execution workflow with per-task todos", () => {
  test("init implementation steps → complete with batch → add more → complete → all done", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    // Start with test + implement steps
    await tools.init.execute(
      "c1",
      {
        items: [
          { name: "Write failing test", details: "Create test for init action" },
          { name: "Implement init", details: "Code the init handler" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Complete test + implement sequentially
    await tools.complete.execute("c2", { id: "1" }, undefined, undefined, ctx);
    const batch = await tools.complete.execute("c2b", { id: "2" }, undefined, undefined, ctx);
    // Both completed, no pending items to promote, but also no pending items = all done
    expect((batch.content[0] as TextContent).text).toContain("All todos done");

    // State cleared, can add new todos for next task
    const addResult = await tools.init.execute(
      "c3",
      {
        items: [
          { name: "Write test for complete", details: "Test batch completion" },
          { name: "Implement complete", details: "Code the complete handler" },
          { name: "Write test for list", details: "Test list filtering" },
          { name: "Implement list", details: "Code the list handler" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // First added item auto-promoted to in_progress
    expect((addResult.content[0] as TextContent).text).toContain("In progress: ▶ 1: Write test for complete");

    // Complete items one at a time
    await tools.complete.execute("c4", { id: "1" }, undefined, undefined, ctx);
    await tools.complete.execute("c5", { id: "2" }, undefined, undefined, ctx);

    // Item #2 (Write test for list) should have been auto-promoted
    const listBefore = await tools.list.execute("c6", {}, undefined, undefined, ctx);
    const inProgressItems = listBefore.details.items.filter(
      (i: { id: string; status?: string; name?: string }) => i.status === "in_progress",
    );
    expect(inProgressItems).toHaveLength(1);
    expect(inProgressItems[0].name).toBe("Write test for list");

    // Complete remaining
    await tools.complete.execute("c7", { id: "3" }, undefined, undefined, ctx);
    const final = await tools.complete.execute("c8", { id: "4" }, undefined, undefined, ctx);
    expect((final.content[0] as TextContent).text).toContain("All todos done");
    expect((final.content[0] as TextContent).text).toContain("✅ 1 Write test for complete");
    expect((final.content[0] as TextContent).text).toContain("✅ 2 Implement complete");
    expect((final.content[0] as TextContent).text).toContain("✅ 3 Write test for list");
    expect((final.content[0] as TextContent).text).toContain("✅ 4 Implement list");
  });
});

describe("decomposition workflow — parentId", () => {
  test("decompose item into children → complete children → all done", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.init.execute(
      "c1",
      {
        items: [
          { name: "Implement feature", details: "Full feature implementation" },
          { name: "Write docs", details: "Document the feature" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Decompose item "1" into sub-tasks
    const decompose = await tools.add.execute(
      "c2",
      {
        items: [{ name: "Write test" }, { name: "Implement code" }],
        parentId: "1",
      },
      undefined,
      undefined,
      ctx,
    );

    const items = decompose.details.items;
    // Parent should be decomposed
    expect(items[0].id).toBe("1");
    expect(items[0].status).toBe("decomposed");
    // Children should be added
    expect(items[1].id).toBe("1.1");
    expect(items[1].parentId).toBe("1");
    expect(items[1].status).toBe("in_progress"); // auto-promoted
    expect(items[2].id).toBe("1.2");
    expect(items[2].parentId).toBe("1");
    // Top-level sibling unchanged
    expect(items[3].id).toBe("2");
    expect(items[3].status).toBe("pending");

    // Complete child "1.1"
    const complete1 = await tools.complete.execute("c3", { id: "1.1" }, undefined, undefined, ctx);
    expect((complete1.content[0] as TextContent).text).toContain("In progress: ▶ 1.2: Implement code");

    // Complete child "1.2" — promotes to "2"
    const complete2 = await tools.complete.execute("c4", { id: "1.2" }, undefined, undefined, ctx);
    expect((complete2.content[0] as TextContent).text).toContain("In progress: ▶ 2: Write docs");

    // Complete "1" — all done
    const final = await tools.complete.execute("c5", { id: "2" }, undefined, undefined, ctx);
    expect((final.content[0] as TextContent).text).toContain("All todos done");
    expect((final.content[0] as TextContent).text).toContain("📁 1 Implement feature");
    expect((final.content[0] as TextContent).text).toContain("✅ 1.1 Write test");
    expect((final.content[0] as TextContent).text).toContain("✅ 1.2 Implement code");
    expect((final.content[0] as TextContent).text).toContain("✅ 2 Write docs");
  });
});

describe("deep decomposition workflow — 3+ levels", () => {
  test("4-level decomposition → complete → all-done with correct icons", async () => {
    const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

    await tools.add.execute("c1", { items: [{ name: "Root" }, { name: "Sibling" }] }, undefined, undefined, ctx);

    // Level 2: decompose Root into Child
    await tools.add.execute("c2", { items: [{ name: "Child" }], parentId: "1" }, undefined, undefined, ctx);

    // Level 3: decompose Child into Grandchild
    await tools.add.execute("c3", { items: [{ name: "Grandchild" }], parentId: "1.1" }, undefined, undefined, ctx);

    // Level 4: decompose Grandchild into GreatGrandchild
    await tools.add.execute(
      "c4",
      { items: [{ name: "GreatGrandchild" }], parentId: "1.1.1" },
      undefined,
      undefined,
      ctx,
    );

    // Verify hierarchy
    const listResult = await tools.list.execute("c5", {}, undefined, undefined, ctx);
    const items = listResult.details.items;
    expect(items.find((i: { id: string; status?: string; name?: string }) => i.id === "1")?.status).toBe("decomposed");
    expect(items.find((i: { id: string; status?: string; name?: string }) => i.id === "1.1")?.status).toBe(
      "decomposed",
    );
    expect(items.find((i: { id: string; status?: string; name?: string }) => i.id === "1.1.1")?.status).toBe(
      "decomposed",
    );
    expect(items.find((i: { id: string; status?: string; name?: string }) => i.id === "1.1.1.1")?.status).toBe(
      "in_progress",
    );

    // Complete GreatGrandchild → Grandchild stays decomposed, Sibling promoted to in_progress
    const r1 = await tools.complete.execute("c6", { id: "1.1.1.1" }, undefined, undefined, ctx);
    expect((r1.content[0] as TextContent).text).not.toContain("Error");
    expect((r1.content[0] as TextContent).text).not.toContain("All todos done");
    expect((r1.content[0] as TextContent).text).toContain("In progress: ▶ 2: Sibling");

    // Complete Grandchild (stays decomposed)
    const r2 = await tools.complete.execute("c7", { id: "1.1.1" }, undefined, undefined, ctx);
    expect((r2.content[0] as TextContent).text).not.toContain("Error");
    expect((r2.content[0] as TextContent).text).not.toContain("All todos done");

    // Complete Child (stays decomposed)
    const r3 = await tools.complete.execute("c8", { id: "1.1" }, undefined, undefined, ctx);
    expect((r3.content[0] as TextContent).text).not.toContain("Error");
    expect((r3.content[0] as TextContent).text).not.toContain("All todos done");

    // Complete Root (stays decomposed) then Sibling → all-done triggers
    await tools.complete.execute("c9", { id: "1" }, undefined, undefined, ctx);
    const final = await tools.complete.execute("c10", { id: "2" }, undefined, undefined, ctx);
    expect((final.content[0] as TextContent).text).toContain("All todos done");
    expect((final.content[0] as TextContent).text).toContain("📁 1 Root");
    expect((final.content[0] as TextContent).text).toContain("📁 1.1 Child");
    expect((final.content[0] as TextContent).text).toContain("📁 1.1.1 Grandchild");
    expect((final.content[0] as TextContent).text).toContain("✅ 1.1.1.1 GreatGrandchild");
    expect((final.content[0] as TextContent).text).toContain("✅ 2 Sibling");
  });
});

describe("persistence integration — session entries + feature state", () => {
  test("persists via appendEntry and restores from session branch", async () => {
    const { tools, ctx, appendEntryMock } = setupTool(NO_SETUP_TOOL_OPTIONS);

    // Init with items
    await tools.init.execute(
      "c1",
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

    // appendEntry should have been called for state persistence
    expect(appendEntryMock).toHaveBeenCalled();
    const lastCall = appendEntryMock.mock.calls[appendEntryMock.mock.calls.length - 1];
    expect(lastCall[0]).toBe("pi_todo");
    expect(lastCall[1].items).toHaveLength(2);
    const savedData = lastCall[1];

    // Now simulate restore: new tool instance with session branch returning the entry
    const {
      tools: restoreTools,
      ctx: restoreCtx,
      handlers: restoreHandlers,
    } = setupTool({
      getBranch: () => [{ type: "custom", customType: "pi_todo", data: savedData }],
    });

    // Fire session_start with reason=reload to trigger restore
    const sessionHandlers = restoreHandlers.get("session_start") ?? [];
    for (const h of sessionHandlers) {
      await h({ reason: "reload" }, restoreCtx);
    }

    // List should show restored items
    const listResult = await restoreTools.list.execute("c2", {}, undefined, undefined, restoreCtx);
    expect(listResult.details.items).toHaveLength(2);
    expect(listResult.details.items[0].name).toBe("First");
    expect(listResult.details.items[0].status).toBe("in_progress");
  });

  describe("auto-promote invariant across all actions", () => {
    test("init sets first item in_progress", async () => {
      const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

      await tools.init.execute(
        "c1",
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

      const list = await tools.list.execute("c2", {}, undefined, undefined, ctx);
      expect(list.details.items[0].status).toBe("in_progress");
      expect(list.details.items[1].status).toBe("pending");
    });

    test("complete promotes next pending", async () => {
      const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

      await tools.init.execute(
        "c1",
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

      await tools.complete.execute("c2", { id: "1" }, undefined, undefined, ctx);
      const list = await tools.list.execute("c3", {}, undefined, undefined, ctx);
      expect(list.details.items[1].status).toBe("in_progress");
    });

    test("add to empty list auto-promotes first item", async () => {
      const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

      const result = await tools.init.execute(
        "c1",
        {
          items: [{ name: "Auto-promoted", details: "First item" }],
        },
        undefined,
        undefined,
        ctx,
      );

      expect((result.content[0] as TextContent).text).toContain("In progress: ▶ 1: Auto-promoted");
    });

    test("init with empty items clears list then add gets fresh IDs from 0", async () => {
      const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

      await tools.init.execute(
        "c1",
        {
          items: [
            { name: "Old A", details: "a" },
            { name: "Old B", details: "b" },
            { name: "Old C", details: "c" },
          ],
        },
        undefined,
        undefined,
        ctx,
      );

      // Complete some items
      await tools.complete.execute("c2", { id: "1" }, undefined, undefined, ctx);
      await tools.complete.execute("c3", { id: "2" }, undefined, undefined, ctx);

      // Clear via init with empty items
      await tools.init.execute("c4", { items: [] }, undefined, undefined, ctx);

      // Add new items — IDs should start from "1"
      const _result = await tools.init.execute(
        "c5",
        {
          items: [{ name: "Fresh", details: "new start" }],
        },
        undefined,
        undefined,
        ctx,
      );

      const list = await tools.list.execute("c6", {}, undefined, undefined, ctx);
      expect(list.details.items).toHaveLength(1);
      expect(list.details.items[0].id).toBe("1");
      expect(list.details.items[0].name).toBe("Fresh");
    });
  });

  describe("edge cases — error handling and boundary conditions", () => {
    test("complete on empty state returns error", async () => {
      const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

      const result = await tools.complete.execute("c1", { id: "1" }, undefined, undefined, ctx);
      expect((result.content[0] as TextContent).text).toContain("Error");
    });

    test("double complete same item is idempotent", async () => {
      const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

      await tools.init.execute(
        "c1",
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

      // Complete item "1"
      await tools.complete.execute("c2", { id: "1" }, undefined, undefined, ctx);

      // Complete item "1" again (already completed)
      const _result = await tools.complete.execute("c3", { id: "1" }, undefined, undefined, ctx);
      // Should not error, just no-op on already-completed item
      const list = await tools.list.execute("c4", {}, undefined, undefined, ctx);
      expect(list.details.items[0].status).toBe("completed");
      expect(list.details.items[1].status).toBe("in_progress");
    });

    test("init with single item — complete triggers all-done immediately", async () => {
      const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

      await tools.init.execute(
        "c1",
        {
          items: [{ name: "Solo", details: "Only one" }],
        },
        undefined,
        undefined,
        ctx,
      );

      const result = await tools.complete.execute("c2", { id: "1" }, undefined, undefined, ctx);
      expect((result.content[0] as TextContent).text).toContain("All todos done");
      expect((result.content[0] as TextContent).text).toContain("✅ 1 Solo");
    });

    test("batch complete triggers all-done", async () => {
      const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

      await tools.init.execute(
        "c1",
        {
          items: [
            { name: "Do", details: "do it" },
            { name: "Also do", details: "do this too" },
          ],
        },
        undefined,
        undefined,
        ctx,
      );

      // Complete both sequentially
      await tools.complete.execute("c2", { id: "1" }, undefined, undefined, ctx);
      const result = await tools.complete.execute("c2b", { id: "2" }, undefined, undefined, ctx);
      expect((result.content[0] as TextContent).text).toContain("All todos done");
      expect((result.content[0] as TextContent).text).toContain("✅ 1 Do");
      expect((result.content[0] as TextContent).text).toContain("✅ 2 Also do");
    });

    test("list on empty state returns empty", async () => {
      const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

      const result = await tools.list.execute("c1", {}, undefined, undefined, ctx);
      expect(result.details.items).toEqual([]);
    });

    test("add multiple items at once — all get sequential string IDs", async () => {
      const { tools, ctx } = setupTool(NO_SETUP_TOOL_OPTIONS);

      const _result = await tools.init.execute(
        "c1",
        {
          items: [
            { name: "First", details: "f" },
            { name: "Second", details: "s" },
            { name: "Third", details: "t" },
          ],
        },
        undefined,
        undefined,
        ctx,
      );

      const list = await tools.list.execute("c2", {}, undefined, undefined, ctx);
      expect(list.details.items).toHaveLength(3);
      expect(list.details.items.map((i: { id: string; status?: string; name?: string }) => i.id)).toEqual([
        "1",
        "2",
        "3",
      ]);
      expect(list.details.items[0].status).toBe("in_progress");
      expect(list.details.items[1].status).toBe("pending");
      expect(list.details.items[2].status).toBe("pending");
    });
  });
});
