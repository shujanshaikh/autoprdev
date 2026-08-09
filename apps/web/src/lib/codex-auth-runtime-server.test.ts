import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ProxyProviderOptions = {
  basePath?: string;
  defaultModel?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

const { createChatGPTProxyProvider, proxyModel } = vi.hoisted(() => {
  const model = { modelId: "proxy-model" };
  const responses = vi.fn(() => model);
  const provider = Object.assign(vi.fn(() => model), { responses });

  return {
    createChatGPTProxyProvider: vi.fn((_options: ProxyProviderOptions) => provider),
    proxyModel: model,
  };
});

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
      deleteObject: vi.fn(async ({ id, versionCheck }: { id: string; versionCheck?: string }) => {
        const object = findById(id);
        if (!object) throw missing();
        if (versionCheck !== undefined && versionCheck !== object.metadata.versionId) throw conflict();
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

vi.mock("@autopr/chatgpt/ai", () => ({ createChatGPTProxyProvider }));

import {
  chatGPTAuth,
  CodexConnectionError,
  createCodexAgentGrant,
  createCodexResponsesModel,
  resolveCodexAgentGrant,
  vaultObjectName,
  WorkOSVaultStore,
} from "./codex-auth-runtime-server";

const expectedContext = {
  userId: "user-1",
  taskId: "autopr-agent" as const,
  contextId: "project-1:thread-1",
};

let previousWorkOSApiKey: string | undefined;

beforeEach(() => {
  previousWorkOSApiKey = process.env.WORKOS_API_KEY;
  process.env.WORKOS_API_KEY = "test-workos-key";
  vault.reset();
  vi.clearAllMocks();
});

afterEach(() => {
  if (previousWorkOSApiKey === undefined) {
    delete process.env.WORKOS_API_KEY;
  } else {
    process.env.WORKOS_API_KEY = previousWorkOSApiKey;
  }
});

describe("Codex agent grants", () => {
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

  it("runs models through a request-scoped proxy without exporting bearer tokens", async () => {
    const proxiedFetch = vi.fn(async () => Response.json({ models: [] }));
    const proxyFetchSpy = vi
      .spyOn(chatGPTAuth, "proxyFetch")
      .mockReturnValue(proxiedFetch as typeof fetch);
    const grantId = await createCodexAgentGrant({
      ...expectedContext,
      sessionCookieHeader: "lwc_session=signed-session",
    });

    const model = await createCodexResponsesModel({
      modelId: "gpt-test",
      reasoningEffort: "high",
      credentialsGrantId: grantId,
      credentialsGrantContext: expectedContext,
    });

    expect(model).toBe(proxyModel);
    expect(createChatGPTProxyProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        basePath: "/api/chatgpt",
        defaultModel: "gpt-test",
        headers: {
          "x-login-with-chatgpt-reasoning-effort": "high",
        },
      }),
    );

    const providerOptions = createChatGPTProxyProvider.mock.calls.at(-1)?.[0];
    expect(providerOptions?.fetch).toEqual(expect.any(Function));
    expect(objectsByName.size).toBe(1);
    await providerOptions?.fetch?.("/api/chatgpt/models");

    expect(objectsByName.size).toBe(0);
    expect(proxyFetchSpy).toHaveBeenCalledTimes(1);
    const sessionRequest = proxyFetchSpy.mock.calls[0]?.[0];
    expect(sessionRequest?.headers.get("cookie")).toBe("lwc_session=signed-session");
    expect(proxiedFetch).toHaveBeenCalledWith("/api/chatgpt/models", undefined);

    proxyFetchSpy.mockRestore();
  });
});

describe("WorkOSVaultStore", () => {
  it("does not delete a value renewed while expired cleanup is in flight", async () => {
    const store = new WorkOSVaultStore<number>("race-test");
    await store.set("key", 1, { ttlMs: -1 });
    const name = vaultObjectName("race-test", "key");
    const initial = objectsByName.get(name);
    if (!initial) throw new Error("Expected the initial Vault object.");
    const initialId = initial.id;
    const initialVersion = initial.metadata.versionId;

    vault.deleteObject.mockImplementationOnce(async ({ id, versionCheck }) => {
      expect(id).toBe(initialId);
      expect(versionCheck).toBe(initialVersion);
      const object = objectsByName.get(name);
      if (!object) throw Object.assign(new Error("Not found"), { status: 404 });
      object.value = JSON.stringify({ value: 2, expiresAt: Date.now() + 60_000 });
      object.metadata.versionId = "2";
      throw Object.assign(new Error("Conflict"), { status: 409 });
    });

    await expect(store.get("key")).resolves.toBe(2);
    expect(objectsByName.get(name)).toBeDefined();
  });

  it("retries an update when a stale object is deleted before the write", async () => {
    const store = new WorkOSVaultStore<number>("race-test");
    await store.set("key", 1);
    const name = vaultObjectName("race-test", "key");
    const initial = objectsByName.get(name);
    if (!initial) throw new Error("Expected the initial Vault object.");
    const initialId = initial.id;
    const initialVersion = initial.metadata.versionId;

    vault.updateObject.mockImplementationOnce(async ({ id, versionCheck }) => {
      expect(id).toBe(initialId);
      expect(versionCheck).toBe(initialVersion);
      objectsByName.delete(name);
      throw Object.assign(new Error("Not found"), { status: 404 });
    });

    await expect(
      store.update("key", (current) => ({ value: (current ?? 0) + 1 })),
    ).resolves.toBe(1);
    await expect(store.get("key")).resolves.toBe(1);
  });
});
