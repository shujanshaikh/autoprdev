import { describe, expect, it, vi } from "vitest";

import type { MobileSession } from "../types";
import { commitRefreshedSession } from "./sessionGeneration";

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

  it("removes a refresh result when sign-out happens while it is being persisted", async () => {
    let generation = 0;
    let finishPersist: (() => void) | undefined;
    const firstPersist = new Promise<void>((resolve) => {
      finishPersist = resolve;
    });
    const applySession = vi.fn();
    const persistSession = vi.fn()
      .mockImplementationOnce(async () => await firstPersist)
      .mockResolvedValueOnce(undefined);

    const result = commitRefreshedSession({
      session: refreshedSession,
      generation,
      currentGeneration: () => generation,
      applySession,
      persistSession,
    });
    generation += 1;
    finishPersist?.();

    await expect(result).resolves.toBeNull();
    expect(applySession).toHaveBeenCalledWith(refreshedSession);
    expect(persistSession).toHaveBeenNthCalledWith(1, refreshedSession);
    expect(persistSession).toHaveBeenNthCalledWith(2, null);
  });
});
