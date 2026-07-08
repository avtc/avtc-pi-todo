// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Formatting helpers for todo items.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { getItemDepth, isTerminal } from "./id-helpers.js";
import type { TodoItem } from "./types.js";

// ---------------------------------------------------------------------------
// Status icons
// ---------------------------------------------------------------------------

export const STATUS_ICONS: Record<string, string> = {
  pending: "○",
  in_progress: "▶",
  completed: "✅",
  decomposed: "📁",
};

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export function formatItemList(items: TodoItem[]): string {
  if (items.length === 0) return "No todos active.";
  return items
    .map((item) => {
      const indent = "  ".repeat(getItemDepth(item.id));
      return `${indent}${STATUS_ICONS[item.status] ?? "○"} ${item.id} ${item.name}`;
    })
    .join("\n");
}

/** Format items with full details (one item per block, indented to its depth). */
export function formatItemListWithDetails(items: TodoItem[]): string {
  if (items.length === 0) return "No items.";
  return items
    .map((item) => {
      const indent = "  ".repeat(getItemDepth(item.id));
      return `${indent}${STATUS_ICONS[item.status] ?? "○"} ${item.id} ${item.name}\n${indent}${item.details}`;
    })
    .join("\n");
}

export function formatWidget(items: TodoItem[], theme: Theme): string {
  if (items.length === 0) return "";
  const done = items.filter((i) => isTerminal(i.status)).length;
  const current = items.find((i) => i.status === "in_progress");
  const currentName = current ? ` ▶ ${current.id}: ${current.name}` : "";
  return `${theme.fg("muted", "TODO:")} ${done}/${items.length}${currentName}`;
}

export function formatAllDoneSummary(items: TodoItem[]): string {
  const tree = formatItemList(items);
  return `${tree}\n\nAll todos done. List cleared. Review if nothing missed and proceed.`;
}
