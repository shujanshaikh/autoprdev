import { raceWithTimeout } from "./timeout";

const fileMutationQueues = new Map<string, Promise<void>>();
let registrationQueue = Promise.resolve();

export function createFileMutationQueueKey(sandboxId: string, remotePath: string): string {
  return JSON.stringify([sandboxId, remotePath]);
}

type TimeoutBudget = number | (() => number);

export interface FileMutationQueueOptions {
  /** Maximum time to wait for earlier mutations of the same file before giving up. */
  waitTimeoutMs?: TimeoutBudget;
  /** Error to throw when the wait for earlier mutations times out. */
  createWaitTimeoutError?: () => Error;
  /**
   * Maximum time the caller waits for its own mutation before giving up. The
   * mutation keeps running and the queue stays locked until it settles, so
   * later mutations of the same file never overlap a still-active one.
   */
  runTimeoutMs?: TimeoutBudget;
  /** Error to throw when the caller's own mutation times out. */
  createRunTimeoutError?: () => Error;
}

function resolveTimeoutBudget(budget: TimeoutBudget | undefined): number | undefined {
  return typeof budget === "function" ? budget() : budget;
}

/**
 * Serialize mutations for the same remote file while allowing unrelated files
 * to keep mutating in parallel.
 *
 * Timeouts only unblock the caller; they never release the queue early. The
 * queue entry for this mutation resolves when the mutation itself settles, and
 * the map entry is cleaned up when the chained queue actually resolves, so a
 * timed-out waiter can never unlock the file for later writers while an
 * earlier mutation is still running.
 */
export async function withFileMutationQueue<T>(
  key: string,
  fn: () => Promise<T>,
  options?: FileMutationQueueOptions,
): Promise<T> {
  const registration = registrationQueue.then(() => {
    const currentQueue = fileMutationQueues.get(key) ?? Promise.resolve();

    let releaseNext!: () => void;
    const nextQueue = new Promise<void>((resolveQueue) => {
      releaseNext = resolveQueue;
    });
    const chainedQueue = currentQueue.then(() => nextQueue);
    fileMutationQueues.set(key, chainedQueue);

    // Clean up only when this link in the chain has actually resolved, so a
    // timed-out caller cannot delete the entry while work is still pending.
    void chainedQueue.then(() => {
      if (fileMutationQueues.get(key) === chainedQueue) {
        fileMutationQueues.delete(key);
      }
    });

    return { currentQueue, releaseNext };
  });

  registrationQueue = registration.then(
    () => undefined,
    () => undefined,
  );

  const { currentQueue, releaseNext } = await registration;

  const waitBudget = resolveTimeoutBudget(options?.waitTimeoutMs);

  try {
    if (waitBudget !== undefined) {
      await raceWithTimeout(
        () => currentQueue,
        waitBudget,
        options?.createWaitTimeoutError ?? (() => new Error("Timed out waiting for pending mutations of the same file.")),
      );
    } else {
      await currentQueue;
    }
  } catch (error) {
    // We never acquired the lock. Release our link only after the predecessor
    // settles so later waiters keep strict ordering.
    void currentQueue.then(releaseNext, releaseNext);
    throw error;
  }

  // Lock acquired: run the mutation and release the queue only when it
  // settles, even if the caller below stops waiting for it.
  const mutationPromise = Promise.resolve().then(fn);
  void mutationPromise.then(
    () => releaseNext(),
    () => releaseNext(),
  );

  const runBudget = resolveTimeoutBudget(options?.runTimeoutMs);

  if (runBudget === undefined) {
    return mutationPromise;
  }

  return raceWithTimeout(
    () => mutationPromise,
    runBudget,
    options?.createRunTimeoutError ?? (() => new Error("Timed out while running a file mutation.")),
  );
}
