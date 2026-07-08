// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Text } from "@earendil-works/pi-tui";
import { vi } from "vitest";
import todoExtension from "../src/extension.js";
import { _setBuiltInFollowUpDisabled } from "../src/hooks.js";
import type { TodoSettings } from "../src/schema.js";
import { _setGetTodoSettings } from "../src/settings-ui.js";
import type { ToolResult } from "../src/types.js";

/** No setup tool options (use defaults) */
export const NO_SETUP_TOOL_OPTIONS: {
  getBranch?: () => unknown[];
  apiOverrides?: Record<string, unknown>;
  builtInFollowUpDisabled?: boolean;
} | null = null;

/** Built-in follow-up: enabled (not disabled) */
export const FOLLOW_UP_ENABLED = false;

/** Built-in follow-up: disabled */
export const FOLLOW_UP_DISABLED = true;

/**
 * Shared setupTool factory for pi-todo test files.
 *
 * Creates all 5 registered todo tools (todo_init, todo_add, todo_move, todo_list, todo_complete)
 * with a mock API, returning tool instances and all mocks needed for assertions.
 *
 * @param options.getBranch - Override sessionManager.getBranch (default: () => [])
 * @param options.apiOverrides - Additional API properties/methods to merge
 * @param options.builtInFollowUpDisabled - Start with followUp disabled (simulates host calling disableBuiltInFollowUp)
 */
export function setupTool(
  options: {
    getBranch?: () => unknown[];
    apiOverrides?: Record<string, unknown>;
    builtInFollowUpDisabled?: boolean;
  } | null,
) {
  const appendEntryMock = vi.fn();
  const sendUserMessageMock = vi.fn();
  const compactMock = vi.fn();
  const registeredTools: unknown[] = [];
  const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();

  const api = {
    on(event: string, handler: (...args: unknown[]) => unknown) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    events: {
      on(event: string, handler: (...args: unknown[]) => unknown) {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
        return () => {
          const list = handlers.get(event);
          if (list) {
            const idx = list.indexOf(handler);
            if (idx >= 0) list.splice(idx, 1);
          }
        };
      },
      emit: vi.fn(),
      off: vi.fn(),
    },
    registerTool(tool: unknown) {
      registeredTools.push(tool);
    },
    registerCommand() {},
    appendEntry: appendEntryMock,
    sendUserMessage: sendUserMessageMock,
    ...options?.apiOverrides,
  };

  // Wire test settings (mocks getTodoSettings so tests never touch the real settings handle).
  _setGetTodoSettings(() => getTestSettings() as unknown as TodoSettings);

  // Set builtInFollowUpDisabled if requested
  if (options?.builtInFollowUpDisabled) {
    _setBuiltInFollowUpDisabled(FOLLOW_UP_DISABLED);
  }

  // isolate:false in vitest.config.ts → globalThis persists across all tests.
  // The extension's reload-safe wiring guard short-circuits when already wired,
  // so reset the flag to guarantee a fresh, full wiring pass per setupTool call.
  delete (globalThis as { __avtcPiTodoWired?: boolean }).__avtcPiTodoWired;

  todoExtension(api as unknown as ExtensionAPI);

  // Safety check: todo extension should register exactly 5 tools
  if (registeredTools.length !== 5) {
    throw new Error(
      `setupTool: expected exactly 5 registered tools, got ${registeredTools.length}` +
        (registeredTools.length === 0 ? " (createTodoExtension may not have called registerTool)" : ""),
    );
  }

  const findByName = (
    name: string,
  ): {
    name: string;
    execute: (...args: unknown[]) => Promise<ToolResult>;
    renderCall: (args: unknown, theme: unknown) => Text;
    renderResult: (result: unknown, options: unknown, theme: unknown) => Text;
  } => {
    const tool = registeredTools.find(
      (
        t,
      ): t is {
        name: string;
        execute: (...args: unknown[]) => Promise<ToolResult>;
        renderCall: (args: unknown, theme: unknown) => Text;
        renderResult: (result: unknown, options: unknown, theme: unknown) => Text;
      } => typeof t === "object" && t !== null && (t as { name: string }).name === name,
    );
    if (!tool) throw new Error(`setupTool: tool ${name} not registered`);
    return tool;
  };

  const tools = {
    init: findByName("todo_init"),
    add: findByName("todo_add"),
    move: findByName("todo_move"),
    list: findByName("todo_list"),
    complete: findByName("todo_complete"),
  };

  const ctx = {
    hasUI: false,
    sessionManager: { getBranch: options?.getBranch ?? (() => []) },
    ui: { setWidget: vi.fn() },
    compact: compactMock,
    getContextUsage: () => Promise.resolve({ tokens: 50000, contextWindow: 200000, percent: 25 }),
  };

  return {
    tools,
    api,
    ctx,
    appendEntryMock,
    sendUserMessageMock,
    compactMock,
    handlers,
    registeredTools,
    fireSessionEvent: (event: string, ctxOverride?: unknown) => {
      const list = handlers.get(event) ?? [];
      for (const h of list) {
        h({}, ctxOverride ?? ctx);
      }
    },
  };
}

let _currentSettings: Record<string, unknown> = {};

/**
 * Set a todo setting for tests.
 * In pi-todo, settings are read from _settingsGetterRef wired by extension.ts.
 * Tests set the value here, and setupTool wires it via _settingsGetterRef.
 */
export function setTodoSetting(key: string, value: unknown): void {
  _currentSettings[key] = value;
}

/**
 * Clear all todo settings after test.
 */
export function clearTodoSettings(): void {
  _currentSettings = {};
}

/** Get the current test settings (used by setupTool to wire _settingsGetterRef). */
export function getTestSettings(): Record<string, unknown> {
  return _currentSettings;
}
