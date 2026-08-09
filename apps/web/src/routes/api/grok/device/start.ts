import { createFileRoute } from "@tanstack/react-router";

import { grokErrorResponse, startAuthenticatedGrokDeviceAuthorization } from "#/lib/grok-auth-server";

async function POST() {
  try {
    return Response.json(await startAuthenticatedGrokDeviceAuthorization());
  } catch (error) {
    return grokErrorResponse(error, "Could not start Grok authorization.");
  }
}

export const Route = createFileRoute("/api/grok/device/start")({
  server: { handlers: { POST } },
});
