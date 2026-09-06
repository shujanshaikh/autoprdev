// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useProjectPullRequestChecks, useProjectPullRequestFiles } from "./project-pull-requests";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("revision-scoped pull request queries", () => {
  it.each([
    ["checks", useProjectPullRequestChecks],
    ["files", useProjectPullRequestFiles],
  ] as const)("keeps in-flight %s for an old commit out of the new commit's cache", async (view, useQuery) => {
    const oldSha = "a".repeat(40);
    const newSha = "b".repeat(40);
    let finishOldRequest!: (response: Response) => void;
    const oldRequest = new Promise<Response>((resolve) => { finishOldRequest = resolve; });
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const params = new URL(url, "https://autopr.test").searchParams;
      expect(params.get("view")).toBe(view);
      expect(params.get("headSha")).toBeTruthy();
      return params.get("headSha") === oldSha ? oldRequest : Response.json({ headSha: newSha, [view]: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, rerender } = renderHook(({ headSha }) => useQuery("project", 42, headSha), {
      initialProps: { headSha: oldSha }, wrapper,
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender({ headSha: newSha });
    await waitFor(() => expect(result.current.data).toMatchObject({ headSha: newSha }));

    finishOldRequest(Response.json({ headSha: oldSha, [view]: [] }));
    await waitFor(() => expect(client.getQueryData(["project", "project", "pull", 42, view, oldSha])).toMatchObject({ headSha: oldSha }));
    expect(result.current.data).toMatchObject({ headSha: newSha });
    client.clear();
  });
});
