import { describe, expect, it } from "vitest";

import { buildThreadStartNavigation } from "./thread-start-navigation";

describe("buildThreadStartNavigation", () => {
  it("keeps the initial prompt in the masked route handoff", () => {
    const navigation = buildThreadStartNavigation({
      projectId: "project_123",
      threadId: "thread_456",
      prompt: "Fix the first-load refresh",
      model: "gpt-5.5",
      reasoningEffort: "medium",
    });

    expect(navigation.search).toEqual({
      prompt: "Fix the first-load refresh",
      model: "gpt-5.5",
      reasoningEffort: "medium",
    });
    expect(navigation.mask).toEqual({
      to: "/project/$projectId/thread/$threadId",
      params: { projectId: "project_123", threadId: "thread_456" },
      search: {},
    });
  });

  it("omits empty optional handoff values", () => {
    const navigation = buildThreadStartNavigation({
      projectId: "project_123",
      threadId: "thread_456",
      reasoningEffort: "low",
    });

    expect(navigation.search).toEqual({ reasoningEffort: "low" });
  });
});
