import { describe, expect, it } from "vitest";

import { createAgentPersistenceGrant, hashAgentPersistenceToken } from "./agent-persistence";

describe("agent persistence grants", () => {
  it("creates a high-entropy token with a reproducible one-way hash", async () => {
    const grant = await createAgentPersistenceGrant();

    expect(grant.token).toHaveLength(48);
    expect(grant.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(hashAgentPersistenceToken(grant.token)).resolves.toBe(grant.tokenHash);
  });

  it("does not reuse persistence credentials between runs", async () => {
    const first = await createAgentPersistenceGrant();
    const second = await createAgentPersistenceGrant();

    expect(second.token).not.toBe(first.token);
    expect(second.tokenHash).not.toBe(first.tokenHash);
  });
});
