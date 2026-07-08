import { createFileRoute } from "@tanstack/react-router";

async function POST() {
  return Response.json(
    { error: "Codex device authorization has moved to /api/chatgpt/login." },
    { status: 410 },
  );
}

export const Route = createFileRoute("/api/codex/device/start")({
  server: {
    handlers: { POST },
  },
});
