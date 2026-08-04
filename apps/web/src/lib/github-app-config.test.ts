import { describe, expect, it } from "vitest";

import {
  buildGithubAppInstallUrl,
  decodeGithubAppPrivateKey,
  getTrustedGithubInstallationUrl,
  GITHUB_APP_DISPLAY_NAME,
} from "./github-app-config";

describe("Autopr GitHub App configuration", () => {
  it("uses the product's requested display capitalization", () => {
    expect(GITHUB_APP_DISPLAY_NAME).toBe("Autopr");
  });

  it("accepts GitHub's downloaded PKCS#1 PEM", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nkey-data\n-----END RSA PRIVATE KEY-----";
    expect(decodeGithubAppPrivateKey(pem)).toBe(pem);
  });

  it("accepts escaped and base64-encoded PEM values", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nkey-data\n-----END PRIVATE KEY-----";
    expect(decodeGithubAppPrivateKey(pem.replace(/\n/g, "\\n"))).toBe(pem);
    expect(decodeGithubAppPrivateKey(Buffer.from(pem).toString("base64"))).toBe(pem);
  });

  it("builds only the official GitHub installation URL", () => {
    expect(buildGithubAppInstallUrl("autopr-dev")).toBe(
      "https://github.com/apps/autopr-dev/installations/new",
    );
    expect(() => buildGithubAppInstallUrl("autopr/dev")).toThrow("Invalid GitHub App slug.");
  });

  it("accepts only HTTPS GitHub installation management URLs", () => {
    expect(
      getTrustedGithubInstallationUrl(
        "https://github.com/organizations/acme/settings/installations/123",
      ),
    ).toBe("https://github.com/organizations/acme/settings/installations/123");
    expect(getTrustedGithubInstallationUrl("https://evil.example/installations/123")).toBeUndefined();
    expect(getTrustedGithubInstallationUrl("not-a-url")).toBeUndefined();
  });
});
