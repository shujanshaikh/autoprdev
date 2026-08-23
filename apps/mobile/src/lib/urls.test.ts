import { afterEach, describe, expect, it } from "vitest";

import { externalUrlForOpen, imageHostLabel, isFirstPartyImageUrl, trustedImageHosts } from "./urls";

afterEach(() => {
  delete process.env.EXPO_PUBLIC_TRUSTED_FILE_HOSTS;
});

describe("externalUrlForOpen", () => {
  it("allows https URLs", () => {
    expect(externalUrlForOpen("https://github.com/owner/repo/pull/1")?.protocol).toBe("https:");
  });

  it("allows mailto URLs", () => {
    expect(externalUrlForOpen("mailto:team@example.com")?.protocol).toBe("mailto:");
  });

  it("trims surrounding whitespace", () => {
    expect(externalUrlForOpen("  https://example.com/path  ")?.hostname).toBe("example.com");
  });

  it("rejects other schemes and malformed URLs", () => {
    const rejected = [
      "intent://scan/#Intent;scheme=zxing;package=com.example;end",
      "tel:+15551234567",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "ftp://example.com/file",
      "not a url",
      "",
    ];
    for (const raw of rejected) {
      expect(externalUrlForOpen(raw)).toBeNull();
    }
  });
});

describe("trustedImageHosts", () => {
  it("always trusts Cloudflare R2 presigned URLs", () => {
    expect(trustedImageHosts()).toContain(".r2.cloudflarestorage.com");
  });

  it("includes hosts from EXPO_PUBLIC_TRUSTED_FILE_HOSTS", () => {
    process.env.EXPO_PUBLIC_TRUSTED_FILE_HOSTS = "files.example.com, .proxy.daytona.example.com ,";
    expect(trustedImageHosts()).toContain("files.example.com");
    expect(trustedImageHosts()).toContain(".proxy.daytona.example.com");
  });
});

describe("isFirstPartyImageUrl", () => {
  it("allows embedded data images, which perform no network fetch", () => {
    expect(isFirstPartyImageUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
  });

  it("allows Cloudflare R2 presigned URLs", () => {
    expect(
      isFirstPartyImageUrl(
        "https://bucket.account.r2.cloudflarestorage.com/key?X-Amz-Signature=abc",
      ),
    ).toBe(true);
  });

  it("allows exact and suffix hosts from EXPO_PUBLIC_TRUSTED_FILE_HOSTS", () => {
    process.env.EXPO_PUBLIC_TRUSTED_FILE_HOSTS = "files.example.com,.proxy.daytona.example.com";
    expect(isFirstPartyImageUrl("https://files.example.com/image.png")).toBe(true);
    expect(isFirstPartyImageUrl("https://3000-sandbox.proxy.daytona.example.com/shot.png")).toBe(
      true,
    );
  });

  it("rejects third-party origins", () => {
    expect(isFirstPartyImageUrl("https://tracker.example.com/pixel.png")).toBe(false);
  });

  it("rejects non-https URLs even on trusted hosts", () => {
    expect(
      isFirstPartyImageUrl("http://bucket.account.r2.cloudflarestorage.com/key"),
    ).toBe(false);
  });

  it("rejects lookalike hosts", () => {
    expect(isFirstPartyImageUrl("https://evilr2.cloudflarestorage.com/x.png")).toBe(false);
    expect(isFirstPartyImageUrl("https://r2.cloudflarestorage.com.evil.com/x.png")).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(isFirstPartyImageUrl("not a url")).toBe(false);
    expect(isFirstPartyImageUrl("")).toBe(false);
  });
});

describe("imageHostLabel", () => {
  it("names the host for remote URLs", () => {
    expect(imageHostLabel("https://tracker.example.com/pixel.png")).toBe("tracker.example.com");
  });

  it("labels embedded data", () => {
    expect(imageHostLabel("data:image/png;base64,iVBORw0KGgo=")).toBe("embedded data");
  });

  it("is empty for malformed URLs", () => {
    expect(imageHostLabel("not a url")).toBe("");
  });
});
