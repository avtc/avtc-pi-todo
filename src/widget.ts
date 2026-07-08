// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * TUI footer widget for todo items.
 */

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { formatWidget } from "./format.js";
import type { TodoItem } from "./types.js";

/** Clears the todo widget (no content) when the list becomes empty. */
const NO_WIDGET_CONTENT: Parameters<ExtensionContext["ui"]["setWidget"]>[1] = undefined;

export function updateWidget(ctx: ExtensionContext, items: TodoItem[]): void {
  if (!ctx.hasUI) return;
  if (items.length === 0) {
    ctx.ui.setWidget("todo", NO_WIDGET_CONTENT);
  } else {
    ctx.ui.setWidget("todo", (_tui: unknown, theme: Theme) => {
      return new Text(formatWidget(items, theme), 0, 0);
    });
  }
}
