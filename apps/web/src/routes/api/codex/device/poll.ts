import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { codexErrorResponse, completeCodexDeviceAuthorization } from "#/lib/codex-auth-server";

const bodySchema = z.object({
  deviceAuthId: z.string().min(1),
  userCode: z.string().min(1),
});

async function POST({ request }: { request: Request }) {
  try {
    const body = bodySchema.parse(await request.json());
    return Response.json(await completeCodexDeviceAuthorization(body.deviceAuthId, body.userCode));
  } catch (error) {
    return codexErrorResponse(error, "Could not complete Codex authorization.");
  }
}

export const Route = createFileRoute("/api/codex/device/poll")({
  server: {
    handlers: { POST },
  },
});
