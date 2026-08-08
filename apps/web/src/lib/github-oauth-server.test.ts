import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const initialGithubAppId = process.env.GITHUB_APP_ID;
const initialGithubAppPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;

function restoreEnvironment(name: "GITHUB_APP_ID" | "GITHUB_APP_PRIVATE_KEY", value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("Autopr GitHub App installation access", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnvironment("GITHUB_APP_ID", initialGithubAppId);
    restoreEnvironment("GITHUB_APP_PRIVATE_KEY", initialGithubAppPrivateKey);
  });

  it("accepts GitHub's PKCS#1 key and returns install or configure actions", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.GITHUB_APP_ID = "123456";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({
      type: "pkcs1",
      format: "pem",
    }).toString();

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const authorization = new Headers(init?.headers).get("Authorization");
      expect(authorization).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);

      if (url === "https://api.github.com/app") {
        return Response.json({ slug: "autopr-dev" });
      }
      if (url === "https://api.github.com/repos/acme/authorized/installation") {
        return Response.json({
          html_url: "https://github.com/organizations/acme/settings/installations/42",
          permissions: { contents: "write" },
        });
      }
      if (url === "https://api.github.com/repos/acme/read-only/installation") {
        return Response.json({
          html_url: "https://github.com/organizations/acme/settings/installations/42",
          permissions: { contents: "read" },
        });
      }
      if (url.includes("/repos/") && url.endsWith("/installation")) {
        return Response.json({ message: "Not Found" }, { status: 404 });
      }
      if (url === "https://api.github.com/orgs/acme/installation") {
        return Response.json({
          html_url: "https://github.com/organizations/acme/settings/installations/42",
        });
      }
      if (url.endsWith("/installation")) {
        return Response.json({ message: "Not Found" }, { status: 404 });
      }
      throw new Error(`Unexpected GitHub request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getGithubRepositoryInstallationStatus } = await import("./github-oauth-server");

    await expect(getGithubRepositoryInstallationStatus("acme", "widget")).resolves.toEqual({
      installed: false,
      action: "configure",
      installUrl: "https://github.com/organizations/acme/settings/installations/42",
    });
    await expect(getGithubRepositoryInstallationStatus("octocat", "hello-world")).resolves.toEqual({
      installed: false,
      action: "install",
      installUrl: "https://github.com/apps/autopr-dev/installations/new",
    });
    await expect(getGithubRepositoryInstallationStatus("acme", "read-only")).resolves.toEqual({
      installed: false,
      action: "configure",
      installUrl: "https://github.com/organizations/acme/settings/installations/42",
    });
    await expect(getGithubRepositoryInstallationStatus("acme", "authorized")).resolves.toEqual({
      installed: true,
      action: "installed",
      installUrl: "https://github.com/apps/autopr-dev/installations/new",
    });
  });

  it("requires the connected user to retain push permission", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ permission: "write" }))
      .mockResolvedValueOnce(Response.json({ permission: "read" }));
    vi.stubGlobal("fetch", fetchMock);
    const { requireGithubRepositoryWriteAccess } = await import("./github-oauth-server");

    await expect(requireGithubRepositoryWriteAccess(
      "oauth-token",
      "acme",
      "widget",
      "octocat",
    )).resolves.toBeUndefined();
    await expect(requireGithubRepositoryWriteAccess(
      "oauth-token",
      "acme",
      "widget",
      "octocat",
    )).rejects.toThrow("cannot push");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/widget/collaborators/octocat/permission",
      expect.objectContaining({ redirect: "error" }),
    );
  });
});
