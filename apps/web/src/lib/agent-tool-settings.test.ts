import { describe, expect, it, vi } from "vitest";
import { createSandboxTools } from "@autopr/agent/tools";
import { agentToolSettings } from "./agent-tool-settings";

describe.each(["daytona", "e2b"] as const)("%s project tool settings", (provider) => {
  it("removes computer and delegation tools while keeping coding tools", () => {
    const tools = createSandboxTools({ provider, cacheKey: "test" }, agentToolSettings({
      computerUseEnabled: false, subAgentsEnabled: false, demoEnabled: true,
    }, vi.fn()));
    expect(tools.computer).toBeUndefined();
    expect(tools["sub-agent"]).toBeUndefined();
    expect(tools.bash).toBeDefined();
    expect(tools.edit).toBeDefined();
  });

  it("preserves tools for legacy threads and lets each capability be disabled independently", () => {
    const legacy = createSandboxTools({ provider, cacheKey: "test" }, agentToolSettings({}, vi.fn()));
    expect(legacy.computer).toBeDefined();
    expect(legacy["sub-agent"]).toBeDefined();
    const tools = createSandboxTools({ provider, cacheKey: "test" }, agentToolSettings({ subAgentsEnabled: false }, vi.fn()));
    expect(tools.computer).toBeDefined();
    expect(tools["sub-agent"]).toBeUndefined();
  });
});
