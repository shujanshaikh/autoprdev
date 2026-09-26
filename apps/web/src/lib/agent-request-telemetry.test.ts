import { describe, expect, it } from "vitest";
import { streamText, wrapLanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { createAgentRequestTelemetry, profileAgentRequest, requestUsage } from "./agent-request-telemetry";

const usage = {
  inputTokens: { total: 100, noCache: 60, cacheRead: 40, cacheWrite: 0 },
  outputTokens: { total: 20, text: 10, reasoning: 10 },
};

describe("agent request telemetry", () => {
  it("weights cached and output tokens and leaves unknown prices and cache reads unknown", () => {
    expect(requestUsage(usage, "gpt-5.5").apiEquivalentCost?.total).toBeCloseTo(0.00092);
    expect(requestUsage(usage, "unpriced-model").apiEquivalentCost).toBeNull();
    expect(requestUsage({ ...usage, inputTokens: { ...usage.inputTokens, cacheRead: undefined } }, "gpt-5.5").cacheHit).toBeNull();
  });

  it("records SDK sections without logging their content", () => {
    const profile = profileAgentRequest({
      prompt: [{ role: "user", content: [{ type: "text", text: "private source" }] }],
      providerOptions: { openai: { instructions: "private system" } },
    });
    expect(profile.sourceChars.user).toBeGreaterThan(0);
    expect(profile.sourceChars.system).toBeGreaterThan(0);
    expect(JSON.stringify(profile)).not.toContain("private");
  });

  it("observes a complete stream without consuming or changing it", async () => {
    const events: Record<string, unknown>[] = [];
    const model = wrapLanguageModel({
      model: new MockLanguageModelV3({
        doStream: async () => ({ stream: new ReadableStream({ start(controller) {
          controller.enqueue({ type: "text-start", id: "t" });
          controller.enqueue({ type: "text-delta", id: "t", delta: "done" });
          controller.enqueue({ type: "text-end", id: "t" });
          controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
          controller.close();
        } }) }),
      }),
      middleware: createAgentRequestTelemetry({ turnId: "turn", role: "parent", emit: (event) => events.push(event) }),
    });
    expect(await streamText({ model, prompt: "hello" }).text).toBe("done");
    expect(events.map((event) => event.status)).toEqual(["started", "finished"]);
    expect(events[1]).toMatchObject({ cachedInputTokens: 40, outputTokens: 20, turnId: "turn" });
  });
});
