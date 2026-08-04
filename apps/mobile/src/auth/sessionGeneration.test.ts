import { describe, expect, it, vi } from "vitest";

import type { MobileSession } from "../types";
import { commitRefreshedSession, createSessionPersister } from "./sessionGeneration";

const refreshedSession: MobileSession = {
  accessToken: "new-access-token",
  refreshToken: "new-refresh-token",
  user: {
    id: "user-1",
    email: "user@example.com",
    firstName: null,
    lastName: null,
    profilePictureUrl: null,
  },
};

const signedInSession: MobileSession = {
  accessToken: "signed-in-access-token",
  refreshToken: "signed-in-refresh-token",
  user: {
    id: "user-2",
    email: "other@example.com",
    firstName: null,
    lastName: null,
    profilePictureUrl: null,
  },
};

describe("commitRefreshedSession", () => {
  it("discards a refresh response that completes after sign-out", async () => {
    const generation = 1;
    const applySession = vi.fn();
    const persistSession = vi.fn(async () => undefined);

    await expect(commitRefreshedSession({
      session: refreshedSession,
      generation: 0,
      currentGeneration: () => generation,
      applySession,
      persistSession,
    })).resolves.toBeNull();

    expect(applySession).not.toHaveBeenCalled();
    expect(persistSession).not.toHaveBeenCalled();
  });

  it("returns null without another write when the generation changes mid-persist", async () => {
    let generation = 0;
    let finishPersist: (() => void) | undefined;
    const firstPersist = new Promise<void>((resolve) => {
      finishPersist = resolve;
    });
    const applySession = vi.fn();
    const persistSession = vi.fn()
      .mockImplementationOnce(async () => await firstPersist)
      .mockResolvedValue(undefined);

    const result = commitRefreshedSession({
      session: refreshedSession,
      generation: 0,
      currentGeneration: () => generation,
      applySession,
      persistSession,
    });
    generation += 1;
    finishPersist?.();

    await expect(result).resolves.toBeNull();
    expect(applySession).toHaveBeenCalledWith(refreshedSession);
    expect(persistSession).toHaveBeenCalledTimes(1);
    expect(persistSession).toHaveBeenCalledWith(refreshedSession, 0);
  });
});

describe("createSessionPersister", () => {
  it("drops a stale-generation write queued behind a blocked write", async () => {
    let generation = 0;
    const persisted: Array<MobileSession | null> = [];
    let openGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const persist = vi.fn()
      .mockImplementationOnce(async (session: MobileSession | null) => {
        await gate;
        persisted.push(session);
      })
      .mockImplementation(async (session: MobileSession | null) => {
        persisted.push(session);
      });
    const persistSession = createSessionPersister({
      currentGeneration: () => generation,
      persist,
    });

    // A stale refresh starts persisting and blocks inside the store write.
    const refreshWrite = persistSession(refreshedSession, 0);
    await Promise.resolve();
    // Sign-out, then a fresh sign-in, queue their writes behind it.
    generation = 1;
    const signOutWrite = persistSession(null, 1);
    generation = 2;
    const signInWrite = persistSession(signedInSession, 2);
    openGate?.();

    await Promise.all([refreshWrite, signOutWrite, signInWrite]);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persisted).toEqual([refreshedSession, signedInSession]);
  });

  it("keeps accepting writes after a persist failure", async () => {
    const persist = vi.fn()
      .mockRejectedValueOnce(new Error("SecureStore unavailable"))
      .mockResolvedValue(undefined);
    const persistSession = createSessionPersister({
      currentGeneration: () => 0,
      persist,
    });

    await expect(persistSession(refreshedSession, 0))
      .rejects.toThrow("SecureStore unavailable");
    await expect(persistSession(signedInSession, 0)).resolves.toBeUndefined();
    expect(persist).toHaveBeenCalledTimes(2);
  });
});
