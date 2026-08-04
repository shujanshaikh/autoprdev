import type { MobileSession } from "../types";

export async function commitRefreshedSession(options: {
  session: MobileSession;
  generation: number;
  currentGeneration: () => number;
  applySession: (session: MobileSession) => void;
  persistSession: (session: MobileSession | null) => Promise<void>;
}) {
  if (options.generation !== options.currentGeneration()) return null;

  options.applySession(options.session);
  await options.persistSession(options.session);

  if (options.generation !== options.currentGeneration()) {
    await options.persistSession(null);
    return null;
  }

  return options.session.accessToken;
}
