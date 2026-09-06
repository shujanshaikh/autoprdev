// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProjectPullRequest, type ProjectPullRequest } from "#/lib/project-pull-requests";
import { PullRequestWorkspace } from "./pull-request-workspace";

vi.mock("#/components/github/open-pull-request-dialog", () => ({ OpenGithubPullRequestDialog: () => null }));
vi.mock("./pull-request-detail", () => ({
  PullRequestDetail: ({ projectId, number }: { projectId: string; number: number }) => {
    const query = useProjectPullRequest(projectId, number);
    return <div>{query.data?.pullRequest.title}</div>;
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
