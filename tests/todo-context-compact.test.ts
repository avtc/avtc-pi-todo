// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import type { TextContent } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFERRED_COMPACT_FOLLOWUP_MS, parseContextCompactValue } from "../src/handlers.js";
import { _setBuiltInFollowUpDisabled } from "../src/hooks.js";
import {
  clearTodoSettings,
  FOLLOW_UP_ENABLED,
  NO_SETUP_TOOL_OPTIONS,
  setTodoSetting,
  setupTool,
} from "./setup-tool.js";

describe("todo tool — context compact on complete", () => {
  beforeEach(async () => {
    setTodoSetting("todoItemCompleteContextCompact", "none");
  });

  afterEach(() => {
    clearTodoSettings();
    _setBuiltInFollowUpDisabled(FOLLOW_UP_ENABLED);
  });

  // --- none: no compact ---

  test("setting=none: next item injected into tool result, no compact", async () => {
    const { tools, ctx, compactMock } = setupTool(NO_SETUP_TOOL_OPTIONS);
    setTodoSetting("todoItemCompleteContextCompact", "none");

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    const result = await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);

    // Next item injected in tool result text
    expect((result.content[0] as TextContent).text).toContain("In progress: ▶ 2: B");
    expect((result.content[0] as TextContent).text).toContain("b");
    // No compact called
    expect(compactMock).not.toHaveBeenCalled();
  });

  // --- compact: always compact ---

  test("setting=compact: triggers ctx.compact with onComplete sending next item as followUp", async () => {
    const { tools, ctx, compactMock, sendUserMessageMock } = setupTool(NO_SETUP_TOOL_OPTIONS);
    setTodoSetting("todoItemCompleteContextCompact", "compact");

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);

    // compact called
    expect(compactMock).toHaveBeenCalledOnce();
    const compactOptions = compactMock.mock.calls[0][0];
    expect(compactOptions).toHaveProperty("onComplete");
    expect(compactOptions).toHaveProperty("onError");

    // Simulate compact completing
    vi.useFakeTimers();
    compactOptions.onComplete();
    vi.advanceTimersByTime(DEFERRED_COMPACT_FOLLOWUP_MS);
    vi.useRealTimers();

    // followUp sent with next item
    expect(sendUserMessageMock).toHaveBeenCalledOnce();
    const call = sendUserMessageMock.mock.calls[0];
    expect(call[0]).toContain("Context was compacted. Continue from where you left off.");
    expect(call[0]).toContain("✅ 1");
    expect(call[0]).toContain("In progress: ▶ 2: B");
    expect(call[0]).toContain("b");
    expect(call[1]).toEqual({ deliverAs: "followUp" });
  });

  test("setting=compact: standalone followUp inject is DEFERRED so a concurrent user steer is delivered first", async () => {
    // Regression guard for the user-steer-during-compaction hang: onComplete fires right after
    // compaction_end (which kicks flushCompactionQueue's steer prompt); injecting synchronously
    // there races the steer. The inject must be deferred so a steer's turn starts first.
    const { tools, ctx, compactMock, sendUserMessageMock } = setupTool(NO_SETUP_TOOL_OPTIONS);
    setTodoSetting("todoItemCompleteContextCompact", "compact");

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);

    const compactOptions = compactMock.mock.calls[0][0];
    vi.useFakeTimers();
    compactOptions.onComplete();

    // Immediately after onComplete: inject MUST NOT have fired yet (deferred).
    expect(sendUserMessageMock).not.toHaveBeenCalled();

    // After the defer window: inject fires.
    vi.advanceTimersByTime(DEFERRED_COMPACT_FOLLOWUP_MS);
    vi.useRealTimers();
    expect(sendUserMessageMock).toHaveBeenCalledOnce();
    expect(sendUserMessageMock.mock.calls[0][1]).toEqual({ deliverAs: "followUp" });
  });

  test("setting=compact with builtInFollowUpDisabled: compact called but no followUp sent", async () => {
    const { tools, ctx, compactMock, sendUserMessageMock } = setupTool({ builtInFollowUpDisabled: true });
    setTodoSetting("todoItemCompleteContextCompact", "compact");

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);

    // compact called
    expect(compactMock).toHaveBeenCalledOnce();
    const compactOptions = compactMock.mock.calls[0][0];
    expect(compactOptions).toHaveProperty("onComplete");
    expect(compactOptions).toHaveProperty("onError");

    // Simulate compact completing
    compactOptions.onComplete();

    // No followUp sent — host handles it via session_compact + getCompletedItemId/getInProgressItem
    expect(sendUserMessageMock).not.toHaveBeenCalled();
  });

  test("setting=compact with builtInFollowUpDisabled: onError resumes the agent (host does not see compaction errors)", async () => {
    // The host (feature-flow) only resumes on SUCCESS via its global session_compact handler.
    // On error/cancel, session_compact never fires, so nothing else resumes the agent —
    // todo's onError must resume directly to avoid a stall in the main session.
    const { tools, ctx, compactMock, sendUserMessageMock } = setupTool({ builtInFollowUpDisabled: true });
    setTodoSetting("todoItemCompleteContextCompact", "compact");

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);

    expect(compactMock).toHaveBeenCalledOnce();
    const compactOptions = compactMock.mock.calls[0][0];

    // Simulate compact error (cancel / nothing-to-compact / API error) under fake timers.
    vi.useFakeTimers();
    compactOptions.onError(new Error("Compaction cancelled"));

    // Deferred resume fires after the steer-priority window.
    vi.advanceTimersByTime(DEFERRED_COMPACT_FOLLOWUP_MS);
    vi.useRealTimers();
    expect(sendUserMessageMock).toHaveBeenCalledOnce();
    expect(sendUserMessageMock.mock.calls[0][0]).toBe("Continue from where you left off.");
    expect(sendUserMessageMock.mock.calls[0][1]).toEqual({ deliverAs: "followUp" });
  });

  test("setting=compact: does not compact on all-done", async () => {
    const { tools, ctx, compactMock } = setupTool(NO_SETUP_TOOL_OPTIONS);
    setTodoSetting("todoItemCompleteContextCompact", "compact");

    await tools.init.execute(
      "call-1",
      {
        items: [{ name: "Only", details: "only" }],
      },
      undefined,
      undefined,
      ctx,
    );

    await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);

    // All-done — no compact needed
    expect(compactMock).not.toHaveBeenCalled();
  });

  // --- compact>75K: threshold ---

  test("setting=compact>75K: skips compact when tokens below threshold", async () => {
    const { tools, ctx, compactMock } = setupTool(NO_SETUP_TOOL_OPTIONS);
    setTodoSetting("todoItemCompleteContextCompact", "compact>75K");

    // Default mock returns 50000 tokens — below 75000 threshold
    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    const result = await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);

    // Below threshold — no compact, next item in tool result
    expect(compactMock).not.toHaveBeenCalled();
    expect((result.content[0] as TextContent).text).toContain("In progress: ▶ 2: B");
  });

  test("setting=compact>75K: triggers compact when tokens above threshold", async () => {
    const { tools, ctx, compactMock, sendUserMessageMock } = setupTool(NO_SETUP_TOOL_OPTIONS);
    setTodoSetting("todoItemCompleteContextCompact", "compact>75K");

    // Override getContextUsage to return tokens above threshold
    ctx.getContextUsage = () => Promise.resolve({ tokens: 80000, contextWindow: 200000, percent: 40 });

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);

    // Above threshold — compact triggered
    expect(compactMock).toHaveBeenCalledOnce();
    const compactOptions = compactMock.mock.calls[0][0];
    vi.useFakeTimers();
    compactOptions.onComplete();
    vi.advanceTimersByTime(DEFERRED_COMPACT_FOLLOWUP_MS);
    vi.useRealTimers();

    expect(sendUserMessageMock).toHaveBeenCalledOnce();
    expect(sendUserMessageMock.mock.calls[0][0]).toContain("In progress: ▶ 2: B");
  });

  test("setting=compact>75K: skips compact when tokens is null", async () => {
    const { tools, ctx, compactMock } = setupTool(NO_SETUP_TOOL_OPTIONS);
    setTodoSetting("todoItemCompleteContextCompact", "compact>75K");

    ctx.getContextUsage = () => Promise.resolve({ tokens: 0, contextWindow: 200000, percent: 0 });

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    const result = await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);

    // null tokens — skip compact
    expect(compactMock).not.toHaveBeenCalled();
    expect((result.content[0] as TextContent).text).toContain("In progress: ▶ 2: B");
  });

  test("setting=compact>75K: uses cached tokens when current is null", async () => {
    const { tools, ctx, compactMock } = setupTool(NO_SETUP_TOOL_OPTIONS);
    setTodoSetting("todoItemCompleteContextCompact", "compact>75K");

    // First call returns real value (above threshold) — caches it
    let callCount = 0;
    ctx.getContextUsage = () => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ tokens: 100000, contextWindow: 200000, percent: 50 });
      // Subsequent calls return null (simulating post-compaction)
      return Promise.resolve({ tokens: 0, contextWindow: 200000, percent: 0 });
    };

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
          { name: "C", details: "c" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // First complete: tokens=100K > 75K → compact triggered
    await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);
    expect(compactMock).toHaveBeenCalledTimes(1);

    // Simulate compact completing — reset state so we can do another complete
    // After compact, lastKnownTokens is reset to null
    // Second complete: tokens=null, cache=null → skip compact
    await tools.complete.execute("call-3", { id: "2" }, undefined, undefined, ctx);
    // Should NOT compact again (null tokens, no cache)
    expect(compactMock).toHaveBeenCalledTimes(1);
  });

  test("setting=compact>75K: caches tokens from non-null call, uses on next null call", async () => {
    const { tools, ctx, compactMock } = setupTool(NO_SETUP_TOOL_OPTIONS);
    setTodoSetting("todoItemCompleteContextCompact", "compact>75K");

    // init returns non-null value that's below threshold
    ctx.getContextUsage = () => Promise.resolve({ tokens: 50000, contextWindow: 200000, percent: 25 });

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // First complete: tokens=50K < 75K → skip compact, but cache 50000
    const result1 = await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);
    expect(compactMock).not.toHaveBeenCalled();
    expect((result1.content[0] as TextContent).text).toContain("In progress: ▶ 2: B");

    // Now simulate null tokens — should use cached 50000
    ctx.getContextUsage = () => Promise.resolve({ tokens: 0, contextWindow: 200000, percent: 0 });

    // Complete B — null tokens, cache=50000 < 75K → skip compact, triggers all-done
    const result2 = await tools.complete.execute("call-3", { id: "2" }, undefined, undefined, ctx);
    expect(compactMock).not.toHaveBeenCalled();
    expect((result2.content[0] as TextContent).text).toContain("All todos done");
  });

  // --- compact onError ---

  test("setting=compact: onError resumes the agent with a deferred followUp", async () => {
    const { tools, ctx, compactMock, sendUserMessageMock } = setupTool(NO_SETUP_TOOL_OPTIONS);
    setTodoSetting("todoItemCompleteContextCompact", "compact");

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);

    expect(compactMock).toHaveBeenCalledOnce();
    const compactOptions = compactMock.mock.calls[0][0];

    // Fire onError under fake timers so the deferred resume is schedulable/advanceable.
    vi.useFakeTimers();
    // Simulate compact error — should not throw
    expect(() => compactOptions.onError(new Error("compact failed"))).not.toThrow();
    // Immediately after onError: resume MUST NOT have fired yet (deferred so a concurrent
    // user steer is delivered first).
    expect(sendUserMessageMock).not.toHaveBeenCalled();

    // After the deferred window: the agent is resumed — compact() aborted the turn up front,
    // so onError must restart it (nothing else does in the main session).
    vi.advanceTimersByTime(DEFERRED_COMPACT_FOLLOWUP_MS);
    vi.useRealTimers();
    expect(sendUserMessageMock).toHaveBeenCalledOnce();
    expect(sendUserMessageMock.mock.calls[0][0]).toBe("Continue from where you left off.");
    expect(sendUserMessageMock.mock.calls[0][1]).toEqual({ deliverAs: "followUp" });
  });

  test("setting=compact: synchronous throw from ctx.compact is caught", async () => {
    const { tools, ctx, compactMock, sendUserMessageMock } = setupTool(NO_SETUP_TOOL_OPTIONS);
    setTodoSetting("todoItemCompleteContextCompact", "compact");

    // Override compact to throw synchronously
    compactMock.mockImplementation(() => {
      throw new Error("compact not available");
    });

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Complete should NOT throw even though compact throws synchronously
    const result = await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);
    expect(compactMock).toHaveBeenCalledOnce();
    // When compact is triggered (even if it throws), result still shows completed IDs
    expect((result.content[0] as TextContent).text).toBe("✅ 1");
    // followUp should NOT have been sent since compact threw
    expect(sendUserMessageMock).not.toHaveBeenCalled();
  });

  test("setting=compact: multiple completes in single turn only trigger compact once", async () => {
    const { tools, ctx, compactMock, sendUserMessageMock } = setupTool(NO_SETUP_TOOL_OPTIONS);
    setTodoSetting("todoItemCompleteContextCompact", "compact");

    // Track the resolve function so we can control when compact finishes
    let resolveCompact: () => void = () => {};
    compactMock.mockImplementation(({ onComplete }: { onComplete: () => void }) => {
      // Compact completes asynchronously — the resolve is called later
      // In the real world, compact runs in the background
      (async () => {
        await new Promise((resolve) => {
          resolveCompact = resolve as () => void;
        });
        onComplete?.();
      })();
    });

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
          { name: "C", details: "c" },
          { name: "D", details: "d" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Complete items 1, 2, 3 in sequence (simulating multiple tool calls in one turn)
    // Only the first should trigger compact; subsequent ones should be guarded
    const result1 = await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);
    expect(compactMock).toHaveBeenCalledTimes(1);
    // First result: compact triggered, promoted item NOT injected into result text
    expect((result1.content[0] as TextContent).text).toBe("✅ 1");

    // Second complete: compact still in-flight → guarded, no duplicate compact
    // Guarded completes DO inject the promoted item (compacted=false, so promoted is shown)
    const result2 = await tools.complete.execute("call-3", { id: "2" }, undefined, undefined, ctx);
    expect(compactMock).toHaveBeenCalledTimes(1);
    expect((result2.content[0] as TextContent).text).toContain("✅ 2");
    expect((result2.content[0] as TextContent).text).toContain("In progress: ▶ 3: C");

    // Third complete: compact still in-flight → guarded, no duplicate compact
    const result3 = await tools.complete.execute("call-4", { id: "3" }, undefined, undefined, ctx);
    expect(compactMock).toHaveBeenCalledTimes(1);
    expect((result3.content[0] as TextContent).text).toContain("✅ 3");

    // Now resolve the compact (under fake timers so the deferred inject is controllable)
    vi.useFakeTimers();
    resolveCompact?.();
    await vi.advanceTimersByTimeAsync(DEFERRED_COMPACT_FOLLOWUP_MS);
    vi.useRealTimers();

    // followUp sent for the FINAL promoted item (item 4: D), not the stale
    // first-promoted item — lazy evaluation reads items[] at callback time
    expect(sendUserMessageMock).toHaveBeenCalledOnce();
    expect(sendUserMessageMock.mock.calls[0][0]).toContain("In progress: ▶ 4: D");
    expect(sendUserMessageMock.mock.calls[0][0]).toContain("d");
  });

  test("setting=compact>75K: concurrent completes in one turn trigger compact only once (re-entrancy guard)", async () => {
    // The reservation is set synchronously (before the getContextUsage await) so concurrent
    // todo_complete calls in one turn can't all pass the guard and each fire ctx.compact().
    const { tools, ctx, compactMock } = setupTool(NO_SETUP_TOOL_OPTIONS);
    setTodoSetting("todoItemCompleteContextCompact", "compact>75K");

    // Defer getContextUsage resolution so both completes interleave at the await.
    const resolvers: Array<(v: { tokens: number; contextWindow: number; percent: number }) => void> = [];
    ctx.getContextUsage = (() =>
      new Promise<{ tokens: number; contextWindow: number; percent: number }>((resolve) => {
        resolvers.push(resolve);
      })) as unknown as typeof ctx.getContextUsage;

    await tools.init.execute(
      "c1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
          { name: "C", details: "c" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // Fire two completes CONCURRENTLY — both reach maybeCompactAfterComplete this microtask.
    const p1 = tools.complete.execute("c2", { id: "1" }, undefined, undefined, ctx);
    const p2 = tools.complete.execute("c3", { id: "2" }, undefined, undefined, ctx);

    // Release any suspended getContextUsage calls.
    for (const r of resolvers) r({ tokens: 100000, contextWindow: 200000, percent: 50 });
    await Promise.all([p1, p2]);

    // Only ONE compact fires — the synchronous reservation blocks the second complete at
    // the guard before it reaches getContextUsage.
    expect(compactMock).toHaveBeenCalledTimes(1);
  });

  test("setting=compact: onError resets guard, allowing subsequent complete to trigger compact again", async () => {
    vi.useFakeTimers();
    const { tools, ctx, compactMock, sendUserMessageMock } = setupTool(NO_SETUP_TOOL_OPTIONS);
    setTodoSetting("todoItemCompleteContextCompact", "compact");

    let triggerError: () => void = () => {};
    compactMock.mockImplementation(({ onError }: { onError: (err: Error) => void }) => {
      // Simulate compact failing asynchronously
      (async () => {
        await new Promise<void>((resolve) => {
          triggerError = () => {
            onError?.(new Error("compact failed"));
            resolve();
          };
        });
      })();
    });

    await tools.init.execute(
      "call-1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
          { name: "C", details: "c" },
          { name: "D", details: "d" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );

    // First complete: triggers compact (promotes B)
    await tools.complete.execute("call-2", { id: "1" }, undefined, undefined, ctx);
    expect(compactMock).toHaveBeenCalledTimes(1);

    // Second complete while compact in-flight: guarded, no duplicate (promotes C)
    await tools.complete.execute("call-3", { id: "2" }, undefined, undefined, ctx);
    expect(compactMock).toHaveBeenCalledTimes(1);

    // Fire onError — should reset the guard. onError also schedules a deferred resume
    // (compact aborted the turn), but that hasn't fired yet.
    triggerError?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendUserMessageMock).not.toHaveBeenCalled();

    // Third complete after error recovery: should trigger compact again (promotes D)
    await tools.complete.execute("call-4", { id: "3" }, undefined, undefined, ctx);
    expect(compactMock).toHaveBeenCalledTimes(2);

    // The first onError's deferred resume now fires (no onComplete fired for either compact).
    await vi.advanceTimersByTimeAsync(DEFERRED_COMPACT_FOLLOWUP_MS);
    expect(sendUserMessageMock).toHaveBeenCalled();

    vi.useRealTimers();
  });
});

