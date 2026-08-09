import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { grokErrorResponse, pollAuthenticatedGrokDeviceAuthorization } from "#/lib/grok-auth-server";

const requestSchema = z.object({ flowId: z.string().min(1) });

async function POST({ request }: { request: Request }) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Missing Grok authorization flow." }, { status: 400 });
  try {
    return Response.json(await pollAuthenticatedGrokDeviceAuthorization(parsed.data.flowId));
  } catch (error) {
    return grokErrorResponse(error, "Could not check Grok authorization.");
  }
}

export const Route = createFileRoute("/api/grok/device/poll")({
  server: { handlers: { POST } },
});
