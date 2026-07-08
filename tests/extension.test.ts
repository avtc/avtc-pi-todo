// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Tests for pi-todo standalone extension entry point (extension.ts).
 *
 * Verifies:
 * - Extension emits pi-todo:ready event with correct API shape (disable*, getCompletedItemId, getInProgressItem)
 * - disableBuiltInFollowUp sets flag
 * - getInProgressItem reads from the bridge
 * - Reload: always defers to session_start, clears hooks before re-emitting
 * - session_shutdown cleans up state
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetExtensionState, type PiTodoApi, TODO_TOOL_NAMES } from "../src/extension.js";
import { _builtInFollowUpDisabled, _setBuiltInFollowUpDisabled } from "../src/hooks.js";
import type { TodoSettings } from "../src/schema.js";
import { _setGetTodoSettings } from "../src/settings-ui.js";
import { clearTodoSettings, FOLLOW_UP_ENABLED, getTestSettings } from "./setup-tool.js";

function createMockPi() {
  const emitted: Array<{ event: string; data: unknown }> = [];
  const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
  const onHandlers: Array<() => void> = [];

  return {
    events: {
      emit(event: string, data: unknown) {
        emitted.push({ event, data });
      },
      on(_event: string, _handler: (...args: unknown[]) => unknown) {
        // Not needed for these tests
      },
    },
    on(event: string, handler: (...args: unknown[]) => unknown) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      const unsub = () => {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      };
      onHandlers.push(unsub);
      return unsub;
    },
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    appendEntry: vi.fn(),
    sendUserMessage: vi.fn(),
    emitted,
    handlers,
    onHandlers,
    fireSessionEvent(event: string, ...args: unknown[]) {
      const list = handlers.get(event) ?? [];
      for (const h of list) h(...args);
    },
  };
}

