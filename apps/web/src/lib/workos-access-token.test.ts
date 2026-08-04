import { jwtVerify, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { getWorkOSAccessTokenVerificationOptions } from "./workos-access-token";

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
