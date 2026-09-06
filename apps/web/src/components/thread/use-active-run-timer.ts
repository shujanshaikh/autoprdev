import { useCallback, useRef, useState } from "react";

/** Keeps the rendered timer in sync with callbacks that need the current run start. */
export function useActiveRunTimer() {
  const [startedAt, setStartedAtState] = useState<number>();
  const startedAtRef = useRef<number | undefined>(undefined);

  const startNewRun = useCallback((timestamp: number) => {
    startedAtRef.current = timestamp;
    setStartedAtState(timestamp);
  }, []);

  const ensureRunStarted = useCallback((timestamp: number) => {
    if (startedAtRef.current !== undefined) {
      return;
    }

    startedAtRef.current = timestamp;
    setStartedAtState(timestamp);
  }, []);

  const clearRun = useCallback(() => {
    startedAtRef.current = undefined;
    setStartedAtState(undefined);
  }, []);

  return {
    startedAt,
    startedAtRef,
    startNewRun,
    ensureRunStarted,
    clearRun,
  };
}
