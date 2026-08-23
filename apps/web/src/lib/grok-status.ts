import { hasObjectType } from "@autopr/config/runtime-type";

import { useQuery } from "@tanstack/react-query";

export type GrokStatus = {
  connected: boolean;
  email?: string;
  name?: string;
  subject?: string;
  models?: string[];
  expiresAt?: number;
};

const grokStatusQueryKey = ["grok", "status"] as const;

async function fetchGrokStatus(): Promise<GrokStatus> {
  const response = await fetch("/api/grok/status");
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data && hasObjectType(data) && "error" in data ? String(data.error) : "Request failed.");
  }
  return await response.json() satisfies GrokStatus;
}

export function useGrokStatus(enabled: boolean) {
  return useQuery({
    queryKey: grokStatusQueryKey,
    enabled,
    retry: false,
    queryFn: fetchGrokStatus,
  });
}
