// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Todo tool action handlers.
 *
 * Pure logic: init, add, list, complete.
 * Compact triggering lives here (core todo behavior), but the followUp
 * message delivery strategy is controlled by builtInFollowUpDisabled flag.
 */

import type { ContextUsage, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatAllDoneSummary, formatItemList, formatItemListWithDetails, STATUS_ICONS } from "./format.js";
import { findSubtreeEndIndex, getParentId, isDescendantOf, isTerminal } from "./id-helpers.js";
import { renumberTree } from "./renumbering.js";
import type { AddInput, CompleteInput, InitInput, ListInput, MoveInput, TodoItem, ToolResult } from "./types.js";

/** Build the standard error result shape shared by handleAdd/handleMove (content + details with snapshot). */
function makeErrorResult(items: TodoItem[], msg: string): ToolResult {
  return {
    content: [textContent(msg)],
    details: { items: [...items], error: true, displayText: msg },
  };
}

/**
 * How long the standalone post-compaction follow-up is deferred before inject (ms).
 *
 * The follow-up is injected from ctx.compact's onComplete callback, which fires in the same
 * microtask window as the TUI's flushCompactionQueue (compaction_end → sends a user steer typed
 * DURING compaction as a prompt). Injecting synchronously there races the steer prompt and hangs
 * it (the follow-up wins the turn). Deferring by this delay lets the steer's turn reach
 * isStreaming=true first, so sendUserMessage enqueues as a followUp (drained after the steer)
 * instead of starting a competing turn. In the no-steer case the agent is idle at fire time, so
 * sendUserMessage sends it as a prompt and starts the follow-up turn itself — it self-adapts, no
 * steer/no-steer detection needed. Must exceed the steer prompt's prep window (sub-ms for sync
 * handlers), so 500ms is ample margin. Exported so tests advance fake timers by the real value.
 */
export const DEFERRED_COMPACT_FOLLOWUP_MS = 500;

/** Format the promoted-item suffix appended to add/move display text (highlights the auto-promoted next task). */
function promotedSuffix(promoted: TodoItem | null): string {
  return promoted ? `\n\nIn progress: ▶ ${promoted.id}: ${promoted.name}\n${promoted.details}` : "";
}

/** Shared dependencies for completion logic (context-compact detection + followUp/compact delivery). Passed to handleComplete and maybeCompactAfterComplete. */
interface CompleteDeps {
  ctx: ExtensionContext;
  getResetSetting: () => string;
  builtInFollowUpDisabled: boolean;
  lastKnownTokens: { value: number | null };
  pendingCompact: { value: boolean };
  /** Id of the item just completed — stashed here (hosted mode) so the host's session_compact
   *  handler can read it via getCompletedItemId() and include a `✅` line. Consume-on-read. */
  lastCompletedId: { value: string | null };
  pi: Pick<ExtensionAPI, "sendUserMessage">;
}

import { textContent } from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * After every action, if no in_progress item exists but pending items remain,
 * auto-promote the first pending (by list position) to in_progress.
 *
 * **Mutates `items` in-place** — sets `first.status = "in_progress"` directly
 * on the array element, then returns a reference to the mutated item.
 *
 * Returns the promoted item (if any) for injection, or null if no promotion occurred.
 */
export function autoAdvance(items: TodoItem[]): TodoItem | null {
  if (items.some((i) => i.status === "in_progress")) return null;
  const first = items.find((i) => i.status === "pending");
  if (!first) return null;
  first.status = "in_progress";
  return first;
}

/**
 * Enforce the single-in_progress invariant: exactly one item — the FIRST
 * non-terminal item in list order — is `in_progress`; every other non-terminal
 * item is `pending`. Terminal items (completed/decomposed) are untouched.
 *
 * Stronger than `autoAdvance` (which only promotes when zero in_progress exist):
 * this also demotes a stale in_progress that is no longer first. This is what
 * `todo_move` and `todo_add` (beforeId) need, because inserting/moving a pending
 * item ahead of the current in_progress must re-elect the new first item.
 *
 * **Mutates `items` in-place.** Returns the promoted item ONLY when a status
 * actually changed (mirrors `autoAdvance`'s null-when-noop contract so callers
 * can decide whether to render a `▶` line).
 */
