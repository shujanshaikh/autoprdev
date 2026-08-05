import { beforeEach, describe, expect, it, vi } from "vitest";

type StoredVaultObject = {
  id: string;
  name: string;
  value: string;
  metadata: { versionId: string };
};

const { objectsByName, vault } = vi.hoisted(() => {
  const stored = new Map<string, StoredVaultObject>();
  let nextId = 1;

  const missing = () => Object.assign(new Error("Not found"), { status: 404 });
  const conflict = () => Object.assign(new Error("Conflict"), { status: 409 });
  const findById = (id: string) =>
    [...stored.values()].find((object) => object.id === id);

  return {
    objectsByName: stored,
    vault: {
      createObject: vi.fn(async (input: {
        name: string;
        value: string;
        context: Record<string, string>;
      }) => {
        if (stored.has(input.name)) throw conflict();
        const object: StoredVaultObject = {
          id: `vault-${nextId++}`,
          name: input.name,
          value: input.value,
          metadata: { versionId: "1" },
        };
        stored.set(input.name, object);
        return object;
      }),
      readObject: vi.fn(async ({ id }: { id: string }) => {
        const object = findById(id);
        if (!object) throw missing();
        return object;
      }),
      readObjectByName: vi.fn(async (name: string) => {
        const object = stored.get(name);
        if (!object) throw missing();
        return object;
      }),
      updateObject: vi.fn(async (input: {
        id: string;
        value: string;
        versionCheck?: string;
      }) => {
        const object = findById(input.id);
        if (!object) throw missing();
        if (input.versionCheck !== object.metadata.versionId) throw conflict();
        object.value = input.value;
        object.metadata.versionId = String(Number(object.metadata.versionId) + 1);
        return object;
      }),
      deleteObject: vi.fn(async ({ id }: { id: string }) => {
        const object = findById(id);
        if (!object) throw missing();
        stored.delete(object.name);
      }),
      reset() {
        stored.clear();
        nextId = 1;
      },
    },
  };
});

vi.mock("@workos-inc/node", () => ({
  WorkOS: class {
    vault = vault;
  },
}));

import {
  CodexConnectionError,
  createCodexAgentGrant,
  resolveCodexAgentGrant,
} from "./codex-auth-runtime-server";

const expectedContext = {
  userId: "user-1",
  taskId: "autopr-agent" as const,
  contextId: "project-1:thread-1",
};

describe("Codex agent grants", () => {
  beforeEach(() => {
    process.env.WORKOS_API_KEY = "test-workos-key";
    vault.reset();
    vi.clearAllMocks();
  });

  it("atomically consumes and deletes a grant so it cannot be replayed", async () => {
    const grantId = await createCodexAgentGrant({
      ...expectedContext,
      sessionCookieHeader: "session=secret",
    });

    await expect(resolveCodexAgentGrant(grantId, expectedContext)).resolves.toMatchObject({
      sessionCookieHeader: "session=secret",
    });
    expect(objectsByName.size).toBe(0);
    await expect(resolveCodexAgentGrant(grantId, expectedContext)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects a grant outside its bound user, task, and run context", async () => {
    const grantId = await createCodexAgentGrant({
      ...expectedContext,
      sessionCookieHeader: "session=secret",
    });

    await expect(resolveCodexAgentGrant(grantId, {
      ...expectedContext,
      contextId: "project-2:thread-9",
    })).rejects.toBeInstanceOf(CodexConnectionError);
    expect(objectsByName.size).toBe(0);
  });
});
