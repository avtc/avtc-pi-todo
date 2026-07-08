// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <avtc-pi-todo>

/**
 * Slash-command handlers (`/todo:list`, `/todo:details`) — expose the todo list to the
 * USER via `ui.notify`, using the same formatting path as the agent tools (`format.ts`),
 * so list/detail look identical whether shown to the agent (tool result) or the user (notify).
 * Read-only, no state mutation.
 */

import { formatItemList, formatItemListWithDetails } from "./format.js";
import type { TodoItem } from "./types.js";

/** Command result: `text` to display via ui.notify; `error` selects the notify severity. */
export interface CommandResult {
  text: string;
  error: boolean;
}

/** Valid status values for filtering. "completed" includes decomposed items. */
type TodoListStatus = "pending" | "in_progress" | "completed";

/**
 * `/todo:list {status?}` — list todo items, optionally filtered by status.
 * When no items exist, returns an informative message.
 */
export function runListCommand(items: TodoItem[], args: string): CommandResult {
  if (items.length === 0) {
    return { text: "No todos active. Use todo_init to create a list.", error: false };
  }

  const status = args.trim() as TodoListStatus | "";
  const validStatuses: readonly string[] = ["pending", "in_progress", "completed"];

  let displayItems: TodoItem[];
  let header = "";

  if (status) {
    if (!validStatuses.includes(status)) {
      return {
        text: `Invalid status '${status}'. Valid values: ${validStatuses.join(", ")}`,
        error: true,
      };
    }
    displayItems = items.filter((i) => {
      if (status === "completed") return i.status === "completed" || i.status === "decomposed";
      return i.status === status;
    });
    header = `${status} items: ${displayItems.length}.\n`;
  } else {
    displayItems = items;
  }

  const listText = formatItemList(displayItems);
  return { text: `${header}${listText}`, error: false };
}

/**
 * `/todo:details {id}` — show a single todo item's full details (status, id, name, details).
 * Error result when the id is missing or not found.
 */
export function runDetailsCommand(items: TodoItem[], args: string): CommandResult {
  const id = args.trim();
  if (id.length === 0) {
    return { text: "Usage: /todo:details {id}", error: true };
  }

  const item = items.find((i) => i.id === id);
  if (!item) {
    return { text: `No todo item '${id}'.`, error: true };
  }

  return { text: formatItemListWithDetails([item]), error: false };
}