export function normalizeInProgress(items: TodoItem[]): TodoItem | null {
  const firstIdx = items.findIndex((i) => !isTerminal(i.status));
  if (firstIdx === -1) return null;
  let changed = false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (isTerminal(item.status)) continue;
    const want = i === firstIdx ? "in_progress" : "pending";
    if (item.status !== want) {
      item.status = want;
      changed = true;
    }
  }
  return changed ? items[firstIdx] : null;
}

function checkAllDone(items: TodoItem[]): boolean {
  return items.length > 0 && items.every((i) => isTerminal(i.status));
}

/**
 * Check if all items are terminal (completed/decomposed). If so, generate summary
 * and return the response to send along with cleared state values.
 * The caller is responsible for applying the state clear.
 */
export function handleAllDone(
  items: TodoItem[],
): { content: { type: "text"; text: string }[]; details: { items: TodoItem[]; displayText: string } } | null {
  if (!checkAllDone(items)) return null;
  const summary = formatAllDoneSummary(items);
  return {
    content: [textContent(summary)],
    details: { items: [...items], displayText: summary },
  };
}

// ---------------------------------------------------------------------------
// Context compact helper
// ---------------------------------------------------------------------------

/** Parse a context compact value like "compact>75K" into mode and threshold. */
export function parseContextCompactValue(value: string): { mode: "none" | "compact"; threshold: number | null } {
  if (value === "none") return { mode: "none", threshold: null };
  if (value === "compact") return { mode: "compact", threshold: null };
  const match = /^compact>(\d+)K$/.exec(value);
  if (match) return { mode: "compact", threshold: parseInt(match[1], 10) * 1000 };
  return { mode: "none", threshold: null };
}

/**
 * Check todoItemCompleteContextCompact setting and trigger compact if needed.
 * Called after a todo item is completed and a new item is promoted to in_progress.
 * Uses `pendingCompact` guard to prevent duplicate compaction when multiple
 * todo_complete calls execute in the same turn (only the first eligible call
 * triggers compact; subsequent calls are skipped until compact finishes).
 * The `getPromotedItem` getter is evaluated lazily at callback time so the
 * followUp reflects the final in_progress item after all batched completes.
 * Returns true if compact was triggered (result should be minimal).
 *
 * `completedId` is the item just completed. In hosted mode it is stashed into
 * `lastCompletedId` right before ctx.compact() (and cleared in onComplete/onError
 * so a cancelled compact can't leak a stale `✅`); the host's session_compact
 * handler reads it via getCompletedItemId(). In standalone mode the full
 * followUp (framing + ✅ + In progress) is built here.
 */
