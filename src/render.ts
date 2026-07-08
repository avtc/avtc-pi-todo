// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Tool render functions for all 5 todo tools.
 *
 * Renders from `details.displayText` — the handler populates it with the
 * full formatted text so the user sees exactly what the model sees.
 * Falls back to `details.items` summary counts for legacy results.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { formatItemList } from "./format.js";
import { isTerminal } from "./id-helpers.js";
import type { TodoItem, ToolResult } from "./types.js";

// Maximum number of lines to show in collapsed (non-expanded) mode
const COLLAPSED_LINE_LIMIT = 12;

/**
 * Truncate text to a maximum number of lines.
 * Returns { text, truncated } with the truncated text and whether truncation occurred.
 */
function truncateLines(text: string, maxLines: number): { text: string; truncated: boolean } {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return { text, truncated: false };
  return {
    text: lines.slice(0, maxLines).join("\n"),
    truncated: true,
  };
}

// ---------------------------------------------------------------------------
// todo_init
// ---------------------------------------------------------------------------

export function renderInitCall(args: { items: { name: string }[] }, theme: Theme): Text {
  return new Text(
    theme.fg("toolTitle", theme.bold("todo_init ")) + theme.fg("dim", `(${args.items.length} items)`),
    0,
    0,
  );
}

export function renderInitResult(result: ToolResult, _options: { expanded?: boolean }, theme: Theme): Text {
  return renderTodoResultFallback(result, _options, theme, "Todo list cleared");
}

// ---------------------------------------------------------------------------
// todo_add
// ---------------------------------------------------------------------------

export function renderAddCall(
  args: { items: { name: string }[]; parentId?: string; beforeId?: string },
  theme: Theme,
): Text {
  let text = theme.fg("toolTitle", theme.bold("todo_add ")) + theme.fg("dim", `(${args.items.length} items)`);
  if (args.parentId) text += ` ${theme.fg("dim", `child of ${args.parentId}`)}`;
  if (args.beforeId) text += ` ${theme.fg("dim", `before ${args.beforeId}`)}`;
  return new Text(text, 0, 0);
}

export function renderAddResult(result: ToolResult, _options: { expanded?: boolean }, theme: Theme): Text {
  return renderTodoResultFallback(result, _options, theme, "Item(s) added");
}

// ---------------------------------------------------------------------------
// todo_move
// ---------------------------------------------------------------------------

export function renderMoveCall(args: { ids: string[]; parentId?: string; beforeId?: string }, theme: Theme): Text {
  const count = args.ids.length;
  let text =
    theme.fg("toolTitle", theme.bold("todo_move ")) + theme.fg("dim", `(${count} item${count === 1 ? "" : "s"})`);
  if (args.parentId) text += ` ${theme.fg("dim", `under ${args.parentId}`)}`;
  if (args.beforeId) text += ` ${theme.fg("dim", `before ${args.beforeId}`)}`;
  return new Text(text, 0, 0);
}

export function renderMoveResult(result: ToolResult, _options: { expanded?: boolean }, theme: Theme): Text {
  return renderTodoResultFallback(result, _options, theme, "Item(s) moved");
}

// ---------------------------------------------------------------------------
// todo_list
// ---------------------------------------------------------------------------

export function renderListCall(
  args: { status?: string; fromId?: string; toId?: string; parentId?: string },
  theme: Theme,
): Text {
  let text = theme.fg("toolTitle", theme.bold("todo_list"));
  if (args.status) text += ` ${theme.fg("dim", args.status)}`;
  return new Text(text, 0, 0);
}

/**
 * Shared preamble for result renderers that drive off result.details: fall back to content
 * when there are no details (or an error), honor a handler displayText, or report an empty
 * state. Returns the items array for the caller to render a summary, or a final Text.
 */
function renderDetailsPreamble(
  result: ToolResult,
  options: { expanded?: boolean },
  theme: Theme,
  emptyMessage: string,
): Text | TodoItem[] {
  const details = result.details;
  if (!details || details.error) return renderFromContent(result, theme);
  if (details.displayText) return renderTextWithTruncation(details.displayText, options, theme);
  const items = details.items;
  if (items.length === 0) return new Text(theme.fg("muted", emptyMessage), 0, 0);
  return items;
}

export function renderListResult(result: ToolResult, _options: { expanded?: boolean }, theme: Theme): Text {
  const items = renderDetailsPreamble(result, _options, theme, "No items.");
  if (!Array.isArray(items)) return items;
  return new Text(theme.fg("muted", formatItemList(items)), 0, 0);
}

// ---------------------------------------------------------------------------
// todo_complete
// ---------------------------------------------------------------------------

export function renderCompleteCall(args: { id: string }, theme: Theme): Text {
  return new Text(theme.fg("toolTitle", theme.bold("todo_complete ")) + theme.fg("accent", args.id), 0, 0);
}

export function renderCompleteResult(result: ToolResult, _options: { expanded?: boolean }, theme: Theme): Text {
  const items = renderDetailsPreamble(result, _options, theme, "All todos done");
  if (!Array.isArray(items)) return items;
  const done = items.filter((i) => isTerminal(i.status)).length;
  return new Text(theme.fg("muted", `Completed (${done}/${items.length} done)`), 0, 0);
}

// ---------------------------------------------------------------------------
// Shared fallback — renders from content text (for error messages, all-done summary)
// ---------------------------------------------------------------------------

/**
 * Render text with truncation in collapsed mode.
 * In collapsed mode: limit to COLLAPSED_LINE_LIMIT lines, append expand hint.
 * In expanded mode (or when text fits): show full text.
 */
function renderTextWithTruncation(text: string, options: { expanded?: boolean }, theme: Theme): Text {
  const expanded = options.expanded ?? false;
  if (expanded) {
    return new Text(theme.fg("muted", text), 0, 0);
  }
  const { text: truncatedText, truncated } = truncateLines(text, COLLAPSED_LINE_LIMIT);
  if (!truncated) {
    return new Text(theme.fg("muted", truncatedText), 0, 0);
  }
  return new Text(theme.fg("muted", `${truncatedText}\n(Ctrl+O to expand)`), 0, 0);
}

function renderFromContent(result: ToolResult, theme: Theme): Text {
  // Find the last text content (skip any injected context at the start)
  const textItems = result.content?.filter((c) => c.type === "text") ?? [];
  const lastText = textItems.length > 0 ? textItems[textItems.length - 1].text : "";
  return new Text(theme.fg("muted", lastText), 0, 0);
}

/** Shared result renderer for todo_init/add/move: error→content, displayText→truncated, else items summary (or `emptyMessage` when no items). */
function renderTodoResultFallback(
  result: ToolResult,
  options: { expanded?: boolean },
  theme: Theme,
  emptyMessage: string,
): Text {
  const details = result.details;
  if (details?.error) return renderFromContent(result, theme);
  // Primary: use displayText from handler
  if (details?.displayText) {
    return renderTextWithTruncation(details.displayText, options, theme);
  }
  // Fallback: items summary
  const items = details?.items ?? [];
  if (items.length > 0) {
    return new Text(theme.fg("muted", formatItemList(items)), 0, 0);
  }
  return new Text(theme.fg("muted", emptyMessage), 0, 0);
}
