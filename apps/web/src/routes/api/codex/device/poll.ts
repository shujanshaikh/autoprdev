import { createFileRoute } from "@tanstack/react-router";

async function POST() {
  return Response.json(
    { error: "Codex device authorization polling has moved to /api/chatgpt/status." },
    { status: 410 },
  );
}

export const Route = createFileRoute("/api/codex/device/poll")({
  server: {
    handlers: { POST },
  },
});
