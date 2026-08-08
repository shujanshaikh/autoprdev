import { jwtVerify, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  getWorkOSAccessTokenVerificationOptions,
  resolveWorkOSRequestAccessToken,
  setWorkOSAccessTokenHeader,
  WORKOS_ACCESS_TOKEN_HEADER,
} from "./workos-access-token";

const clientId = "client_test";
const signingKey = new TextEncoder().encode("test-signing-key-with-enough-entropy");

async function accessToken(issuer: string) {
  return await new SignJWT({ client_id: clientId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(issuer)
    .setSubject("user_test")
    .setExpirationTime("5m")
    .sign(signingKey);
}

describe("WorkOS access token issuer verification", () => {
  it.each([
    "https://api.workos.com",
    "https://api.workos.com/",
    `https://api.workos.com/user_management/${clientId}`,
  ])("accepts the trusted issuer %s", async (issuer) => {
    await expect(
      jwtVerify(
        await accessToken(issuer),
        signingKey,
        getWorkOSAccessTokenVerificationOptions(clientId),
      ),
    ).resolves.toMatchObject({
      payload: {
        client_id: clientId,
        iss: issuer,
        sub: "user_test",
      },
    });
  });

  it("rejects an unrelated issuer", async () => {
    await expect(
      jwtVerify(
        await accessToken("https://example.com"),
        signingKey,
        getWorkOSAccessTokenVerificationOptions(clientId),
      ),
    ).rejects.toThrow();
  });
});

describe("WorkOS request token routing", () => {
  it("keeps the WorkOS token separate from another protocol's bearer token", () => {
    const headers = setWorkOSAccessTokenHeader(
      new Headers({ Authorization: "Bearer trigger-session-token" }),
      "workos-access-token",
    );

    expect(headers.get("Authorization")).toBe("Bearer trigger-session-token");
    expect(headers.get(WORKOS_ACCESS_TOKEN_HEADER)).toBe("workos-access-token");
    expect(
      resolveWorkOSRequestAccessToken({
        dedicatedHeader: headers.get(WORKOS_ACCESS_TOKEN_HEADER),
        authorization: headers.get("Authorization"),
      }),
    ).toBe("workos-access-token");
  });

  it("ignores a foreign Authorization token when the dedicated header is present", () => {
    expect(
      resolveWorkOSRequestAccessToken({
        dedicatedHeader: "",
        authorization: "Bearer trigger-session-token",
      }),
    ).toBeUndefined();
  });

  it("continues to support WorkOS bearer authentication for mobile routes", () => {
    expect(
      resolveWorkOSRequestAccessToken({
        dedicatedHeader: undefined,
        authorization: "Bearer mobile-workos-token",
      }),
    ).toBe("mobile-workos-token");
  });
});
