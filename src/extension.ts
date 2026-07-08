// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Pi-todo standalone extension entry point.
 *
 * Loaded by pi directly from package.json "pi" section.
 * Emits `pi-todo:ready` event with add* API for host configuration.
 *
 * Lifecycle:
 * 1. pi loads this extension → extension.ts runs
 * 2. Initializes own settings from avtc-pi-settings-ui
 * 3. Registers tools (todo_init, todo_add, todo_list, todo_complete)
 * 4. Registers session handlers for state reconstruction
 * 5. Creates API object with disableBuiltInFollowUp, getCompletedItemId, getInProgressItem, areAllTodosDone
 * 6. Always defers pi-todo:ready to session_start
 * 7. Host subscribes to 'pi-todo:ready' and calls add* methods
 *
 * Hook arrays and flags are cleared on session_start before re-emitting:ready,
 * so stale hooks from previous loads are naturally dropped.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { runDetailsCommand, runListCommand } from "./commands.js";
import { handleAdd, handleComplete, handleInit, handleList, handleMove } from "./handlers.js";
import { _builtInFollowUpDisabled, _setBuiltInFollowUpDisabled } from "./hooks.js";
import { isTerminal } from "./id-helpers.js";
import { persistState, reconstructState } from "./persistence.js";
import {
  renderAddCall,
  renderAddResult,
  renderCompleteCall,
  renderCompleteResult,
  renderInitCall,
  renderInitResult,
  renderListCall,
  renderListResult,
  renderMoveCall,
  renderMoveResult,
} from "./render.js";
import { getTodoSettings, initTodoSettings } from "./settings-ui.js";
import type { AddInput, CompleteInput, InitInput, ListInput, MoveInput, ToolResult } from "./types.js";
import { AddParams, CompleteParams, InitParams, ListParams, MoveParams } from "./types.js";
import { updateWidget } from "./widget.js";

export { getItemDepth, isTerminal, isValidStatus, parseId, type TodoStatus } from "./id-helpers.js";
// Re-export public types for consumers (was in index.ts)
export type { PiTodoBridge, TodoItem, ToolResult } from "./types.js";

// ---------------------------------------------------------------------------
// Extension API interface
// ---------------------------------------------------------------------------

/** API object exposed to host extensions via pi.events. */
export interface PiTodoApi {
  /** Disable todo's built-in followUp message after compact.
   *  Host handles followUp via session_compact + the getters below instead. */
  disableBuiltInFollowUp(): void;
  /** Id of the item just completed by the todo_complete that triggered the current compaction,
   *  then cleared (consume-on-read). Null when the compaction was not triggered by item
   *  completion — callers should then omit the `✅` line. */
  getCompletedItemId(): string | null;
  /** The current in-progress item formatted for followUp
   *  (`In progress: ▶ id: name\ndetails`), or null if none is in progress. */
  getInProgressItem(): string | null;
  /** Check if all todo items are in a terminal state (completed or decomposed).
   *  Returns true when there are no items. */
  areAllTodosDone(): boolean;
}

// ---------------------------------------------------------------------------
// Reload-safe idempotent wiring guard
// ---------------------------------------------------------------------------
//
// A globalThis flag so the package can be safely bundled into the avtc-pi
// umbrella AND installed standalone. pi re-evaluates extension modules fresh
// on /reload (jiti moduleCache:false) but globalThis persists, so an un-reset
// guard would short-circuit re-wiring and leave the extension dead after
// reload. The flag is reset on session_shutdown (registered at the end of the
// wiring pass) so a fresh module load re-wires in full.

const WIRED_KEY = "__avtcPiTodoWired";
type GlobalWithWired = typeof globalThis & { [WIRED_KEY]?: boolean };

// ---------------------------------------------------------------------------
// globalThis state for reload survival
// ---------------------------------------------------------------------------

const _gt = globalThis as {
  __piTodoExtState?: {
    cachedApi: PiTodoApi | null;
    unsubs: Array<() => void>;
  };
};

_gt.__piTodoExtState = _gt.__piTodoExtState ?? {
  cachedApi: null,
  unsubs: [],
};
const _state = _gt.__piTodoExtState;

/** Reset module state — called on test cleanup. */
export function _resetExtensionState(): void {
  for (const unsub of _state.unsubs) unsub();
  _state.unsubs.length = 0;
  _state.cachedApi = null;
  _setBuiltInFollowUpDisabled(false);
}

/** Register an event handler on pi, returning an unsubscribe function. */
function safeOn(pi: ExtensionAPI, event: string, handler: (...args: unknown[]) => void | Promise<void>): () => void {
  const unsub = (pi as unknown as { on: (event: string, handler: (...args: unknown[]) => unknown) => unknown }).on(
    event,
    handler,
  );
  return typeof unsub === "function" ? (unsub as () => void) : () => {};
}

// ---------------------------------------------------------------------------
// force-enable todo_* tools in subagents (avtc-pi-subagent PI_SUBAGENT_TOOLS_ADD)
// ---------------------------------------------------------------------------

