import { api } from "@autopr/backend/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";

type StoredMessage = {
  messageId: string;
  role: "system" | "user" | "assistant";
  parts: unknown[];
  metadata?: unknown;
  createdAt?: number;
  updatedAt?: number;
  partsR2Key?: string;
  partsBlobSizeBytes?: number;
  partsBlobSha256?: string;
};

function blobKey(message: StoredMessage) {
  return JSON.stringify([
    message.partsR2Key,
    message.partsBlobSizeBytes ?? null,
    message.partsBlobSha256 ?? null,
  ]);
}

export function useThreadData(projectId: string, threadId: string) {
  const project = useQuery(api.projects.get, { projectId });
  const thread = useQuery(api.threads.get, { threadId });
  const stored = /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ useQuery(api.messages.listByThread, { threadId }) as StoredMessage[] | undefined;
  const hydrate = useAction(api.messages.hydrateAssistantParts);
  const [hydrated, setHydrated] = useState<Record<string, unknown[]>>({});
  const [hydrationError, setHydrationError] = useState<string | null>(null);

  const missing = useMemo(() => (stored ?? []).flatMap((message) => {
    if (message.role !== "assistant" || !message.partsR2Key || hydrated[blobKey(message)]) return [];
    return [{
      messageId: message.messageId,
      partsR2Key: message.partsR2Key,
      partsBlobSizeBytes: message.partsBlobSizeBytes,
      partsBlobSha256: message.partsBlobSha256,
    }];
  }), [hydrated, stored]);

  useEffect(() => {
    if (missing.length === 0) return;
    let active = true;
    void hydrate({ threadId, blobs: missing })
      .then((results) => {
        if (!active) return;
        setHydrated((current) => {
          const next = { ...current };
          for (const result of results) {
            next[JSON.stringify([
              result.partsR2Key,
              result.partsBlobSizeBytes ?? null,
              result.partsBlobSha256 ?? null,
            ])] = result.parts;
          }
          return next;
        });
        setHydrationError(null);
      })
      .catch((error) => {
        if (active) {
          setHydrationError(error instanceof Error ? error.message : "Messages could not be loaded.");
        }
      });
    return () => {
      active = false;
    };
  }, [hydrate, missing, threadId]);

  const messages = useMemo(() => (stored ?? []).map((message) => ({
    ...message,
    parts: message.partsR2Key ? hydrated[blobKey(message)] ?? message.parts : message.parts,
  })), [hydrated, stored]);

  return {
    project,
    thread,
    messages,
    hydrationError,
    loading: project === undefined || thread === undefined || stored === undefined,
  };
}
