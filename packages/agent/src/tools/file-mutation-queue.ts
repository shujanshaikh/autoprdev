const fileMutationQueues = new Map<string, Promise<void>>();
let registrationQueue = Promise.resolve();

export function createFileMutationQueueKey(sandboxId: string, remotePath: string): string {
  return JSON.stringify([sandboxId, remotePath]);
}

/**
 * Serialize mutations for the same remote file while allowing unrelated files
 * to keep mutating in parallel.
 */
export async function withFileMutationQueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const registration = registrationQueue.then(() => {
    const currentQueue = fileMutationQueues.get(key) ?? Promise.resolve();

    let releaseNext!: () => void;
    const nextQueue = new Promise<void>((resolveQueue) => {
      releaseNext = resolveQueue;
    });
    const chainedQueue = currentQueue.then(() => nextQueue);
    fileMutationQueues.set(key, chainedQueue);

    return { currentQueue, chainedQueue, releaseNext };
  });

  registrationQueue = registration.then(
    () => undefined,
    () => undefined,
  );

  const { currentQueue, chainedQueue, releaseNext } = await registration;
  await currentQueue;

  try {
    return await fn();
  } finally {
    releaseNext();
    if (fileMutationQueues.get(key) === chainedQueue) {
      fileMutationQueues.delete(key);
    }
  }
}
