// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * The single, canonical todo-settings handle.
 *
 * Registered once here (rather than in `extension.ts`) so every module reads settings through the
 * same accessor. {@link initTodoSettings} is called from the extension's activate function (where
 * `pi` is available); until then the handle is `undefined`, which is fine because all reads happen
 * at runtime (after activate). Callers read {@link getTodoSettings}; no consumer re-parses or
 * re-normalizes the env var.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSettingsCommand, type SettingsHandle } from "avtc-pi-settings-ui";
import { TODO_SCHEMA, TODO_SETTINGS_ENV_VAR, type TodoSettings } from "./schema.js";

let handle: SettingsHandle<TodoSettings> | undefined;

/**
 * Test-only override for the settings read (DI/mock pattern): when set, {@link getTodoSettings}
 * returns this instead of the real handle. Set up in tests before the SUT runs; cleared by
 * {@link _resetGetTodoSettings}.
 */
let _getSettingsOverride: (() => TodoSettings) | null = null;

/** Test-only: inject a mock settings source (pass `null` to restore the real handle). */
export function _setGetTodoSettings(fn: (() => TodoSettings) | null): void {
  _getSettingsOverride = fn;
}

/** Test-only: clear the mock override (restore real-handle reads). */
export function _resetGetTodoSettings(): void {
  _getSettingsOverride = null;
}

/**
 * Register the /todo:settings command + modal and create the settings handle.
 * Must be called from the extension's activate function (needs `pi`). Loads settings
 * immediately (registration time) and on every session_start.
 */
export function initTodoSettings(pi: ExtensionAPI): void {
  handle = registerSettingsCommand<TodoSettings>(pi, TODO_SCHEMA, {
    commandName: "todo:settings",
    title: "Todo Settings",
    titleRight: "avtc-pi-todo",
    envVar: TODO_SETTINGS_ENV_VAR,
  });
}

/** Read the current todo settings (normalized by the schema). */
export function getTodoSettings(): TodoSettings {
  if (_getSettingsOverride) return _getSettingsOverride();
  if (!handle) throw new Error("todo settings not initialized — initTodoSettings not called");
  return handle.getSettings();
}
