// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Todo settings schema.
 *
 * Defines the one todo-specific setting (todoItemCompleteContextCompact)
 * using avtc-pi-settings-ui's SettingsSchema format.
 */

import { type SettingsSchema, settingsFilePaths } from "avtc-pi-settings-ui";

const TODO_COMPACT_VALUES = ["none", "compact", "compact>75K", "compact>125K", "compact>200K", "compact>500K"] as const;

/** The todo settings (shape declared here, defaults live in {@link TODO_SCHEMA}). */
export interface TodoSettings {
  /** Context-compact behavior after completing a todo item (see {@link TODO_SCHEMA}). */
  todoItemCompleteContextCompact: string;
}

export const TODO_SCHEMA: SettingsSchema = {
  settings: [
    {
      id: "todoItemCompleteContextCompact",
      label: "Context compact after item complete",
      description:
        "Context compact after completing a todo item: none (no compact), compact (force compact), compact>NK (compact only if context exceeds threshold)",
      type: "compact-threshold",
      defaultValue: "none",
      presets: TODO_COMPACT_VALUES,
    },
  ],
  tabs: [
    {
      label: "Todo",
      settingIds: ["todoItemCompleteContextCompact"],
    },
  ],
  ...settingsFilePaths("avtc-pi-todo"),
};

/** Env var name for cross-process settings propagation. */
export const TODO_SETTINGS_ENV_VAR = "PI_SETTINGS_TODO";