/** The 5 todo tool names this extension registers. */
export const TODO_TOOL_NAMES = ["todo_init", "todo_add", "todo_move", "todo_list", "todo_complete"];

/**
 * Append-with-dedup the 5 todo_* tool names into PI_SUBAGENT_TOOLS_ADD so whitelisted
 * subagents still get them. Commutative with other contributors (e.g. user-decisions appends
 * decision_*); the subagent repo reads the union in fresh + fork modes. Idempotent.
 */
function contributeTodoExtraTools(): void {
  const current = process.env.PI_SUBAGENT_TOOLS_ADD;
  const existing = current
    ? current
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : [];
  const merged = [...new Set([...existing, ...TODO_TOOL_NAMES])];
  process.env.PI_SUBAGENT_TOOLS_ADD = merged.join(",");
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function todoExtension(pi: ExtensionAPI): void {
  // Reload-safe idempotent wiring guard: if already wired in this process, no-op.
  // The flag is reset on session_shutdown (registered at the end of this pass),
  // so a fresh module load after a reload re-wires in full.
  const g = globalThis as GlobalWithWired;
  if (g[WIRED_KEY]) return;
  g[WIRED_KEY] = true;

  // Clean up previous listeners on reload
  for (const unsub of _state.unsubs) unsub();
  _state.unsubs.length = 0;

  // Initialize settings (registers /todo:settings + modal; loads at registration + session_start).
  initTodoSettings(pi);

  // Mutable state
  let items = [] as import("./types.js").TodoItem[];
  const uiRef = { current: null as ExtensionContext["ui"] | null };
  const lastKnownTokens = { value: null as number | null };
  const pendingCompact = { value: false };
  // Id of the item just completed — stashed by maybeCompactAfterComplete (hosted mode)
  // right before ctx.compact so the host's session_compact handler can render a `✅` line.
  const lastCompletedId = { value: null as string | null };

  // --- Persistence & widget commit ---

  const commitState = (ctx: ExtensionContext) => {
    updateWidget(ctx, items);
    persistState(pi, items);
  };

  // --- Settings access ---

  const getResetSetting = (): string => {
    return getTodoSettings().todoItemCompleteContextCompact || "none";
  };

  // --- API object ---
  // Closures over `items` — no refs needed since everything is in one scope.

  const api: PiTodoApi = {
    disableBuiltInFollowUp(): void {
      _setBuiltInFollowUpDisabled(true);
    },
    getCompletedItemId(): string | null {
      const id = lastCompletedId.value;
      lastCompletedId.value = null; // consume-on-read
      return id;
    },
    getInProgressItem(): string | null {
      const current = items.find((i) => i.status === "in_progress");
      if (!current) return null;
      return `In progress: ▶ ${current.id}: ${current.name}\n${current.details}`;
    },
    areAllTodosDone(): boolean {
      if (items.length === 0) return true;
      return items.every((i) => isTerminal(i.status));
    },
  };

  // Cache API for reload survival
  _state.cachedApi = api;

  // --- Browse commands: list/details via ui.notify (read-only) ---
  pi.registerCommand?.("todo:list", {
    description: "List todo items (optionally filtered by status)",
    handler: async (args: string) => {
      const { text, error } = runListCommand(items, args);
      uiRef.current?.notify(text, error ? "error" : "info");
    },
  });
  pi.registerCommand?.("todo:details", {
    description: "Show a todo item's full details by id",
    handler: async (args: string) => {
      const { text, error } = runDetailsCommand(items, args);
      uiRef.current?.notify(text, error ? "error" : "info");
    },
  });

  // --- Session handlers ---

  pi.on("session_start", async (event: { reason?: string }, ctx: ExtensionContext) => {
    uiRef.current = ctx.ui ?? null;
    // force-enable todo_* in subagents (runs every session_start, idempotent).
    contributeTodoExtraTools();
    // Reconstruct on reload / resume / startup. "startup" covers opening an existing
    // session via `pi --session`/`--continue`/`--fork` (the branch carries the last
    // persisted pi_todo entry); a clean new session has an empty branch → no items.
    // reconstructState enforces the subagent guard (returns [] when
    // PI_SUBAGENT_PARENT_PID is set), so a fork subagent — whose copied branch DOES
    // contain the host's todo entries — must never inherit them.
    if (event.reason === "reload" || event.reason === "resume" || event.reason === "startup") {
      const state = reconstructState(ctx);
      items = state.items;
      updateWidget(ctx, items);
    }
  });

  // Also handle session_tree for subagent context
  pi.on("session_tree", async (_event: unknown, ctx: ExtensionContext) => {
    const state = reconstructState(ctx);
    items = state.items;
    updateWidget(ctx, items);
  });

  // Reset compaction guard on session teardown to avoid leaked in-flight state
  pi.on("session_shutdown", () => {
    pendingCompact.value = false;
  });

  // --- Tool registrations ---

  pi.registerTool({
    name: "todo_init",
    label: "Todo Init",
    description:
      "Plan multi-stage work and stay on track in long sessions — completing an item surfaces the next one's details. Use once at the start (first item auto-starts as in_progress). If a plan already exists, new items are rejected: evolve it with todo_add / todo_complete. Pass items: [] to clear and start over.",
    parameters: InitParams,
    async execute(_toolCallId: string, params: InitInput, _signal: unknown, _onUpdate: unknown, ctx: ExtensionContext) {
      const result = handleInit(params, items, () => commitState(ctx));
      return result;
    },
    renderCall(args: unknown, theme: Theme) {
      return renderInitCall(args as Parameters<typeof renderInitCall>[0], theme);
    },
    renderResult(result: ToolResult, options: unknown, theme: Theme) {
      return renderInitResult(result, options as { expanded?: boolean }, theme);
    },
  });

  pi.registerTool({
    name: "todo_add",
    label: "Todo Add",
    description:
      "Add items to the plan. Use parentId to decompose a task into tracked sub-steps (the parent becomes a folder). Use beforeId to insert before a specific item (e.g. before the in-progress item for priority); omit to append.",
    parameters: AddParams,
    async execute(_toolCallId: string, params: AddInput, _signal: unknown, _onUpdate: unknown, ctx: ExtensionContext) {
      const result = handleAdd(params, items, () => commitState(ctx));
      return result;
    },
    renderCall(args: unknown, theme: Theme) {
      return renderAddCall(args as Parameters<typeof renderAddCall>[0], theme);
    },
    renderResult(result: ToolResult, options: unknown, theme: Theme) {
      return renderAddResult(result, options as { expanded?: boolean }, theme);
    },
  });

  pi.registerTool({
    name: "todo_move",
    label: "Todo Move",
    description:
      "Move existing items to a new position so work can be done sequentially — move blockers before the items they block, or blocked items after their blockers. Use parentId to reparent items under another item (the parent becomes a folder); use beforeId to insert before a specific item; omit to append to the top level. Each item moves with its whole subtree.",
    parameters: MoveParams,
    async execute(_toolCallId: string, params: MoveInput, _signal: unknown, _onUpdate: unknown, ctx: ExtensionContext) {
      const result = handleMove(params, items, () => commitState(ctx));
      return result;
    },
    renderCall(args: unknown, theme: Theme) {
      return renderMoveCall(args as Parameters<typeof renderMoveCall>[0], theme);
    },
    renderResult(result: ToolResult, options: unknown, theme: Theme) {
      return renderMoveResult(result, options as { expanded?: boolean }, theme);
    },
  });

  pi.registerTool({
    name: "todo_list",
    label: "Todo List",
    description: "View todo items. Supports filtering by status, parent, or ID range.",
    parameters: ListParams,
    async execute(
      _toolCallId: string,
      params: ListInput,
      _signal: unknown,
      _onUpdate: unknown,
      _ctx: ExtensionContext,
    ) {
      return handleList(params, items);
    },
    renderCall(args: unknown, theme: Theme) {
      return renderListCall(args as Parameters<typeof renderListCall>[0], theme);
    },
    renderResult(result: ToolResult, options: unknown, theme: Theme) {
      return renderListResult(result, options as { expanded?: boolean }, theme);
    },
  });

  pi.registerTool({
    name: "todo_complete",
    label: "Todo Complete",
    description:
      "Mark item completed. Completing an item shows the next in_progress item's details and switches your attention in a way that you will not be able to recall what was on your mind, thus, before calling it, ensure you persist new planned work as todo items/sub-items; persist findings, decisions, and user Q&A to a file.",
    parameters: CompleteParams,
    async execute(
      _toolCallId: string,
      params: CompleteInput,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      const result = await handleComplete(params, items, () => commitState(ctx), {
        ctx,
        getResetSetting,
        builtInFollowUpDisabled: _builtInFollowUpDisabled,
        lastKnownTokens,
        pendingCompact,
        lastCompletedId,
        pi,
      });
      // Handle all-done clear
      if (result.clearItems) {
        items = [];
      }
      return result;
    },
    renderCall(args: unknown, theme: Theme) {
      return renderCompleteCall(args as Parameters<typeof renderCompleteCall>[0], theme);
    },
    renderResult(result: ToolResult, options: unknown, theme: Theme) {
      return renderCompleteResult(result, options as { expanded?: boolean }, theme);
    },
  });

  // ---:ready event (always deferred to session_start) ---

  // Always defer:ready to session_start — ensures all consumers have registered listeners.
  // Clear hook arrays/flags unconditionally (no-op on first load, clears stale state on reload).
  _state.unsubs.push(
    safeOn(pi, "session_start", () => {
      _setBuiltInFollowUpDisabled(false);
      pi.events.emit("pi-todo:ready", api);
    }),
  );

  // Clean up on session shutdown
  _state.unsubs.push(
    safeOn(pi, "session_shutdown", () => {
      _state.cachedApi = null;
    }),
  );

  // Reset the reload-safe wiring guard so a fresh module load (e.g. /reload)
  // re-wires in full instead of short-circuiting on a stale globalThis flag.
  pi.on("session_shutdown", () => {
    g[WIRED_KEY] = false;
  });
}
