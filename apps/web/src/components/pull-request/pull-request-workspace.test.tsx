// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProjectPullRequest, type ProjectPullRequest } from "#/lib/project-pull-requests";
import { PullRequestWorkspace } from "./pull-request-workspace";
import { Route as PullsRoute } from "#/routes/project/$projectId/pulls";

vi.mock("#/components/github/open-pull-request-dialog", () => ({ OpenGithubPullRequestDialog: () => null }));
vi.mock("./pull-request-detail", () => ({
  PullRequestDetail: ({ projectId, number, onBack }: { projectId: string; number: number; onBack: () => void }) => {
    const query = useProjectPullRequest(projectId, number);
    return <div data-testid="pull-detail">{query.data?.pullRequest.title}<button type="button" onClick={onBack}>Back to list</button></div>;
  },
}));

const openPull = {
  id: 1, number: 1, title: "Open change", state: "open", draft: false,
  htmlUrl: "https://github.com/acme/widget/pull/1", user: "reviewer",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  headRef: "fix", baseRef: "main",
} satisfies ProjectPullRequest;
const mergedPull = { ...openPull, id: 2, number: 2, title: "Merged change", state: "closed", mergedAt: "2026-01-02T00:00:00Z" } satisfies ProjectPullRequest;
const closedPull = { ...openPull, id: 3, number: 3, title: "Closed change", state: "closed" } satisfies ProjectPullRequest;
const list = { project: { projectId: "project", repoFullName: "acme/widget", githubUrl: "https://github.com/acme/widget" }, pulls: [openPull, mergedPull, closedPull] };

function renderWorkspace(number?: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><PullRequestWorkspace projectId="project" currentPullRequestNumber={number} /></QueryClientProvider>);
  return client;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("pull request workspace", () => {
  it("keeps page selection, list navigation, and browser history in the URL", async () => {
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      const number = new URL(url, "https://autopr.test").searchParams.get("number");
      return Response.json(number ? { pullRequest: list.pulls.find((pull) => pull.number === Number(number)) } : list);
    }));
    const root = createRootRoute();
    Object.assign(PullsRoute.options, { path: "/project/$projectId/pulls", getParentRoute: () => root });
    const history = createMemoryHistory({ initialEntries: ["/project/project/pulls?number=1"] });
    const router = createRouter({ routeTree: root.addChildren([PullsRoute]), history });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);

    await screen.findByRole("button", { name: /Merged change/ });
    fireEvent.click(screen.getByRole("button", { name: /Merged change/ }));
    await waitFor(() => expect(router.state.location.search).toEqual({ number: 2 }));
    await waitFor(() => expect(screen.getByTestId("pull-detail").textContent).toContain("Merged change"));
    fireEvent.click(screen.getByRole("button", { name: "Back to list" }));
    await screen.findByText("Select a pull request to review");
    expect(router.state.location.search).toEqual({});

    history.back();
    await waitFor(() => expect(screen.getByTestId("pull-detail").textContent).toContain("Merged change"));
    expect(router.state.location.search).toEqual({ number: 2 });
    history.back();
    await waitFor(() => expect(screen.getByTestId("pull-detail").textContent).toContain("Open change"));
    expect(router.state.location.search).toEqual({ number: 1 });
  });

  it("keeps embedded panel selection local and allows returning to the list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => Response.json(
      url.includes("number=1") ? { pullRequest: openPull } : list,
    )));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={client}><PullRequestWorkspace projectId="project" currentPullRequestNumber={1} variant="panel" /></QueryClientProvider>);
    await screen.findByText("Open change");
    fireEvent.click(screen.getByRole("button", { name: "Back to list" }));
    fireEvent.click(await screen.findByRole("button", { name: /Open change/ }));
    expect(await screen.findByTestId("pull-detail")).toBeTruthy();
  });

  it("filters merged PRs separately from closed PRs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json(list)));
    renderWorkspace();
    await screen.findByText("Merged change");
    fireEvent.click(screen.getByRole("button", { name: /^merged/i, pressed: false }));
    expect(screen.queryByText("Closed change")).toBeNull();
    expect(screen.getByText("Merged change")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^closed/i, pressed: false }));
    expect(screen.queryByText("Merged change")).toBeNull();
    expect(screen.getByText("Closed change")).toBeTruthy();
  });

  it("refreshes the selected PR along with the repository list", async () => {
    let title = "Original PR title";
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => Response.json(
      url.includes("number=1") ? { pullRequest: { ...openPull, title } } : list,
    )));
    renderWorkspace(1);
    await screen.findByText("Original PR title");
    const refresh = screen.getByRole<HTMLButtonElement>("button", { name: "Refresh pull requests" });
    await waitFor(() => expect(refresh.disabled).toBe(false));
    title = "Updated PR title";
    fireEvent.click(refresh);
    await screen.findByText("Updated PR title");
    expect(screen.queryByText("Original PR title")).toBeNull();
  });

  it("keeps a directly selected PR readable when the list fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => url.includes("number=1")
      ? Response.json({ pullRequest: { ...openPull, title: "Selected PR detail" } })
      : Response.json({ error: "Rate limited" }, { status: 403 })));
    renderWorkspace(1);
    await screen.findByText("Selected PR detail");
    expect(await screen.findByText("Could not load pull requests")).toBeTruthy();
  });
});
