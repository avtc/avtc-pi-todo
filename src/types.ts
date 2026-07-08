// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Pi-todo types.
 *
 * Core data model, options interface, and bridge type.
 */

import { type ImageContent, type Static, StringEnum, type TextContent, Type } from "@earendil-works/pi-ai";
import type { TodoStatus } from "./id-helpers.js";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface TodoItem {
  id: string;
  parentId?: string;
  name: string;
  details: string;
  status: TodoStatus;
}

/** Shape of a todo item as stored in persistence (fields may be missing or use legacy values). */
export interface RawTodoItem {
  id: string | number;
  parentId?: string;
  name: string;
  details?: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Parameter schemas and inferred types
// ---------------------------------------------------------------------------

const ItemInput = Type.Object({
  name: Type.String({ description: "Short title of the item (one line)" }),
  details: Type.String({
    description:
      "Everything needed to resume after a context compact: goal, steps, acceptance criteria, and references (file paths, doc sections). Required — the list survives compaction, so an item without self-sufficient details can't be resumed.",
  }),
});

export const InitParams = Type.Object(
  {
    items: Type.Array(ItemInput, { description: "Items for the new todo list" }),
  },
  { additionalProperties: false },
);

export const AddParams = Type.Object(
  {
    items: Type.Array(ItemInput, { description: "Items to add" }),
    parentId: Type.Optional(
      Type.String({
        description:
          "Decompose an item into sub-steps that must be tracked and completed independently. The parent becomes a permanent 📁 folder — work its children, not the parent itself. Parent is considered done when all children are completed. Irreversible. When combined with beforeId, beforeId must be a direct child of parentId.",
      }),
    ),
    beforeId: Type.Optional(
      Type.String({
        description:
          "Insert as sibling before this item (e.g. before the in-progress item to prioritize). Omit to append to the end (or end of the parent's children if parentId is set).",
      }),
    ),
  },
  { additionalProperties: false },
);

export const MoveParams = Type.Object(
  {
    ids: Type.Array(Type.String(), {
      description:
        "Item IDs to move. Each moves with its whole subtree (children come along), placed at the destination in the given order. Don't include both a parent and its own child — move the parent alone.",
    }),
    parentId: Type.Optional(
      Type.String({
        description:
          "Reparent: moved items become children of this item, inserted after its existing children; the parent becomes a 📁 folder. When combined with beforeId, beforeId must be a direct child of parentId.",
      }),
    ),
    beforeId: Type.Optional(
      Type.String({
        description:
          "Insert the moved items as siblings before this item (e.g. move blocked items after their blockers, or move blockers before blocked items). Omit to append to the top level (or after the parent's last child if parentId is set).",
      }),
    ),
  },
  { additionalProperties: false },
);

export const ListParams = Type.Object(
  {
    status: Type.Optional(
      StringEnum(["pending", "in_progress", "completed"] as const, {
        description:
          "Filter by status: pending (not started), in_progress (currently active — always exactly one), completed (done, includes decomposed containers).",
      }),
    ),
    fromId: Type.Optional(
      Type.String({
        description: "Positional range in the flat list (includes nested children). Inclusive start.",
      }),
    ),
    toId: Type.Optional(
      Type.String({
        description: "Positional range in the flat list (includes nested children). Exclusive end.",
      }),
    ),
    parentId: Type.Optional(Type.String({ description: "Direct children of this item" })),
    details: Type.Optional(Type.Boolean({ description: "Include item details in output" })),
  },
  { additionalProperties: false },
);

export const CompleteParams = Type.Object(
  {
    id: Type.String({
      description: 'Dotted ID of the item to complete (e.g. "1.1", "2")',
    }),
  },
  { additionalProperties: false },
);

export type InitInput = Static<typeof InitParams>;
export type AddInput = Static<typeof AddParams>;
export type ListInput = Static<typeof ListParams>;
export type CompleteInput = Static<typeof CompleteParams>;
export type MoveInput = Static<typeof MoveParams>;

// ---------------------------------------------------------------------------
// Cross-extension bridge (single object on globalThis)
// ---------------------------------------------------------------------------

export interface PiTodoBridge {
  /**
   * Returns the id of the item just completed by the todo_complete that triggered
   * the current compaction, then clears it (consume-on-read). Returns null when the
   * compaction was not triggered by item completion — so callers can omit the `✅` line.
   */
  getCompletedItemId(): string | null;
  /**
   * Returns the current in-progress item formatted for followUp
   * (`In progress: ▶ id: name\ndetails`), or null if no item is in progress.
   */
  getInProgressItem(): string | null;
}

// ---------------------------------------------------------------------------
// Internal result types
// ---------------------------------------------------------------------------

export const TODO_ENTRY_TYPE = "pi_todo";

/** Shorthand to create a text content block. */
export const textContent = (text: string): TextContent => ({ type: "text", text });

export type ToolResultDetails = {
  items: TodoItem[];
  error?: boolean;
  total?: number;
  newItems?: string[];
  /** New IDs of items that were moved (originally-selected tops). */
  movedItems?: string[];
  /** Full formatted text for TUI rendering — matches what the model sees in content[0].text */
  displayText?: string;
};

export type ToolResult = {
  content: (TextContent | ImageContent)[];
  details: ToolResultDetails;
};
