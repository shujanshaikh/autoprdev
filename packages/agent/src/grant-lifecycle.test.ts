import { describe, expect, it, vi } from "vitest";

import { createGrantLifecycle } from "./grant-lifecycle";

describe("createGrantLifecycle", () => {
  it("releases an owned grant only once", async () => {
    const revoke = vi.fn(async () => undefined);
    const lifecycle = createGrantLifecycle("grant-1", revoke);

    await Promise.all([lifecycle.release(), lifecycle.release()]);

    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("grant-1");
  });

  it("does not release a transferred grant", async () => {
    const revoke = vi.fn(async () => undefined);
    const lifecycle = createGrantLifecycle("grant-2", revoke);

    expect(lifecycle.transfer()).toBe("grant-2");
    await lifecycle.release();

    expect(revoke).not.toHaveBeenCalled();
  });
});
