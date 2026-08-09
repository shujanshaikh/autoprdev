import { createFileRoute } from "@tanstack/react-router";

import { getAuthenticatedGrokConnectionStatus, grokErrorResponse } from "#/lib/grok-auth-server";

async function GET() {
  try {
    return Response.json(await getAuthenticatedGrokConnectionStatus());
  } catch (error) {
    return grokErrorResponse(error, "Could not load Grok connection status.");
  }
}

export const Route = createFileRoute("/api/grok/status")({
  server: { handlers: { GET } },
});
