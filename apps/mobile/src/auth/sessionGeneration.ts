import type { MobileSession } from "../types";

export async function commitRefreshedSession(options: {
  session: MobileSession;
  generation: number;
  currentGeneration: () => number;
  applySession: (session: MobileSession) => void;
  persistSession: (session: MobileSession | null, generation: number) => Promise<void>;
}) {
  if (options.generation !== options.currentGeneration()) return null;

  options.applySession(options.session);
  await options.persistSession(options.session, options.generation);

  if (options.generation !== options.currentGeneration()) return null;

  return options.session.accessToken;
}

/**
 * Serializes session writes so the generation check and the write are atomic:
 * a write is executed only if its generation is still current once all writes
 * queued ahead of it have settled, so a stale flow can never overwrite the
 * persisted state of a newer authentication flow.
 */
export function createSessionPersister(options: {
  currentGeneration: () => number;
  persist: (session: MobileSession | null) => Promise<void>;
}) {
  let queue: Promise<void> = Promise.resolve();
  return (session: MobileSession | null, generation: number): Promise<void> => {
    const write = queue.then(async () => {
      if (generation !== options.currentGeneration()) return;
      await options.persist(session);
    });
    // Keep the chain alive for later writes even if this one rejects.
    queue = write.catch(() => undefined);
    return write;
  };
}
