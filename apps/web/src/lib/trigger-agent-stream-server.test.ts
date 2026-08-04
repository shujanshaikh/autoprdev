import { describe, expect, it, vi } from "vitest";
import type { UIMessageChunk } from "ai";

import { ensureTerminalRunFinishes } from "./trigger-agent-stream-server";

function chunkStream(chunks: UIMessageChunk[]) {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
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
  it("settles the thread before forwarding a normal finish chunk", async () => {
    const events: string[] = [];
    const source = chunkStream([{ type: "finish" }]);
    const settled = vi.fn(async () => {
      events.push("settled");
    });
    const output = ensureTerminalRunFinishes(source, "run-1", settled);
    const reader = output.getReader();

    const result = await reader.read().finally(() => reader.releaseLock());
    events.push(result.value?.type ?? "closed");

    expect(result).toEqual({ done: false, value: { type: "finish" } });
    expect(events).toEqual(["settled", "finish"]);
    expect(settled).toHaveBeenCalledExactlyOnceWith(null);
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
