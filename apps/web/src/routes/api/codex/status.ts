import { createFileRoute } from "@tanstack/react-router";

import { codexErrorResponse, getCodexConnectionStatus } from "#/lib/codex-auth-server";

async function GET({ request }: { request: Request }) {
  try {
    return Response.json(await getCodexConnectionStatus(request));
  } catch (error) {
    return codexErrorResponse(error, "Could not load Codex connection status.");
  }
}

export const Route = createFileRoute("/api/codex/status")({
  server: {
    handlers: { GET },
  },
});