describe("extension.ts", () => {
  let extensionModule: typeof import("../src/extension.js");

  beforeEach(async () => {
    _resetExtensionState();
    _setGetTodoSettings(() => getTestSettings() as unknown as TodoSettings);
    _setBuiltInFollowUpDisabled(FOLLOW_UP_ENABLED);
    clearTodoSettings();
    delete process.env.PI_SETTINGS_TODO;
    // isolate:false in vitest.config.ts → globalThis persists across all tests.
    // The extension's reload-safe wiring guard short-circuits when already wired,
    // so reset the flag to guarantee a fresh, full wiring pass per test.
    delete (globalThis as { __avtcPiTodoWired?: boolean }).__avtcPiTodoWired;
    // biome-ignore lint/style/useTemplate: string concatenation (not template literal) keeps the import specifier statically analyzable so esbuild/vitest can resolve this cache-busting dynamic import; a template literal breaks it ("Unknown variable dynamic import").
    extensionModule = await import("../src/extension.js?t=" + Date.now());
  });

  afterEach(() => {
    _resetExtensionState();
    _setGetTodoSettings(null);
    _setBuiltInFollowUpDisabled(FOLLOW_UP_ENABLED);
    clearTodoSettings();
    delete process.env.PI_SETTINGS_TODO;
  });

  it("emits pi-todo:ready event with API object", async () => {
    const pi = createMockPi();
    extensionModule.default(pi as unknown as ExtensionAPI);

    // Fire session_start to trigger the deferred ready emit
    pi.fireSessionEvent("session_start", { reason: "new" }, { cwd: process.cwd() });

    const readyEvents = pi.emitted.filter((e) => e.event === "pi-todo:ready");
    expect(readyEvents.length).toBe(1);

    const api = readyEvents[0].data as PiTodoApi;
    expect(api).toHaveProperty("disableBuiltInFollowUp");
    expect(api).toHaveProperty("getCompletedItemId");
    expect(api).toHaveProperty("getInProgressItem");
    expect(api).toHaveProperty("areAllTodosDone");
    expect(typeof api.disableBuiltInFollowUp).toBe("function");
    expect(typeof api.getCompletedItemId).toBe("function");
    expect(typeof api.getInProgressItem).toBe("function");
    expect(typeof api.areAllTodosDone).toBe("function");
  });

  it("disableBuiltInFollowUp sets flag", async () => {
    const pi = createMockPi();
    extensionModule.default(pi as unknown as ExtensionAPI);
    pi.fireSessionEvent("session_start", { reason: "new" }, { cwd: process.cwd() });

    const api = pi.emitted.find((e) => e.event === "pi-todo:ready")?.data as PiTodoApi;

    expect(_builtInFollowUpDisabled).toBe(false);
    api.disableBuiltInFollowUp();
    expect(_builtInFollowUpDisabled).toBe(true);
  });

  it("getInProgressItem returns null when no items in progress", async () => {
    const pi = createMockPi();
    extensionModule.default(pi as unknown as ExtensionAPI);
    pi.fireSessionEvent("session_start", { reason: "new" }, { cwd: process.cwd() });

    const api = pi.emitted.find((e) => e.event === "pi-todo:ready")?.data as PiTodoApi;
    expect(api.getInProgressItem()).toBeNull();
  });

  it("areAllTodosDone returns true when no items exist", async () => {
    const pi = createMockPi();
    extensionModule.default(pi as unknown as ExtensionAPI);
    pi.fireSessionEvent("session_start", { reason: "new" }, { cwd: process.cwd() });

    const api = pi.emitted.find((e) => e.event === "pi-todo:ready")?.data as PiTodoApi;
    expect(api.areAllTodosDone()).toBe(true);
  });

  it("registers exactly 5 tools", async () => {
    const pi = createMockPi();
    extensionModule.default(pi as unknown as ExtensionAPI);

    expect(pi.registerTool).toHaveBeenCalledTimes(5);
    const toolNames = pi.registerTool.mock.calls.map((call: unknown[]) => (call[0] as { name: string }).name);
    expect(toolNames).toContain("todo_init");
    expect(toolNames).toContain("todo_add");
    expect(toolNames).toContain("todo_move");
    expect(toolNames).toContain("todo_list");
    expect(toolNames).toContain("todo_complete");
  });

  it("caches API on globalThis for reload survival", async () => {
    const pi = createMockPi();
    extensionModule.default(pi as unknown as ExtensionAPI);

    const state = (globalThis as unknown as Record<string, { cachedApi?: PiTodoApi | null }>).__piTodoExtState;
    expect(state).toBeDefined();
    expect(state?.cachedApi).toBeDefined();
    expect(state?.cachedApi).toHaveProperty("disableBuiltInFollowUp");
    expect(state?.cachedApi).toHaveProperty("getCompletedItemId");
    expect(state?.cachedApi).toHaveProperty("getInProgressItem");
  });

  it("always defers to session_start (never sync emit)", async () => {
    // First load
    const pi1 = createMockPi();
    extensionModule.default(pi1 as unknown as ExtensionAPI);
    pi1.fireSessionEvent("session_start", { reason: "new" }, { cwd: process.cwd() });

    // Simulate /reload: shutdown tears down the session (resets the wiring guard
    // flag), then pi re-evaluates the module fresh and calls the entry again on a
    // new Extension. Without the shutdown, the guard short-circuits the second
    // call and pi2 never gets wired.
    pi1.fireSessionEvent("session_shutdown");

    // Second load (simulates reload — cachedApi exists from first load)
    const pi2 = createMockPi();
    extensionModule.default(pi2 as unknown as ExtensionAPI);

    // Should NOT emit synchronously — must wait for session_start
    const syncReadyEvents = pi2.emitted.filter((e) => e.event === "pi-todo:ready");
    expect(syncReadyEvents.length).toBe(0);

    // Emit happens on session_start
    pi2.fireSessionEvent("session_start", { reason: "reload" }, { cwd: process.cwd() });
    const readyEvents = pi2.emitted.filter((e) => e.event === "pi-todo:ready");
    expect(readyEvents.length).toBe(1);
  });

  it("clears hook flags before re-emitting :ready on session_start", async () => {
    const pi = createMockPi();
    extensionModule.default(pi as unknown as ExtensionAPI);
    pi.fireSessionEvent("session_start", { reason: "new" }, { cwd: process.cwd() });

    const api = pi.emitted.find((e) => e.event === "pi-todo:ready")?.data as PiTodoApi;
    api.disableBuiltInFollowUp();
    expect(_builtInFollowUpDisabled).toBe(true);

    // Simulate reload — session_start clears hooks before re-emitting
    pi.fireSessionEvent("session_start", { reason: "reload" }, { cwd: process.cwd() });
    expect(_builtInFollowUpDisabled).toBe(false);
  });

  it("session_shutdown cleans up state", async () => {
    const pi = createMockPi();
    extensionModule.default(pi as unknown as ExtensionAPI);

    expect(
      (globalThis as unknown as Record<string, { cachedApi?: PiTodoApi | null }>).__piTodoExtState?.cachedApi,
    ).toBeDefined();

    pi.fireSessionEvent("session_shutdown");

    expect(
      (globalThis as unknown as Record<string, { cachedApi?: PiTodoApi | null }>).__piTodoExtState?.cachedApi,
    ).toBeNull();
  });

  it("registers /todo:settings command", async () => {
    const pi = createMockPi();
    extensionModule.default(pi as unknown as ExtensionAPI);

    expect(pi.registerCommand).toHaveBeenCalledWith(
      "todo:settings",
      expect.objectContaining({
        description: expect.any(String),
      }),
    );
  });
});

