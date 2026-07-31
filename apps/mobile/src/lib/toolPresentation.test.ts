import { describe, expect, it } from "vitest";

import { exploreGroupSummary, shortDirectory, toolHeader } from "./toolPresentation";

describe("toolHeader", () => {
  it("labels a streaming edit by its action and file", () => {
    expect(toolHeader({
      type: "tool-edit",
      input: { path: "/repo/src/screens/ThreadScreen.tsx" },
      streaming: true,
      failed: false,
    })).toEqual({
      slug: "edit",
      label: "Editing",
      summary: "ThreadScreen.tsx",
      path: "/repo/src/screens/ThreadScreen.tsx",
      explore: false,
    });
  });

  it("switches a finished write to its past tense, and to a failure when it errored", () => {
    const input = { path: "a/b.ts" };
    expect(toolHeader({ type: "tool-write", input, streaming: false, failed: false }).label)
      .toBe("Created");
    expect(toolHeader({ type: "tool-write", input, streaming: false, failed: true }).label)
      .toBe("Write failed");
  });

  it("describes a shell command by what it does", () => {
    expect(toolHeader({
      type: "tool-bash",
      input: { command: "pnpm vitest run" },
      streaming: false,
      failed: false,
    })).toMatchObject({ label: "Run tests", summary: "pnpm vitest run", explore: false });
  });

  it("marks read-only tools as exploration and summarizes their input", () => {
    expect(toolHeader({
      type: "tool-grep",
      input: { path: "src", pattern: "useState" },
      streaming: false,
      failed: false,
    })).toMatchObject({ label: "Grep", summary: "src pattern=useState", explore: true });
  });

  it("uses the tool name for dynamic tools", () => {
    expect(toolHeader({
      type: "dynamic-tool",
      toolName: "sandboxInfo",
      input: {},
      streaming: false,
      failed: false,
    })).toMatchObject({ label: "SandboxInfo", explore: true });
  });
});

describe("shortDirectory", () => {
  it("keeps the last two directories of a long path", () => {
    expect(shortDirectory("/repo/apps/mobile/src/lib/diff.ts")).toBe("src/lib");
  });

  it("is empty for a bare file name", () => {
    expect(shortDirectory("diff.ts")).toBe("");
  });
});

describe("exploreGroupSummary", () => {
  it("counts repeated tools instead of repeating them", () => {
    expect(exploreGroupSummary(["Read", "Read", "Grep"])).toBe("Read ×2, Grep");
  });
});
