import { nanoid } from "nanoid";

export async function hashAgentPersistenceToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createAgentPersistenceGrant() {
  const token = nanoid(48);

  return {
    token,
    tokenHash: await hashAgentPersistenceToken(token),
  };
}
