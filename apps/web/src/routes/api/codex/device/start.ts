import { createFileRoute } from "@tanstack/react-router";

import { codexErrorResponse, startCodexDeviceAuthorization } from "#/lib/codex-auth-server";

async function POST() {
  try {
    return Response.json(await startCodexDeviceAuthorization());
  } catch (error) {
    return codexErrorResponse(error, "Could not start Codex authorization.");
  }
}

export const Route = createFileRoute("/api/codex/device/start")({
  server: {
    handlers: { POST },
  },
});
