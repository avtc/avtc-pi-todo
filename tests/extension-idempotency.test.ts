// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Tests for the reload-safe idempotent globalThis wiring guard in extension.ts.
 *
 * The guard uses a globalThis flag (__avtcPiTodoWired) so the package can be
 * safely bundled into the avtc-pi umbrella AND installed standalone, while
 * surviving /reload: pi re-evaluates extension modules fresh on /reload
 * (jiti moduleCache:false) but globalThis persists, so the flag MUST reset on
 * session_shutdown — otherwise an un-reset guard short-circuits re-wiring and
 * leaves the extension dead after reload.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Name of the globalThis flag the guard uses. */
const WIRED_FLAG = "__avtcPiTodoWired" as const;

/** Number of tools the extension registers on a full wiring pass. */
const TOOL_COUNT = 5;

type GlobalWithFlag = typeof globalThis & { [WIRED_FLAG]?: boolean };

function createMockPi() {
  const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();

  return {
    events: {
      emit: vi.fn(),
      on: vi.fn(() => () => {}),
      off: vi.fn(),
    },
    on(event: string, handler: (...args: unknown[]) => unknown) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    appendEntry: vi.fn(),
    sendUserMessage: vi.fn(),
    handlers,
    fireSessionEvent(event: string, ...args: unknown[]) {
      const list = handlers.get(event) ?? [];
      for (const h of list) h(...args);
    },
  };
}

describe("extension.ts — reload-safe idempotent wiring guard", () => {
  let extensionModule: typeof import("../src/extension.js");

  beforeEach(async () => {
    // isolate:false in vitest.config.ts → globalThis persists across every test.
    // Ensure a fresh UNWIRED state for each case so the guard does not short-circuit.
    delete (globalThis as GlobalWithFlag)[WIRED_FLAG];
    // Cache-busting dynamic import: string concatenation (not a template literal)
    // keeps the specifier statically analyzable so esbuild/vitest can resolve it.
    // biome-ignore lint/style/useTemplate: cache-busting dynamic import needs string concatenation
    extensionModule = await import("../src/extension.js?t=" + Date.now());
  });

  it("first call wires (registers exactly the tools)", () => {
    const pi = createMockPi();
    extensionModule.default(pi as unknown as ExtensionAPI);

    expect(pi.registerTool).toHaveBeenCalledTimes(TOOL_COUNT);
  });

  it("second call on the same pi is a no-op (does not register again)", () => {
    const pi = createMockPi();
    extensionModule.default(pi as unknown as ExtensionAPI);
    extensionModule.default(pi as unknown as ExtensionAPI);

    // Still exactly one wiring pass — guard short-circuited the second call.
    expect(pi.registerTool).toHaveBeenCalledTimes(TOOL_COUNT);
  });

  it("sets the globalThis wiring flag after the first call", () => {
    const pi = createMockPi();
    expect((globalThis as GlobalWithFlag)[WIRED_FLAG]).toBeUndefined();

    extensionModule.default(pi as unknown as ExtensionAPI);

    expect((globalThis as GlobalWithFlag)[WIRED_FLAG]).toBe(true);
  });

  it("survives a reload cycle: session_shutdown resets the flag so a later call re-wires", () => {
    // --- First wiring pass ---
    const pi1 = createMockPi();
    extensionModule.default(pi1 as unknown as ExtensionAPI);
    expect(pi1.registerTool).toHaveBeenCalledTimes(TOOL_COUNT);
    expect((globalThis as GlobalWithFlag)[WIRED_FLAG]).toBe(true);

    // --- Shutdown tears down the session: flag MUST reset ---
    pi1.fireSessionEvent("session_shutdown");
    expect((globalThis as GlobalWithFlag)[WIRED_FLAG]).toBe(false);

    // --- Reload: pi re-evaluates the module fresh, new Extension, calls entry again.
    //     Flag is reset, so the guard does NOT short-circuit — wiring runs in full. ---
    const pi2 = createMockPi();
    extensionModule.default(pi2 as unknown as ExtensionAPI);
    expect(pi2.registerTool).toHaveBeenCalledTimes(TOOL_COUNT);
    expect((globalThis as GlobalWithFlag)[WIRED_FLAG]).toBe(true);
  });
});
