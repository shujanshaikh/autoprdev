import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StoredVaultObject = {
  id: string;
  name: string;
  value: string;
  metadata: { versionId: string };
};

const { objectsByName, vault, oauth } = vi.hoisted(() => {
  const stored = new Map<string, StoredVaultObject>();
  let nextId = 1;
  const missing = () => Object.assign(new Error("Not found"), { status: 404 });
  const findById = (id: string) => [...stored.values()].find((object) => object.id === id);

  return {
    objectsByName: stored,
    oauth: {
      requestDeviceCode: vi.fn(),
      pollDeviceToken: vi.fn(),
      fetchModels: vi.fn(),
      refreshTokens: vi.fn(),
    },
    vault: {
      createObject: vi.fn(async (input: { name: string; value: string }) => {
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
      updateObject: vi.fn(async ({ id, value }: { id: string; value: string }) => {
        const object = findById(id);
        if (!object) throw missing();
        object.value = value;
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

vi.mock("@autopr/grok/core", async (importOriginal) => ({
  ...await importOriginal<typeof import("@autopr/grok/core")>(),
  requestGrokDeviceCode: oauth.requestDeviceCode,
  pollGrokDeviceToken: oauth.pollDeviceToken,
  fetchGrokModels: oauth.fetchModels,
  refreshGrokTokens: oauth.refreshTokens,
}));

import {
  disconnectGrok,
  getGrokConnectionStatus,
  pollGrokDeviceAuthorization,
  startGrokDeviceAuthorization,
} from "./grok-auth-runtime-server";

let previousWorkOSApiKey: string | undefined;

beforeEach(() => {
  previousWorkOSApiKey = process.env.WORKOS_API_KEY;
  process.env.WORKOS_API_KEY = "test-workos-key";
  vault.reset();
  vi.clearAllMocks();
  oauth.requestDeviceCode.mockResolvedValue({
    deviceCode: "device-1",
    userCode: "ABCD-EFGH",
    verificationUri: "https://x.ai/device",
    expiresInSeconds: 600,
    intervalSeconds: 1,
  });
  oauth.pollDeviceToken.mockResolvedValue({
    status: "success",
    tokens: {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 3_600_000,
    },
  });
  oauth.refreshTokens.mockResolvedValue({
    accessToken: "access-refreshed",
    refreshToken: "refresh-refreshed",
    expiresAt: Date.now() + 3_600_000,
  });
});

afterEach(() => {
  if (previousWorkOSApiKey === undefined) delete process.env.WORKOS_API_KEY;
  else process.env.WORKOS_API_KEY = previousWorkOSApiKey;
});

describe("Grok connection status", () => {
  it("stays connected when subscription model discovery is unavailable", async () => {
    oauth.fetchModels.mockRejectedValue(new Error("API-key-only model discovery"));
    const flow = await startGrokDeviceAuthorization("user-1");

    await expect(pollGrokDeviceAuthorization("user-1", flow.flowId)).resolves.toEqual({
      status: "connected",
    });
    await expect(getGrokConnectionStatus("user-1")).resolves.toMatchObject({
      connected: true,
      models: expect.arrayContaining(["grok-build-0.1", "grok-4.5"]),
    });
    expect(objectsByName.size).toBe(1);
  });

  it("does not restore credentials when a refresh finishes after disconnect", async () => {
    let finishRefresh: ((tokens: {
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
    }) => void) | undefined;
    oauth.pollDeviceToken.mockResolvedValue({
      status: "success",
      tokens: {
        accessToken: "access-expiring",
        refreshToken: "refresh-1",
        expiresAt: Date.now() + 30_000,
      },
    });
    oauth.refreshTokens.mockImplementation(() => new Promise((resolve) => {
      finishRefresh = resolve;
    }));
    const flow = await startGrokDeviceAuthorization("user-1");
    await pollGrokDeviceAuthorization("user-1", flow.flowId);

    const status = getGrokConnectionStatus("user-1");
    await vi.waitFor(() => expect(oauth.refreshTokens).toHaveBeenCalledWith("refresh-1"));
    await disconnectGrok("user-1");
    finishRefresh?.({
      accessToken: "access-refreshed",
      refreshToken: "refresh-refreshed",
      expiresAt: Date.now() + 3_600_000,
    });

    await expect(status).rejects.toThrow("disconnected while refreshing");
    await expect(getGrokConnectionStatus("user-1")).resolves.toEqual({ connected: false });
    expect(objectsByName.size).toBe(0);
  });
});
