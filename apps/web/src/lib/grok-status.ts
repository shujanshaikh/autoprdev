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
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data && typeof data === "object" && "error" in data ? String(data.error) : "Request failed.");
  }
  return data as GrokStatus;
}

export function useGrokStatus(enabled: boolean) {
  return useQuery({
    queryKey: grokStatusQueryKey,
    enabled,
    retry: false,
    queryFn: fetchGrokStatus,
  });
}
