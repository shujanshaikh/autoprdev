import { describe, expect, it, vi } from "vitest";

import { createE2BTools } from "./e2b";

describe("E2B tools", () => {
  it("includes the shared sub-agent tool when configured", () => {
    const tools = createE2BTools(
      { provider: "e2b", sandboxId: "sandbox-1" },
      { subAgent: { run: vi.fn() } },
    );

    expect(tools).toHaveProperty("sub-agent");
  });
});
