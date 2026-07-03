/**
 * Race an async task against a timeout. Rejects with the provided error when
 * the budget elapses first. The timer is always cleared, and a non-positive
 * budget rejects immediately without starting the task's timer.
 */
export async function raceWithTimeout<T>(
  task: () => Promise<T>,
  timeoutMs: number,
  createTimeoutError: () => Error,
): Promise<T> {
  if (timeoutMs <= 0) {
    throw createTimeoutError();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      task(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(createTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