/** Parse PI_SUBAGENT_TOOLS_ADD the same way the subagent repo does (comma-list → array). */
function parseExtra(raw: string | undefined): string[] {
  return raw
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : [];
}

describe("extension.ts — force-enable todo_* in subagents", () => {
  let extensionModule: typeof import("../src/extension.js");

  beforeEach(async () => {
    _resetExtensionState();
    _setGetTodoSettings(() => getTestSettings() as unknown as TodoSettings);
    clearTodoSettings();
    delete process.env.PI_SETTINGS_TODO;
    delete process.env.PI_SUBAGENT_TOOLS_ADD;
    // isolate:false in vitest.config.ts → globalThis persists across all tests.
    // The extension's reload-safe wiring guard short-circuits when already wired,
    // so reset the flag to guarantee a fresh, full wiring pass per test.
    delete (globalThis as { __avtcPiTodoWired?: boolean }).__avtcPiTodoWired;
    // biome-ignore lint/style/useTemplate: cache-busting dynamic import needs string concatenation (note above)
    extensionModule = await import("../src/extension.js?t=" + Date.now());
  });

  afterEach(() => {
    _resetExtensionState();
    _setGetTodoSettings(null);
    clearTodoSettings();
    delete process.env.PI_SETTINGS_TODO;
    delete process.env.PI_SUBAGENT_TOOLS_ADD;
  });

  it("appends all 5 todo_* tools into PI_SUBAGENT_TOOLS_ADD on session_start", async () => {
    const pi = createMockPi();
    extensionModule.default(pi as unknown as ExtensionAPI);
    pi.fireSessionEvent("session_start", { reason: "new" }, { cwd: process.cwd() });

    const tools = parseExtra(process.env.PI_SUBAGENT_TOOLS_ADD);
    // freshly-deleted env → exactly the 5 todo tools, in order, nothing else.
    expect(tools).toEqual(TODO_TOOL_NAMES);
  });

  it("trims and skips degenerate entries (stray commas, surrounding spaces)", async () => {
    process.env.PI_SUBAGENT_TOOLS_ADD = "  decision_add , , decision_list  ";
    const pi = createMockPi();
    extensionModule.default(pi as unknown as ExtensionAPI);
    pi.fireSessionEvent("session_start", { reason: "new" }, { cwd: process.cwd() });

    const tools = parseExtra(process.env.PI_SUBAGENT_TOOLS_ADD);
    expect(tools).toEqual(["decision_add", "decision_list", ...TODO_TOOL_NAMES]);
  });

  it("is commutative: preserves existing decision_* entries (append-with-dedup)", async () => {
    process.env.PI_SUBAGENT_TOOLS_ADD = "decision_add,decision_list";
    const pi = createMockPi();
    extensionModule.default(pi as unknown as ExtensionAPI);
    pi.fireSessionEvent("session_start", { reason: "new" }, { cwd: process.cwd() });

    const tools = parseExtra(process.env.PI_SUBAGENT_TOOLS_ADD);
    expect(tools).toEqual([
      "decision_add",
      "decision_list",
      "todo_init",
      "todo_add",
      "todo_move",
      "todo_list",
      "todo_complete",
    ]);
  });

  it("is idempotent: firing session_start twice does not duplicate", async () => {
    const pi = createMockPi();
    extensionModule.default(pi as unknown as ExtensionAPI);
    pi.fireSessionEvent("session_start", { reason: "new" }, { cwd: process.cwd() });
    pi.fireSessionEvent("session_start", { reason: "reload" }, { cwd: process.cwd() });

    const tools = parseExtra(process.env.PI_SUBAGENT_TOOLS_ADD);
    // exactly 5 todo tools, no duplicates
    expect(tools.filter((t) => t.startsWith("todo_"))).toEqual(TODO_TOOL_NAMES);
  });
});