export async function maybeCompactAfterComplete(
  getPromotedItem: () => TodoItem | null,
  deps: CompleteDeps,
  completedId: string,
): Promise<boolean> {
  const { getResetSetting, ctx, builtInFollowUpDisabled, lastKnownTokens, pendingCompact, lastCompletedId, pi } = deps;
  const resetSetting = getResetSetting();
  if (!getPromotedItem()) return false;
  if (resetSetting === "none") return false;

  // Re-entrancy guard: at most one compact per turn. The reservation is set synchronously
  // (before any await) so concurrent todo_complete calls in the same turn can't all pass
  // this check while awaiting getContextUsage and fire N concurrent ctx.compact() calls.
  if (pendingCompact.value) {
    return false;
  }

  const { mode, threshold } = parseContextCompactValue(resetSetting);
  if (mode !== "compact") return false;

  // Reserve before the first await. Every non-trigger exit below MUST release the reservation,
  // or the guard leaks and blocks all future compaction.
  pendingCompact.value = true;

  // Check threshold if applicable
  if (threshold !== null) {
    let usage: ContextUsage | null = null;
    if (ctx.getContextUsage) {
      try {
        usage = (await ctx.getContextUsage()) ?? null;
      } catch (err) {
        pendingCompact.value = false;
        throw err;
      }
    }
    const tokens = usage?.tokens ?? lastKnownTokens.value;
    if (!tokens || tokens <= threshold) {
      if (usage?.tokens) lastKnownTokens.value = usage.tokens;
      pendingCompact.value = false;
      return false;
    }
    lastKnownTokens.value = tokens;
  }

  const useCustomFollowUp = builtInFollowUpDisabled;

  // compact() aborts the agent's current turn up front (await this.abort()), so on ANY
  // failure (cancel, nothing-to-compact, mid-summarization API error) the turn is dead
  // and must be resumed. In a subagent the process-runner's settle timer is the fallback,
  // but in the main session nothing else resumes — neither the host (session_compact fires
  // only on success) nor a manual /compact path. Deferred so a user steer typed during
  // compaction is delivered first (mirrors onComplete's deferred inject).
  const resumeAfterFailedCompact = () => {
    setTimeout(
      () => pi.sendUserMessage("Continue from where you left off.", { deliverAs: "followUp" }),
      DEFERRED_COMPACT_FOLLOWUP_MS,
    );
  };

  try {
    // pendingCompact was reserved above (before the getContextUsage await).
    // Reset cache to null to avoid compact loop after this compact completes
    lastKnownTokens.value = null;

    if (useCustomFollowUp) {
      // Hosted mode: compact without onComplete, host's session_compact handler builds combined message.
      // Stash the completed id so the host can render a `✅` line; clear in both callbacks so a
      // cancelled compact (session_before_compact returns cancel) can't leak a stale id.
      lastCompletedId.value = completedId;
      ctx.compact({
        onComplete: () => {
          pendingCompact.value = false;
          lastCompletedId.value = null;
        },
        onError: (_err: Error) => {
          pendingCompact.value = false;
          lastCompletedId.value = null;
          resumeAfterFailedCompact();
        },
      });
    } else {
      // Standalone mode: build the full followUp (framing + ✅ completed + In progress) and send it.
      // Read promoted item lazily at callback time so the followUp reflects
      // the final in_progress item after all batched todo_complete calls.
      ctx.compact({
        onComplete: () => {
          pendingCompact.value = false;
          const current = getPromotedItem();
          if (!current) {
            return;
          }
          const msg = `Context was compacted. Continue from where you left off.\n✅ ${completedId}\nIn progress: ▶ ${current.id}: ${current.name}\n${current.details}`;
          // Defer the inject so a user steer typed during compaction is delivered first (see
          // DEFERRED_COMPACT_FOLLOWUP_MS). onComplete fires right after compaction_end, racing
          // flushCompactionQueue's steer prompt; the delay lets the steer's turn start first.
          setTimeout(() => pi.sendUserMessage(msg, { deliverAs: "followUp" }), DEFERRED_COMPACT_FOLLOWUP_MS);
        },
        onError: (_err: Error) => {
          pendingCompact.value = false;
          resumeAfterFailedCompact();
        },
      });
    }
  } catch {
    pendingCompact.value = false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

export function handleInit(params: InitInput, items: TodoItem[], commitState: () => void): ToolResult {
  const errorResult = (msg: string, displayItems: TodoItem[] | null): ToolResult => ({
    content: [textContent(msg)],
    details: { items: displayItems ? [...displayItems] : [...items], error: true, displayText: msg },
  });

  // Unfinished = in_progress + pending (what the agent would lose on clear)
  const unfinished = () => items.filter((i) => i.status === "in_progress" || i.status === "pending");

  if (params.items.length > 0) {
    // Non-empty items: only valid when no plan exists yet.
    if (items.length > 0) {
      const unf = unfinished();
      const list = formatItemListWithDetails(unf);
      const msg =
        `A plan already exists (${unf.length} unfinished item(s)). todo_init won't replace it — ` +
        "evolve it with todo_add (use beforeId to insert priority items before the in-progress one), " +
        `or pass items: [] to clear and start over.\n\n${list}`;
      return errorResult(msg, items);
    }

    // Create fresh list
    items.length = 0;
    let n = 1;
    for (const inputItem of params.items) {
      items.push({
        id: `${n++}`,
        name: inputItem.name,
        details: inputItem.details ?? "",
        status: "pending",
      });
    }
    items[0].status = "in_progress";
    commitState();

    const firstItem = items[0];
    const displayText = `${formatItemList(items)}\n\nIn progress: ▶ ${firstItem.id}: ${firstItem.name}\n${firstItem.details}`;
    return {
      content: [textContent(displayText)],
      details: { items: [...items], displayText },
    };
  }

  // items: []
  if (items.length === 0) {
    const displayText = "No existing plan to clear. Call todo_init with your planned items to create one.";
    return {
      content: [textContent(displayText)],
      details: { items: [], displayText },
    };
  }

  // Clear: capture unfinished first, then wipe state.
  const cleared = unfinished();
  const list = formatItemListWithDetails(cleared);
  items.length = 0;
  commitState();

  const displayText = `Cleared ${cleared.length} unfinished item(s). Review them — if still relevant, re-add via todo_add.\n\n${list}`;
  return {
    content: [textContent(displayText)],
    details: { items: [], displayText },
  };
}

export function handleList(params: ListInput, items: TodoItem[]): ToolResult {
  if (items.length === 0) {
    const displayText = "No todos active. Use todo_init to create a list.";
    return {
      content: [textContent(displayText)],
      details: { items: [], displayText },
    };
  }

  let displayItems = [...items];
  let header = "";

  // parentId filter: direct children only
  if (params.parentId) {
    displayItems = displayItems.filter((i) => i.parentId === params.parentId);
    header += `Children of '${params.parentId}': ${displayItems.length} items.\n`;
  }

  // status filter
  if (params.status) {
    if (params.status === "completed") {
      displayItems = displayItems.filter((i) => i.status === "completed" || i.status === "decomposed");
    } else {
      displayItems = displayItems.filter((i) => i.status === params.status);
    }
    header += `${params.status} items: ${displayItems.length}.\n`;
  }

  // fromId/toId positional range
  if (params.fromId || params.toId) {
    const fromIdx = params.fromId ? items.findIndex((i) => i.id === params.fromId) : 0;
    const toIdx = params.toId ? items.findIndex((i) => i.id === params.toId) : items.length;
    const notFound: string[] = [];
    if (params.fromId && fromIdx === -1) notFound.push(`fromId '${params.fromId}'`);
    if (params.toId && toIdx === -1) notFound.push(`toId '${params.toId}'`);
    const start = fromIdx === -1 ? 0 : fromIdx;
    const end = toIdx === -1 ? items.length : toIdx;
    displayItems = displayItems.filter((i) => {
      const idx = items.indexOf(i);
      return idx >= start && idx < end;
    });
    header += `Showing ${displayItems.length} of ${items.length} items (${params.fromId ?? "start"}–${params.toId ?? "end"}).\n`;
    if (notFound.length > 0) header += `Note: ${notFound.join(", ")} not found — showing full range from that end.\n`;
  }

  const listText = params.details ? formatItemListWithDetails(displayItems) : formatItemList(displayItems);

  const displayText = `${header}${listText}`;
  return {
    content: [textContent(displayText)],
    details: {
      items: displayItems.map((i) => ({ ...i })),
      total: items.length,
      displayText,
    },
  };
}

export function handleAdd(params: AddInput, items: TodoItem[], commitState: () => void): ToolResult {
  // jscpd:ignore-start — signature + errorResult setup are intentionally parallel to handleMove (same dependency shape, same error helper); the two handlers diverge in body logic
  const errorResult = (msg: string): ToolResult => makeErrorResult(items, msg);
  // jscpd:ignore-end

  if (params.items.length === 0) {
    return errorResult("Error: items array must not be empty");
  }

  // Resolve destination — validate each anchor once, then resolve insertion.
  // When both parentId and beforeId are provided, beforeId must be a DIRECT
  // child of parentId (inserts before beforeId as a child of parentId); a
  // deeper descendant would corrupt the depth-first contiguity invariant, so
  // it is rejected. When only parentId → insert at end of parent's subtree.
  // When only beforeId → insert as siblings before the target.
  // New items get temporary unique ids (?0, ?1, ...) with the correct parentId;
  // renumberTree then assigns their real positional ids in one pass — identical
  // to the old per-path arithmetic for the contiguous lists the tools produce
  // (gaps can't arise: no delete, every op yields contiguous ids), and it
  // self-heals any legacy/gapped restored data by normalizing it.

  // --- Validate parentId (if provided) ---
  let parentRef: TodoItem | undefined;
  if (params.parentId) {
    parentRef = items.find((i) => i.id === params.parentId);
    if (!parentRef) {
      return errorResult(`Error: parent ID '${params.parentId}' not found`);
    }
    if (parentRef.status === "completed") {
      return errorResult(`Error: cannot add children to completed item '${params.parentId}'`);
    }
  }

  // --- Validate beforeId (if provided): existence + direct-child-of-parentId ---
  let beforeIndex = -1;
  if (params.beforeId) {
    beforeIndex = items.findIndex((i) => i.id === params.beforeId);
    if (beforeIndex === -1) {
      return errorResult(`Error: beforeId '${params.beforeId}' not found`);
    }
    // When both provided, beforeId must be a direct child of parentId.
    if (params.parentId && getParentId(params.beforeId) !== params.parentId) {
      return errorResult(
        `Error: beforeId '${params.beforeId}' is not a direct child of parentId '${params.parentId}' — ` +
          "beforeId must be a child of parentId when both are specified",
      );
    }
  }

  // --- Resolve insertion point + parent ---
  let insertAt: number;
  let newParentId: string | undefined;

  if (beforeIndex !== -1) {
    insertAt = beforeIndex;
    newParentId = params.parentId ?? getParentId(items[beforeIndex].id);
  } else if (params.parentId) {
    const parentIndex = items.findIndex((i) => i.id === params.parentId);
    insertAt = findSubtreeEndIndex(items, params.parentId, parentIndex + 1);
    newParentId = params.parentId;
  } else {
    // append to end of top-level
    insertAt = items.length;
    newParentId = undefined;
  }

  // --- Decompose parent (adding children turns it into a folder) ---
  if (parentRef && parentRef.status !== "decomposed") {
    parentRef.status = "decomposed";
  }

  const newItems: TodoItem[] = params.items.map((inputItem, i) => ({
    id: `?${i}`, // temporary; renumberTree assigns the positional id
    parentId: newParentId,
    name: inputItem.name,
    details: inputItem.details ?? "",
    status: "pending",
  }));

  items.splice(insertAt, 0, ...newItems);
  renumberTree(items);

  const promoted = normalizeInProgress(items);
  commitState();

  let displayText = "";
  if (params.parentId) {
    const parent = items.find((i) => i.id === params.parentId);
    const descendants = items.filter((i) => i.parentId === params.parentId);
    if (parent) {
      displayText += `${STATUS_ICONS[parent.status]} ${parent.id} ${parent.name}\n`;
      displayText += formatItemList(descendants);
    } else {
      displayText += formatItemList(newItems);
    }
  } else {
    displayText += formatItemList(newItems);
  }
  displayText += promotedSuffix(promoted);

  return {
    content: [textContent(displayText)],
    details: { items: [...items], newItems: newItems.map((i) => i.id), displayText },
  };
}

export async function handleComplete(
  params: CompleteInput,
  items: TodoItem[],
  commitState: () => void,
  deps: CompleteDeps,
): Promise<ToolResult & { clearItems: boolean }> {
  const errorResult = (msg: string): ToolResult & { clearItems: boolean } => ({
    content: [textContent(msg)],
    details: { items: [...items], error: true, displayText: msg },
    clearItems: false,
  });

  const item = items.find((i) => i.id === params.id);
  if (!item) {
    return errorResult(`Error: invalid ID '${params.id}'. Valid IDs: ${items.map((i) => i.id).join(", ")}`);
  }

  // Already terminal — no-op
  if (isTerminal(item.status)) {
    commitState();
    const displayText = `✅ ${params.id}`;
    return {
      content: [textContent(displayText)],
      details: { items: [...items], displayText },
      clearItems: false,
    };
  }

  // Reject completing parents with non-terminal children
  const nonTerminalChildren = items.filter((i) => i.parentId === params.id && !isTerminal(i.status));
  if (nonTerminalChildren.length > 0) {
    const pendingIds = nonTerminalChildren.map((c) => c.id).join(", ");
    return errorResult(
      `Error: cannot complete '${params.id}' — has pending children: ${pendingIds}. Complete children first.`,
    );
  }

  // Mark completed
  item.status = "completed";

  // Auto-advance
  const promoted = autoAdvance(items);

  // Check all-done
  const allDoneResult = handleAllDone(items);
  if (allDoneResult) {
    items.length = 0;
    commitState();
    return {
      ...allDoneResult,
      clearItems: true,
    };
  }

  commitState();

  // Context compact check — pass a lazy getter so the followUp callback reads
  // the final in_progress item after all batched todo_complete calls.
  const compacted = await maybeCompactAfterComplete(
    () => items.find((i) => i.status === "in_progress") ?? null,
    deps,
    params.id,
  );

  let displayText = `✅ ${params.id}`;
  if (promoted && !compacted) {
    displayText += `\n\nIn progress: ▶ ${promoted.id}: ${promoted.name}\n${promoted.details}`;
  }

  return {
    content: [textContent(displayText)],
    details: { items: [...items], displayText },
    clearItems: false,
  };
}

// ---------------------------------------------------------------------------
// todo_move
// ---------------------------------------------------------------------------

export function handleMove(params: MoveInput, items: TodoItem[], commitState: () => void): ToolResult {
  // jscpd:ignore-start — signature + errorResult setup are intentionally parallel to handleAdd (same dependency shape, same error helper); the two handlers diverge in body logic
  const errorResult = (msg: string): ToolResult => makeErrorResult(items, msg);
  // jscpd:ignore-end

  const validIds = items.map((i) => i.id).join(", ");

  // --- Validate selection ---

  if (params.ids.length === 0) {
    return errorResult("Error: ids array must not be empty");
  }

  // All ids must exist
  for (const id of params.ids) {
    if (!items.some((i) => i.id === id)) {
      return errorResult(`Error: id '${id}' not found. Valid IDs: ${validIds}`);
    }
  }

  // No duplicates
  const seen = new Set<string>();
  for (const id of params.ids) {
    if (seen.has(id)) return errorResult(`Error: duplicate id '${id}' in ids`);
    seen.add(id);
  }

  // No ancestor/descendant overlap within the selection (a parent already
  // drags its subtree, so listing both is redundant/conflicting).
  for (const a of params.ids) {
    for (const b of params.ids) {
      if (a !== b && isDescendantOf(b, a)) {
        return errorResult(
          `Error: '${b}' is a descendant of '${a}' in the selection — move '${a}' alone, its subtree comes with it`,
        );
      }
    }
  }

  // --- Resolve destination ---
  // When both parentId and beforeId are provided, beforeId must be a DIRECT
  // child of parentId (inserts before beforeId within the parent's children);
  // a deeper descendant would corrupt the depth-first contiguity invariant, so
  // it is rejected. When only parentId → reparent and append at end of parent's subtree.
  // When only beforeId → insert as siblings before the target.

  const parentId = params.parentId;
  const beforeId = params.beforeId;
  const bothProvided = parentId !== undefined && beforeId !== undefined;

  if (parentId !== undefined) {
    const parent = items.find((i) => i.id === parentId);
    if (!parent) return errorResult(`Error: parentId '${parentId}' not found. Valid IDs: ${validIds}`);
    if (parent.status === "completed") {
      return errorResult(`Error: cannot move under completed item '${parentId}'`);
    }
    // Cycle guard: cannot move an item under itself or one of its own descendants
    for (const id of params.ids) {
      if (parentId === id || isDescendantOf(parentId, id)) {
        return errorResult(`Error: cannot move '${id}' under '${parentId}' (would create a cycle)`);
      }
    }
  }

  // --- Validate beforeId (if provided): existence + direct-child-of-parentId + moved-subtree ---
  if (beforeId !== undefined) {
    const target = items.find((i) => i.id === beforeId);
    if (!target) return errorResult(`Error: beforeId '${beforeId}' not found. Valid IDs: ${validIds}`);
    // When both provided, beforeId must be a direct child of parentId.
    if (bothProvided && getParentId(beforeId) !== parentId) {
      return errorResult(
        `Error: beforeId '${beforeId}' is not a direct child of parentId '${parentId}' — ` +
          "beforeId must be a child of parentId when both are specified",
      );
    }
    // Cannot insert before an item that is itself being moved (or in a moved subtree)
    for (const id of params.ids) {
      if (beforeId === id || isDescendantOf(beforeId, id)) {
        return errorResult(`Error: cannot move before '${beforeId}' — it is part of the moved subtree`);
      }
    }
  }

  // --- 1. Extract moved subtrees (each selected id + its descendants) ---
  // Build the moved block in INPUT order; within each selected id, preserve
  // depth-first subtree order (descendants are contiguous after their ancestor).
  const selectedSet = new Set(params.ids);
  const movedBlock: TodoItem[] = [];
  const moveSet = new Set<string>(); // all ids being moved (tops + descendants)
  for (const id of params.ids) {
    moveSet.add(id);
    for (const item of items) {
      if (item.id === id || isDescendantOf(item.id, id)) {
        movedBlock.push(item);
        moveSet.add(item.id);
      }
    }
  }

  const remaining = items.filter((i) => !moveSet.has(i.id));

  // --- 2. Auto-revert childless decomposed parents in `remaining` ---
  // A decomposed parent whose children all moved out is no longer a folder.
  for (const item of remaining) {
    if (item.status === "decomposed" && !remaining.some((c) => c.parentId === item.id)) {
      item.status = "pending";
    }
  }

  // --- 3. Resolve target parent + insertion index in `remaining` ---

  let targetParentId: string | undefined;
  let insertAt: number;

  if (bothProvided) {
    // beforeId is validated as descendant of parentId above.
    // Insert before beforeId as a child of parentId.
    const targetIndex = remaining.findIndex((i) => i.id === beforeId);
    targetParentId = parentId;
    insertAt = targetIndex;
  } else if (parentId !== undefined) {
    const parentIndex = remaining.findIndex((i) => i.id === parentId);
    // Parent is guaranteed present in remaining (it was not in the moveSet —
    // cycle guard rejected moving under a moved item).
    targetParentId = parentId;
    insertAt = findSubtreeEndIndex(remaining, parentId, parentIndex + 1);
  } else if (beforeId !== undefined) {
    const targetIndex = remaining.findIndex((i) => i.id === beforeId);
    const target = remaining[targetIndex];
    targetParentId = getParentId(target.id);
    insertAt = targetIndex;
  } else {
    targetParentId = undefined;
    insertAt = remaining.length;
  }

  // --- 4. Reparent the moved tops; keep internal subtree links intact ---
  // Selected (top) items adopt the new parent; descendants already point to
  // ancestors inside the block, so their parentId stays valid through renumber.
  for (const item of movedBlock) {
    if (selectedSet.has(item.id)) {
      item.parentId = targetParentId;
    }
  }

  // --- 5. Splice block into remaining at the insertion point ---
  remaining.splice(insertAt, 0, ...movedBlock);

  // --- 6. Moving under a parent makes it a folder (mirror todo_add) ---
  // Capture the parent object reference (by ref, not id) before renumber changes ids.
  const parentRef = parentId !== undefined ? remaining.find((i) => i.id === parentId) : undefined;
  if (parentRef && parentRef.status !== "decomposed" && !isTerminal(parentRef.status)) {
    parentRef.status = "decomposed";
  }

  // Capture the moved-top object references BEFORE renumber — selectedSet holds
  // OLD ids, which won't match after renumberTree rewrites them.
  const movedTopRefs = movedBlock.filter((i) => selectedSet.has(i.id));

  // --- 7. Re-derive positional IDs for the whole tree ---
  renumberTree(remaining);

  // --- 8. Re-establish the single-in_progress invariant ---
  const promoted = normalizeInProgress(remaining);

  // --- 9. Commit ---
  items.length = 0;
  items.push(...remaining);
  commitState();

  // New IDs of the originally-selected tops (read after renumber).
  const movedTopNewIds = movedTopRefs.map((i) => i.id);

  // --- Build display ---
  let displayText = "";
  if (parentRef) {
    displayText += `${STATUS_ICONS[parentRef.status]} ${parentRef.id} ${parentRef.name}\n`;
    displayText += formatItemList(movedBlock);
  } else {
    displayText += formatItemList(movedBlock);
  }
  displayText += promotedSuffix(promoted);

  return {
    content: [textContent(displayText)],
    details: { items: [...items], movedItems: movedTopNewIds, displayText },
  };
}
