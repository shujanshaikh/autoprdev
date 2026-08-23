import { hasNumberType, hasObjectType, hasStringType } from "@autopr/config/runtime-type";

import { Button, buttonVariants } from "@autopr/ui/components/button";
import { cn } from "@autopr/ui/lib/utils";
import { Check, Copy, ExternalLink, Loader2, Unplug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { GrokLogo } from "#/components/icons/grok-logo";
import type { GrokStatus } from "#/lib/grok-status";

type DeviceFlow = {
  flowId: string;
  userCode: string;
  verificationUrl: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
};

const GROK_DEVICE_FLOW_STORAGE_KEY = "autopr:grok-device-flow";

class GrokRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GrokRequestError";
  }
}

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
  const [optimisticConnected, setOptimisticConnected] = useState(false);
  const connected = status?.connected === true || optimisticConnected;

  const clearFlow = useCallback(() => {
    clearStoredDeviceFlow();
    setFlow(undefined);
  }, []);

  useEffect(() => {
    if (!active || connected || flow) return;
    const stored = readStoredDeviceFlow();
    if (!stored) return;
    if (stored.expiresAt <= Date.now()) {
      clearStoredDeviceFlow();
      return;
    }
    setFlow(stored);
  }, [active, connected, flow]);

  const poll = useCallback(async (current: DeviceFlow) => {
    const response = await fetch("/api/grok/device/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flowId: current.flowId }),
    });
    const result = await readJson<{ status: "pending" | "connected" | "denied" | "expired"; intervalMs?: number }>(response);
    if (result.status === "connected") {
      clearFlow();
      setOptimisticConnected(true);
      onStatusChange();
      return;
    }
    if (result.status === "denied" || result.status === "expired") {
      clearFlow();
      setError(result.status === "denied" ? "Grok authorization was denied." : "The Grok connection code expired.");
      return;
    }
    setFlow((latest) => latest?.flowId === current.flowId
      ? { ...latest, intervalMs: result.intervalMs ?? latest.intervalMs }
      : latest);
  }, [clearFlow, onStatusChange]);

  useEffect(() => {
    if (!active || connected || !flow) return;
    const remaining = flow.expiresAt - Date.now();
    if (remaining <= 0) {
      clearFlow();
      setError("The Grok connection code expired.");
      return;
    }
    const timer = window.setTimeout(() => {
      void poll(flow).catch((pollError) => {
        if (pollError instanceof GrokRequestError && pollError.status === 404) {
          clearFlow();
          onStatusChange();
          return;
        }
        setError(pollError instanceof Error ? pollError.message : "Could not check Grok authorization.");
        setFlow((latest) => latest?.flowId === flow.flowId ? { ...latest } : latest);
      });
    }, Math.min(flow.intervalMs, remaining));
    return () => window.clearTimeout(timer);
  }, [active, clearFlow, connected, flow, onStatusChange, poll]);

  async function startConnection() {
    setBusy(true);
    setError(undefined);
    setCopied(false);
    setOptimisticConnected(false);
    try {
      const next = await readJson<DeviceFlow>(await fetch("/api/grok/device/start", { method: "POST" }));
      storeDeviceFlow(next);
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
      clearFlow();
      setOptimisticConnected(false);
      onStatusChange();
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Could not disconnect Grok.");
    } finally {
      setBusy(false);
    }
  }

  const identity = status?.email ?? status?.name ?? status?.subject;

  return (
    <div className="p-5 min-[420px]:p-6">
      <div className="space-y-1.5">
        <h2 className="flex items-center gap-2 text-lg font-medium tracking-tight text-foreground">
          <GrokLogo className="size-5" />
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
            {status?.models?.length ? (
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
            {busy ? <Loader2 className="size-4 animate-spin" /> : <GrokLogo className="size-4" />}
            Connect Grok
          </Button>
        )}
      </div>

      {error ? <p role="alert" className="mt-3 text-xs leading-relaxed text-destructive">{error}</p> : null}
    </div>
  );
}

async function readJson<T = unknown>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new GrokRequestError(
      data && hasObjectType(data) && "error" in data ? String(data.error) : "Request failed.",
      response.status,
    );
  }
  return data satisfies T;
}

function storeDeviceFlow(flow: DeviceFlow) {
  try {
    window.localStorage.setItem(GROK_DEVICE_FLOW_STORAGE_KEY, JSON.stringify(flow));
  } catch {
    // Polling still works in memory when storage is unavailable.
  }
}

function clearStoredDeviceFlow() {
  try {
    window.localStorage.removeItem(GROK_DEVICE_FLOW_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in hardened browser contexts.
  }
}

function readStoredDeviceFlow(): DeviceFlow | undefined {
  try {
    const value = window.localStorage.getItem(GROK_DEVICE_FLOW_STORAGE_KEY);
    if (!value) return undefined;
    const parsed = JSON.parse(value) satisfies Partial<DeviceFlow>;
    if (
      !hasStringType(parsed.flowId)
      || !hasStringType(parsed.userCode)
      || !hasStringType(parsed.verificationUrl)
      || !hasStringType(parsed.verificationUri)
      || !hasNumberType(parsed.expiresAt)
      || !hasNumberType(parsed.intervalMs)
    ) {
      clearStoredDeviceFlow();
      return undefined;
    }
    return /* SAFETY: Every DeviceFlow field is validated immediately above. */ parsed as DeviceFlow;
  } catch {
    clearStoredDeviceFlow();
    return undefined;
  }
}
