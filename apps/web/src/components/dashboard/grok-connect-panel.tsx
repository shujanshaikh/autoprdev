import { Button, buttonVariants } from "@autopr/ui/components/button";
import { cn } from "@autopr/ui/lib/utils";
import { Check, Copy, ExternalLink, Loader2, Unplug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { GrokStatus } from "#/lib/grok-status";

type DeviceFlow = {
  flowId: string;
  userCode: string;
  verificationUrl: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
};

export function GrokConnectPanel({
  active,
  status,
  onStatusChange,
}: {
  active: boolean;
  status?: GrokStatus;
  onStatusChange: () => void;
}) {
  const [flow, setFlow] = useState<DeviceFlow>();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const poll = useCallback(async (current: DeviceFlow) => {
    const response = await fetch("/api/grok/device/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flowId: current.flowId }),
    });
    const result = await readJson<{ status: "pending" | "connected" | "denied" | "expired"; intervalMs?: number }>(response);
    if (result.status === "connected") {
      setFlow(undefined);
      onStatusChange();
      return;
    }
    if (result.status === "denied" || result.status === "expired") {
      setFlow(undefined);
      setError(result.status === "denied" ? "Grok authorization was denied." : "The Grok connection code expired.");
      return;
    }
    setFlow((latest) => latest?.flowId === current.flowId
      ? { ...latest, intervalMs: result.intervalMs ?? latest.intervalMs }
      : latest);
  }, [onStatusChange]);

  useEffect(() => {
    if (!active || !flow) return;
    const remaining = flow.expiresAt - Date.now();
    if (remaining <= 0) {
      setFlow(undefined);
      setError("The Grok connection code expired.");
      return;
    }
    const timer = window.setTimeout(() => {
      void poll(flow).catch((pollError) => {
        setError(pollError instanceof Error ? pollError.message : "Could not check Grok authorization.");
        setFlow((latest) => latest?.flowId === flow.flowId ? { ...latest } : latest);
      });
    }, Math.min(flow.intervalMs, remaining));
    return () => window.clearTimeout(timer);
  }, [active, flow, poll]);

  async function startConnection() {
    setBusy(true);
    setError(undefined);
    setCopied(false);
    try {
      const next = await readJson<DeviceFlow>(await fetch("/api/grok/device/start", { method: "POST" }));
      setFlow(next);
      window.open(next.verificationUrl, "connect-supergrok", "noopener,noreferrer");
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start Grok authorization.");
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!flow?.userCode) return;
    await navigator.clipboard.writeText(flow.userCode);
    setCopied(true);
  }

  async function disconnect() {
    setBusy(true);
    setError(undefined);
    try {
      await readJson(await fetch("/api/grok/disconnect", { method: "POST" }));
      setFlow(undefined);
      onStatusChange();
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Could not disconnect Grok.");
    } finally {
      setBusy(false);
    }
  }

  const connected = status?.connected === true;
  const identity = status?.email ?? status?.name ?? status?.subject;

  return (
    <div className="p-5 min-[420px]:p-6">
      <div className="space-y-1.5">
        <h2 className="flex items-center gap-2 text-lg font-medium tracking-tight text-foreground">
          <GrokMark className="size-5" />
          {connected ? "SuperGrok connected" : flow ? "Finish in Grok" : "Connect SuperGrok"}
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {connected
            ? "AutoPR can use the Grok models available through your xAI subscription."
            : flow
              ? "Authorize the public Grok CLI device code in your browser."
              : "Use your SuperGrok subscription without creating an API key."}
        </p>
      </div>

      <div className="mt-5 space-y-4">
        {connected ? (
          <>
            {identity ? <p className="truncate text-sm text-foreground">{identity}</p> : null}
            {status.models?.length ? (
              <p className="text-xs text-muted-foreground">{status.models.length} Grok models available</p>
            ) : null}
            <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => void disconnect()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Unplug className="size-3.5" />}
              Disconnect
            </Button>
          </>
        ) : flow ? (
          <>
            <div className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2.5">
              <code className="truncate font-mono text-base font-medium tracking-[0.14em]">{flow.userCode}</code>
              <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => void copyCode()} aria-label={copied ? "Code copied" : "Copy code"}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </Button>
            </div>
            <a href={flow.verificationUrl} target="connect-supergrok" rel="noreferrer" className={cn(buttonVariants(), "w-full")}>
              <ExternalLink className="size-4" />
              Open Grok
            </a>
            <p className="text-center text-xs text-muted-foreground">Waiting for authorization…</p>
          </>
        ) : (
          <Button type="button" className="w-full" disabled={busy} onClick={() => void startConnection()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <GrokMark className="size-4" />}
            Connect Grok
          </Button>
        )}
      </div>

      {error ? <p role="alert" className="mt-3 text-xs leading-relaxed text-destructive">{error}</p> : null}
    </div>
  );
}

export function GrokMark({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex items-center justify-center rounded-sm bg-foreground font-mono text-[0.6em] font-black text-background", className)}>
      G
    </span>
  );
}

async function readJson<T = unknown>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data && typeof data === "object" && "error" in data ? String(data.error) : "Request failed.");
  }
  return data as T;
}
