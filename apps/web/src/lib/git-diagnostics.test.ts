import { describe, expect, it } from "vitest";

import { redactGitDiagnostic } from "./git-diagnostics";

describe("redactGitDiagnostic", () => {
  it("redacts hook credentials and explicitly known environment values", () => {
    const token = "github_pat_abcdefghijklmnopqrstuvwxyz123456";
    const output = [
      `TOKEN=${token}`,
      "Authorization: Bearer secret-header-value",
      "https://user:password@example.com/repo.git",
      "CUSTOM_VALUE=private-worktree-secret",
      "\u001b[31mred output\u001b[0m",
    ].join("\n");
    const redacted = redactGitDiagnostic(output, ["private-worktree-secret"]);
    expect(redacted).not.toContain(token);
    expect(redacted).not.toContain("secret-header-value");
    expect(redacted).not.toContain("user:password");
    expect(redacted).not.toContain("private-worktree-secret");
    expect(redacted).not.toContain("\u001b");
    expect(redacted).toContain("[REDACTED]");
  });

  it("bounds persisted diagnostics", () => {
    expect(redactGitDiagnostic("x".repeat(10_000))).toHaveLength(8_000);
  });
});
