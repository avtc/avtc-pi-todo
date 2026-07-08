// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

// Pure functions for dotted ID manipulation. No imports from other project modules.

export const TODO_STATUSES = ["pending", "in_progress", "completed", "decomposed"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

/** Type guard: checks if a value is a valid TodoStatus. */
export function isValidStatus(value: string): value is TodoStatus {
  return (TODO_STATUSES as readonly string[]).includes(value);
}

/** Terminal statuses: items that are done (won't be worked on further). */
export function isTerminal(status: TodoStatus): boolean {
  return status === "completed" || status === "decomposed";
}

export function parseId(id: string): string[] {
  return id.split(".");
}

/** Returns the nesting depth of an item: top-level = 0, "1.2" = 1, "1.2.3" = 2. */
export function getItemDepth(id: string): number {
  return parseId(id).length - 1;
}

/**
 * Returns true if `childId` is a strict descendant of `ancestorId`.
 * Appends "." to ancestorId before prefix matching so "10.1" is NOT
 * treated as a descendant of "1".
 */
export function isDescendantOf(childId: string, ancestorId: string): boolean {
  return childId.startsWith(`${ancestorId}.`);
}

export function getParentId(id: string): string | undefined {
  const parts = parseId(id);
  if (parts.length <= 1) return undefined;
  return parts.slice(0, -1).join(".");
}

/**
 * Find the index just past the end of a node's subtree.
 * Scans forward from `startIndex` until an item is found that is NOT
 * a descendant of `anchorId`. Returns the index after the last descendant.
 */
export function findSubtreeEndIndex(
  items: ReadonlyArray<{ id: string }>,
  anchorId: string,
  startIndex: number,
): number {
  let insertAt = startIndex;
  for (let i = startIndex; i < items.length; i++) {
    if (isDescendantOf(items[i].id, anchorId)) insertAt = i + 1;
    else break;
  }
  return insertAt;
}
