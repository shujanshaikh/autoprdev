// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useActiveRunTimer } from "./use-active-run-timer";

afterEach(cleanup);

describe("useActiveRunTimer", () => {
  it("starts every new run from its own timestamp", () => {
    const { result } = renderHook(() => useActiveRunTimer());

    act(() => result.current.startNewRun(10_000));
    expect(result.current.startedAt).toBe(10_000);
    expect(result.current.startedAtRef.current).toBe(10_000);

    act(() => result.current.ensureRunStarted(20_000));
    expect(result.current.startedAt).toBe(10_000);

    act(() => result.current.startNewRun(30_000));
    expect(result.current.startedAt).toBe(30_000);
    expect(result.current.startedAtRef.current).toBe(30_000);
  });

  it("clears both the rendered and imperative timestamps", () => {
    const { result } = renderHook(() => useActiveRunTimer());

    act(() => result.current.startNewRun(10_000));
    act(() => result.current.clearRun());

    expect(result.current.startedAt).toBeUndefined();
    expect(result.current.startedAtRef.current).toBeUndefined();
  });
});
