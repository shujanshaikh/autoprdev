import { createFileRoute } from "@tanstack/react-router";

import { handleChatGPTAuthRequest } from "#/lib/codex-auth-server";

export const Route = createFileRoute("/api/chatgpt/$lwc")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) => handleChatGPTAuthRequest(request),
      POST: ({ request }: { request: Request }) => handleChatGPTAuthRequest(request),
    },
  },
});
