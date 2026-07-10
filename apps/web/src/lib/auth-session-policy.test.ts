import { describe, expect, it } from "vitest";

import { AUTHKIT_CLIENT_SESSION_POLICY } from "./auth-session-policy";

describe("AuthKit client session policy", () => {
  it("never recovers a session check by reloading the document", () => {
    expect(AUTHKIT_CLIENT_SESSION_POLICY).toEqual({ onSessionExpired: false });
  });
});
