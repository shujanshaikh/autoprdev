import { useQuery } from "@tanstack/react-query";

export type CodexStatus = {
  connected: boolean;
  email?: string;
  accountId?: string;
};

export const codexStatusQueryKey = ["codex", "status"] as const;

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error =
      data && typeof data === "object" && "error" in data
        ? String(data.error)
        : "Request failed.";
    throw new Error(error);
  }
  return data as T;
}

export async function fetchCodexStatus(): Promise<CodexStatus> {
  return readJson<CodexStatus>(await fetch("/api/codex/status"));
}

export function useCodexStatus(enabled: boolean) {
  return useQuery({
    queryKey: codexStatusQueryKey,
    enabled,
    retry: false,
    queryFn: fetchCodexStatus,
  });
}
