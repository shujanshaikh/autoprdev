export interface GrantLifecycle<T> {
  readonly grant: T;
  release(): Promise<void>;
  transfer(): T;
}

/**
 * Owns a revocable grant until responsibility is explicitly transferred.
 * Releasing is idempotent so competing terminal paths can share the same
 * cleanup operation without revoking the grant more than once.
 */
export function createGrantLifecycle<T>(
  grant: T,
  revoke: (grant: T) => Promise<void>,
): GrantLifecycle<T> {
  let state: "owned" | "released" | "transferred" = "owned";
  let releasePromise: Promise<void> | undefined;

  return {
    grant,
    release() {
      if (state !== "owned") {
        return releasePromise ?? Promise.resolve();
      }

      state = "released";
      releasePromise = revoke(grant);
      return releasePromise;
    },
    transfer() {
      if (state !== "owned") {
        throw new Error(`Cannot transfer a grant that has already been ${state}.`);
      }

      state = "transferred";
      return grant;
    },
  };
}
