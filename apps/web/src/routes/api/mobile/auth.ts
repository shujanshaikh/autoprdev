import { createFileRoute } from "@tanstack/react-router";
import { WorkOS } from "@workos-inc/node";
import { z } from "zod";

import { requireWorkOSAuth } from "#/lib/github-oauth-server";

const redirectUriSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "autopr:" || (
      process.env.NODE_ENV !== "production" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  }, "Use an AutoPR app redirect URI.");

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    redirectUri: redirectUriSchema,
    screenHint: z.enum(["sign-in", "sign-up"]).optional(),
  }),
  z.object({
    action: z.literal("exchange"),
    code: z.string().min(1),
    codeVerifier: z.string().min(32),
  }),
  z.object({
    action: z.literal("refresh"),
    refreshToken: z.string().min(1),
  }),
  z.object({
    action: z.literal("logout"),
  }),
]);

function mobileWorkOS() {
  const clientId = process.env.WORKOS_CLIENT_ID;
  if (!clientId) throw new Error("WORKOS_CLIENT_ID is not configured.");
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) throw new Error("WORKOS_API_KEY is not configured.");
  return {
    clientId,
    workos: new WorkOS(apiKey),
  };
}

function sessionResponse(session: Awaited<ReturnType<WorkOS["userManagement"]["authenticateWithCode"]>>) {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    organizationId: session.organizationId,
    user: {
      id: session.user.id,
      email: session.user.email,
      firstName: session.user.firstName,
      lastName: session.user.lastName,
      profilePictureUrl: session.user.profilePictureUrl,
    },
  };
}

async function POST({ request }: { request: Request }) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid mobile authentication request." }, { status: 400 });
  }

  try {
    const { clientId, workos } = mobileWorkOS();
    if (parsed.data.action === "start") {
      const authorization = await workos.userManagement.getAuthorizationUrlWithPKCE({
        clientId,
        provider: "authkit",
        redirectUri: parsed.data.redirectUri,
        screenHint: parsed.data.screenHint,
      });
      return Response.json(authorization, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    if (parsed.data.action === "exchange") {
      const session = await workos.userManagement.authenticateWithCode({
        clientId,
        code: parsed.data.code,
        codeVerifier: parsed.data.codeVerifier,
      });
      return Response.json(sessionResponse(session), {
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    if (parsed.data.action === "logout") {
      const auth = await requireWorkOSAuth();
      if (auth.sessionId) {
        await workos.userManagement.revokeSession({ sessionId: auth.sessionId });
      }
      return Response.json({ success: true }, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    const session = await workos.userManagement.authenticateWithRefreshToken({
      clientId,
      refreshToken: parsed.data.refreshToken,
    });
    return Response.json(sessionResponse(session), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication failed.";
    return Response.json({ error: message }, { status: 401 });
  }
}

export const Route = createFileRoute("/api/mobile/auth")({
  server: {
    handlers: { POST },
  },
});
