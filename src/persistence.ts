// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Todo state persistence and reconstruction.
 *
 * Uses pi.appendEntry (session storage) only — NO feature-state.
 * Survives /reload via session file. Does NOT survive /new (by design).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isValidStatus } from "./id-helpers.js";
import type { RawTodoItem, TodoItem } from "./types.js";
import { TODO_ENTRY_TYPE } from "./types.js";

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export function migrateItem(item: RawTodoItem): TodoItem {
  const id = typeof item.id === "number" ? `${item.id}` : (item.id ?? "");
  return {
    id,
    parentId: item.parentId ?? undefined,
    name: item.name ?? "",
    details: item.details ?? "",
    status: item.status === "skipped" ? "completed" : isValidStatus(item.status) ? item.status : "pending",
  };
}

// ---------------------------------------------------------------------------
// Persist
// ---------------------------------------------------------------------------

export function persistState(pi: ExtensionAPI, items: TodoItem[]): void {
  try {
    pi.appendEntry(TODO_ENTRY_TYPE, { items });
  } catch {
    // silently ignore — best-effort persistence
  }
}

// ---------------------------------------------------------------------------
// Reconstruct
// ---------------------------------------------------------------------------

/**
 * Walk the session branch in reverse and return the data from the latest
 * custom entry matching `customType`, or `undefined` if not found.
 */
function findLatestCustomEntry<T = unknown>(ctx: ExtensionContext, customType: string): T | undefined {
  try {
    const branch = ctx.sessionManager.getBranch();
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i] as { type: string; customType?: string; data?: unknown };
      if (entry.type === "custom" && entry.customType === customType) {
        return entry.data as T;
      }
    }
  } catch {
    // silently ignore — best-effort reconstruction
  }
  return undefined;
}

export function reconstructState(ctx: ExtensionContext): { items: TodoItem[] } {
  // Subagent sessions fork the parent session and would otherwise inherit the parent's
  // todo list. A subagent has its own task scope (conveyed via its dispatch prompt) and
  // must never see or continue the parent's feature-level task list.
  if (process.env.PI_SUBAGENT_PARENT_PID !== undefined) {
    return { items: [] };
  }

  // Priority: Walk branch for latest pi_todo entry
  try {
    const data = findLatestCustomEntry<{ items: RawTodoItem[] }>(ctx, TODO_ENTRY_TYPE);
    if (data?.items && Array.isArray(data.items)) {
      const items = data.items.map((raw) => migrateItem(raw));
      return { items };
    }
  } catch {
    // silently ignore — return empty state
  }

  // Default: empty state
  return { items: [] };
}
