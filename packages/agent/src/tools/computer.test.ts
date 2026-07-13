import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSandboxContext: vi.fn(),
}));

vi.mock("../sandbox", () => ({
  getSandboxContext: mocks.getSandboxContext,
}));

import { createDaytonaComputerTool } from "./computer";

describe("Daytona computer tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps screenshot bytes available to the model without serializing them to the chat stream", async () => {
    const screenshot = "a".repeat(2_400_000);
    mocks.getSandboxContext.mockResolvedValue({
      sandbox: {
        id: "sandbox-1",
        computerUse: {
          getStatus: vi.fn().mockResolvedValue({ status: "active" }),
          display: {
            getInfo: vi.fn().mockResolvedValue({
              displays: [{ isActive: true, width: 1920, height: 1080 }],
            }),
          },
          screenshot: {
            takeCompressed: vi.fn().mockResolvedValue({
              screenshot,
              sizeBytes: 1_800_000,
            }),
          },
        },
      },
      workDir: "/workspace/repo",
    });

    const computer = createDaytonaComputerTool({ cacheKey: "computer-test" });
    if (!computer.execute || !computer.toModelOutput) {
      throw new Error("Computer tool is not executable");
    }

    const output = await computer.execute(
      { actions: [{ type: "screenshot" }] },
      { toolCallId: "computer-call-1", messages: [] },
    ) as Exclude<Awaited<ReturnType<NonNullable<typeof computer.execute>>>, AsyncIterable<unknown>>;
    const serialized = JSON.stringify(output);

    expect(serialized).not.toContain(screenshot);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThan(10_000);
    expect(serialized).toContain('\\"payloadStripped\\":true');
    expect(serialized).toContain('\\"payloadLength\\":2400000');

    const modelOutput = await computer.toModelOutput({
      input: { actions: [{ type: "screenshot" }] },
      output,
      toolCallId: "computer-call-1",
    });
    expect(modelOutput.type).toBe("content");
    if (modelOutput.type !== "content") {
      throw new Error("Expected multimodal computer output");
    }

    const image = modelOutput.value.find((item) => item.type === "image-data");
    expect(image?.data).toBe(screenshot);
  });
});
