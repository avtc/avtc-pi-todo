// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Hook arrays and flags for pi-todo — shared between extension.ts and index.ts.
 *
 * Extension.ts exposes add* methods that push to these arrays / set these flags.
 * Index.ts and handlers.ts read from them at execution time.
 * Arrays are cleared on session_start before re-emitting :ready.
 */

export let _builtInFollowUpDisabled = false;

export function _setBuiltInFollowUpDisabled(value: boolean): void {
  _builtInFollowUpDisabled = value;
}
