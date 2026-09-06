import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  daytona: vi.fn(() => ({ bash: { title: "daytona-bash" } })),
  e2b: vi.fn(() => ({ bash: { title: "e2b-bash" } })),
}));

vi.mock("./providers/daytona", () => ({
  createDaytonaTools: mocks.daytona,
}));

vi.mock("./providers/e2b", () => ({
  createE2BTools: mocks.e2b,
}));

import { createSandboxTools } from "./index";

describe("sandbox tool provider selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses E2B tools only when the project selected E2B", () => {
    const run = vi.fn();
    const options = { subAgent: { run } };
    const tools = createSandboxTools(
      { provider: "e2b", sandboxId: "sandbox-1" },
      options,
    );

    expect(tools).toEqual({ bash: { title: "e2b-bash" } });
    expect(mocks.e2b).toHaveBeenCalledWith(
      { provider: "e2b", sandboxId: "sandbox-1" },
      options,
    );
    expect(mocks.daytona).not.toHaveBeenCalled();
  });

  it("keeps Daytona as the backward-compatible default", () => {
    const tools = createSandboxTools({ sandboxId: "sandbox-1" });

    expect(tools).toEqual({ bash: { title: "daytona-bash" } });
    expect(mocks.daytona).toHaveBeenCalledOnce();
    expect(mocks.e2b).not.toHaveBeenCalled();
  });
});
