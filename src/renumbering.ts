// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/** First array index — passed as the inclusive `start` of a rewrite range. */
const FIRST_INDEX = 0;

/** Rewrite a single id-referencing field (`id` or `parentId`) using idMap for items in [start, end). Skips parentId entries that are absent. */
function applyIdMapToField<T extends { id: string; parentId?: string }>(
  items: T[],
  idMap: Map<string, string>,
  start: number,
  end: number,
  field: "id" | "parentId",
): void {
  for (let i = start; i < end; i++) {
    const item = items[i];
    const key = item[field];
    if (key && idMap.has(key)) {
      // biome-ignore lint/style/noNonNullAssertion: idMap.has(key) guarantees a value
      item[field] = idMap.get(key)!;
    }
  }
}

export function renumberTree<T extends { id: string; parentId?: string }>(items: T[]): void {
  // Pass 1: assign new IDs, keyed by OLD id (children look up their parent's
  // OLD parentId in this map to find its already-assigned NEW id).
  const idMap = new Map<string, string>();
  const childCounter = new Map<string, number>();
  let topCounter = 1;

  for (const item of items) {
    let newId: string;
    if (item.parentId === undefined) {
      newId = `${topCounter++}`;
    } else {
      const newParentId = idMap.get(item.parentId);
      if (newParentId === undefined) {
        // Defensive: orphaned child (parent missing/not yet seen) — treat as
        // top-level rather than corrupting the tree. Should not happen given
        // the precondition, but keeps the pass total instead of throwing.
        newId = `${topCounter++}`;
      } else {
        const next = (childCounter.get(newParentId) ?? 0) + 1;
        childCounter.set(newParentId, next);
        newId = `${newParentId}.${next}`;
      }
    }
    idMap.set(item.id, newId);
  }

  // Pass 2: rewrite id + parentId using the old→new map (shared helpers).
  applyIdMapToField(items, idMap, FIRST_INDEX, items.length, "id");
  applyIdMapToField(items, idMap, FIRST_INDEX, items.length, "parentId");
}
