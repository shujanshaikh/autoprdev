import { describe, expect, it } from "vitest";

import { trustedAttachmentImageUrl } from "./attachmentUrls";

const trustedOrigin = "https://assets.example.com";

describe("trustedAttachmentImageUrl", () => {
  it("accepts HTTPS images from the configured origin", () => {
    const url = "https://assets.example.com/images/photo.png?signature=abc";
    expect(trustedAttachmentImageUrl(url, trustedOrigin)).toBe(url);
  });

  it.each([
    "http://assets.example.com/images/photo.png",
    "https://other.example.com/images/photo.png",
    "https://assets.example.com.evil.test/images/photo.png",
    "http://127.0.0.1/internal.png",
    "file:///private/image.png",
    "data:image/png;base64,AAAA",
    "not a url",
  ])("rejects an untrusted image URL: %s", (url) => {
    expect(trustedAttachmentImageUrl(url, trustedOrigin)).toBeNull();
  });
});
