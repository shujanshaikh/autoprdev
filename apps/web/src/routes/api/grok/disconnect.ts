import { createFileRoute } from "@tanstack/react-router";

import { disconnectAuthenticatedGrok, grokErrorResponse } from "#/lib/grok-auth-server";

async function POST() {
  try {
    await disconnectAuthenticatedGrok();
    return Response.json({ disconnected: true });
  } catch (error) {
    return grokErrorResponse(error, "Could not disconnect Grok.");
  }
}

export const Route = createFileRoute("/api/grok/disconnect")({
  server: { handlers: { POST } },
});
