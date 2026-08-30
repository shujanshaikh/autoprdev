import { describe, expect, it, vi } from "vitest";
import type { UIMessageChunk } from "ai";

import {
  ensureTerminalRunFinishes,
  isTriggerRunVisibilityPending,
} from "./trigger-agent-stream-server";

function chunkStream(chunks: UIMessageChunk[]) {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }) as ReadableStream<UIMessageChunk> & AsyncIterable<UIMessageChunk>;
}

function hangingFinishStream(onCancel: () => void) {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.enqueue({ type: "finish" });
    },
    cancel() {
      onCancel();
    },
  }) as ReadableStream<UIMessageChunk> & AsyncIterable<UIMessageChunk>;
}

async function collect(stream: ReadableStream<UIMessageChunk>) {
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return chunks;
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
}

describe("Trigger agent stream settlement", () => {
  it("keeps a newly started run attached while Trigger read visibility catches up", () => {
    const now = Date.parse("2026-08-23T12:00:00Z");

    expect(isTriggerRunVisibilityPending({
      currentRunId: "run-new",
      updatedAt: now - 5_000,
    }, "run-new", now)).toBe(true);
    expect(isTriggerRunVisibilityPending({
      currentRunId: "run-new",
      updatedAt: now - 30_000,
    }, "run-new", now)).toBe(false);
    expect(isTriggerRunVisibilityPending({
      currentRunId: "run-other",
      updatedAt: now,
    }, "run-new", now)).toBe(false);
  });

  it("settles and closes even when the upstream stays open after finish", async () => {
    const events: string[] = [];
    const cancelled = vi.fn();
    const source = hangingFinishStream(cancelled);
    let releaseSettlement: () => void = () => undefined;
    const settlement = new Promise<void>((resolve) => {
      releaseSettlement = resolve;
    });
    const settled = vi.fn(async () => {
      await settlement;
      events.push("settled");
    });
    const output = ensureTerminalRunFinishes(source, "run-1", settled);
    const reader = output.getReader();

    const finish = await reader.read();
    events.push(finish.value?.type ?? "closed");

    expect(finish).toEqual({ done: false, value: { type: "finish" } });
    expect(events).toEqual(["finish"]);
    expect(settled).toHaveBeenCalledExactlyOnceWith(null);

    releaseSettlement();
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
    reader.releaseLock();

    expect(events).toEqual(["finish", "settled"]);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("synthesizes finish and settles when a completed run omitted it", async () => {
    const settled = vi.fn();
    const terminalRun = { isCompleted: true };
    const retrieveRun = vi.fn(async () => terminalRun as never);

    await expect(collect(ensureTerminalRunFinishes(
      chunkStream([]),
      "run-2",
      settled,
      retrieveRun,
    ))).resolves.toEqual([{ type: "finish" }]);
    expect(retrieveRun).toHaveBeenCalledExactlyOnceWith("run-2");
    expect(settled).toHaveBeenCalledExactlyOnceWith(terminalRun);
  });

  it("keeps a timed-out stream open when its run is still active", async () => {
    const settled = vi.fn();
    const retrieveRun = vi.fn(async () => ({ isCompleted: false }) as never);

    await expect(collect(ensureTerminalRunFinishes(
      chunkStream([]),
      "run-3",
      settled,
      retrieveRun,
    ))).resolves.toEqual([]);
    expect(settled).not.toHaveBeenCalled();
  });
});