describe("todo tool — threshold parsing for all values", () => {
  const thresholds = [
    { value: "compact>75K", expected: 75_000 },
    { value: "compact>125K", expected: 125_000 },
    { value: "compact>200K", expected: 200_000 },
    { value: "compact>500K", expected: 500_000 },
  ] as const;

  test.each(thresholds)("setting=$value parses threshold=$expected", ({ value, expected }) => {
    const { mode, threshold } = parseContextCompactValue(value);
    expect(mode).toBe("compact");
    expect(threshold).toBe(expected);
  });

  test.each(thresholds)("setting=$value skips compact below threshold", async ({ value, expected }) => {
    vi.useFakeTimers();
    setTodoSetting("todoItemCompleteContextCompact", value);

    const { tools, ctx, compactMock } = setupTool(NO_SETUP_TOOL_OPTIONS);
    ctx.getContextUsage = vi.fn().mockResolvedValue({ tokens: expected - 1, contextWindow: 200_000, percent: 50 });

    await tools.init.execute(
      "c1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    await tools.complete.execute("c2", { id: "1" }, undefined, undefined, ctx);

    expect(compactMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  test.each(thresholds)("setting=$value triggers compact above threshold", async ({ value, expected }) => {
    vi.useFakeTimers();
    setTodoSetting("todoItemCompleteContextCompact", value);

    const { tools, ctx, compactMock } = setupTool(NO_SETUP_TOOL_OPTIONS);
    ctx.getContextUsage = vi.fn().mockResolvedValue({ tokens: expected + 1, contextWindow: 200_000, percent: 50 });
    compactMock.mockImplementation(({ onComplete }: { onComplete: () => void }) => {
      vi.advanceTimersByTime(0);
      onComplete?.();
    });

    await tools.init.execute(
      "c1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    await tools.complete.execute("c2", { id: "1" }, undefined, undefined, ctx);

    expect(compactMock).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  test("getContextUsage undefined on ctx — treats tokens as null, skips compact", async () => {
    vi.useFakeTimers();
    setTodoSetting("todoItemCompleteContextCompact", "compact>75K");

    const { tools, ctx, compactMock } = setupTool(NO_SETUP_TOOL_OPTIONS);
    // Remove getContextUsage entirely
    delete (ctx as Record<string, unknown>).getContextUsage;

    compactMock.mockImplementation(({ onComplete }: { onComplete: () => void }) => {
      vi.advanceTimersByTime(0);
      onComplete?.();
    });

    await tools.init.execute(
      "c1",
      {
        items: [
          { name: "A", details: "a" },
          { name: "B", details: "b" },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    await tools.complete.execute("c2", { id: "1" }, undefined, undefined, ctx);

    // tokens = null (no getContextUsage, lastKnownTokens = null)
    // !null → true → skip compact
    expect(compactMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
