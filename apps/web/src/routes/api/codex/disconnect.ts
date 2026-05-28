import { createFileRoute } from "@tanstack/react-router";

import { codexErrorResponse, disconnectCodex } from "#/lib/codex-auth-server";

async function POST() {
  try {
    return Response.json(await disconnectCodex());
  } catch (error) {
    return codexErrorResponse(error, "Could not disconnect Codex.");
  }
}

export const Route = createFileRoute("/api/codex/disconnect")({
  server: {
    handlers: { POST },
  },
});
