import { Button } from "@autopr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@autopr/ui/components/dialog";
import { Check, Copy, ExternalLink, Loader2, Unplug } from "lucide-react";
import { useEffect, useState } from "react";

import { readJson } from "#/components/dashboard/types";

type CodexStatus = {
  connected: boolean;
  email?: string;
  accountId?: string;
};

type DeviceStartResponse = {
  userCode: string;
  deviceAuthId: string;
  intervalMs: number;
  verificationUrl: string;
  securitySettingsUrl: string;
};

interface CodexConnectDialogProps {
  open: boolean;
  status?: CodexStatus;
  onOpenChange: (open: boolean) => void;
  onStatusChange: () => void;
}

export function CodexConnectDialog({
  open,
  status,
  onOpenChange,
  onStatusChange,
}: CodexConnectDialogProps) {
  const [device, setDevice] = useState<DeviceStartResponse>();
  const [isStarting, setIsStarting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open || status?.connected) return;
    if (device || isStarting) return;

    setIsStarting(true);
    setError(undefined);
    fetch("/api/codex/device/start", { method: "POST" })
      .then((response) => readJson<DeviceStartResponse>(response))
      .then(setDevice)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not start Codex authorization."))
      .finally(() => setIsStarting(false));
  }, [device, isStarting, open, status?.connected]);

  useEffect(() => {
    if (!open || !device || status?.connected) return;

    const activeDevice = device;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      setIsPolling(true);
      try {
        const result = await readJson<{ connected: boolean; pending?: boolean }>(
          await fetch("/api/codex/device/poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              deviceAuthId: activeDevice.deviceAuthId,
              userCode: activeDevice.userCode,
            }),
          }),
        );

        if (cancelled) return;

        if (result.connected) {
          onStatusChange();
          return;
        }

        timeout = setTimeout(poll, activeDevice.intervalMs);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not complete Codex authorization.");
        }
      } finally {
        if (!cancelled) setIsPolling(false);
      }
    }

    timeout = setTimeout(poll, activeDevice.intervalMs);

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [device, onStatusChange, open, status?.connected]);

  async function copyCode() {
    if (!device) return;
    await navigator.clipboard.writeText(device.userCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  async function disconnect() {
    setIsDisconnecting(true);
    setError(undefined);
    try {
      await readJson(await fetch("/api/codex/disconnect", { method: "POST" }));
      setDevice(undefined);
      onStatusChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect Codex.");
    } finally {
      setIsDisconnecting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] max-w-[min(46rem,calc(100vw-2rem))] gap-6 overflow-y-auto border border-white/10 bg-[#202020] p-5 text-white shadow-2xl ring-0 sm:p-8">
        <DialogHeader className="gap-2 pr-8">
          <DialogTitle className="text-2xl font-semibold tracking-normal sm:text-3xl">
            Connect Codex
          </DialogTitle>
          <DialogDescription className="text-sm text-white/55 sm:text-base">
            Route OpenAI models through your ChatGPT subscription
          </DialogDescription>
        </DialogHeader>

        {status?.connected ? (
          <div className="space-y-5">
            <div className="flex items-start gap-3 border-l border-emerald-400/45 pl-4">
              <Check className="mt-0.5 size-5 text-emerald-400" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Codex is connected</p>
                <p className="break-words text-xs text-white/50">
                  {status.email ?? status.accountId ?? "ChatGPT subscription access is stored in WorkOS Vault."}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={isDisconnecting}
              onClick={disconnect}
              className="border-white/15 bg-transparent text-white hover:bg-white/10"
            >
              {isDisconnecting ? <Loader2 className="animate-spin" /> : <Unplug />}
              Disconnect
            </Button>
          </div>
        ) : (
          <ol className="space-y-6 text-base leading-relaxed text-white sm:text-[1.35rem]">
            <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 sm:grid-cols-[2rem_minmax(0,1fr)] sm:gap-4">
              <span className="font-mono text-white/35">1.</span>
              <div className="min-w-0 space-y-3">
                <p>Enable device code authorization in your security settings:</p>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 border-white/15 bg-transparent px-4 text-sm text-white hover:bg-white/10 sm:h-14 sm:px-5 sm:text-xl"
                  onClick={() => device && window.open(device.securitySettingsUrl, "_blank", "noopener,noreferrer")}
                  disabled={!device}
                >
                  Security settings <ExternalLink className="size-5" />
                </Button>
              </div>
            </li>

            <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 sm:grid-cols-[2rem_minmax(0,1fr)] sm:gap-4">
              <span className="font-mono text-white/35">2.</span>
              <div className="min-w-0 space-y-3">
                <p>Copy this code:</p>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="min-w-0 border border-white/10 bg-white/[0.06] px-4 py-4 font-mono text-2xl font-bold tracking-[0.12em] sm:px-8 sm:py-6 sm:text-4xl">
                    {device?.userCode ?? "--------"}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={!device}
                    onClick={copyCode}
                    aria-label={copied ? "Copied" : "Copy code"}
                    className="text-white/60 hover:bg-white/10 hover:text-white"
                  >
                    {copied ? <Check /> : <Copy />}
                  </Button>
                </div>
              </div>
            </li>

            <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 sm:grid-cols-[2rem_minmax(0,1fr)] sm:gap-4">
              <span className="font-mono text-white/35">3.</span>
              <div className="min-w-0 space-y-3">
                <p>Open the verification page and paste the code:</p>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 border-white/15 bg-transparent px-4 text-sm text-white hover:bg-white/10 sm:h-14 sm:px-5 sm:text-xl"
                  onClick={() => device && window.open(device.verificationUrl, "_blank", "noopener,noreferrer")}
                  disabled={!device}
                >
                  Verification page <ExternalLink className="size-5" />
                </Button>
              </div>
            </li>
          </ol>
        )}

        {!status?.connected && (
          <div className="flex items-center gap-3 text-sm text-white/50 sm:text-lg">
            {isStarting || isPolling ? <Loader2 className="size-5 animate-spin" /> : null}
            <span>{isStarting ? "Preparing authorization..." : "Waiting for authentication..."}</span>
          </div>
        )}

        {error ? <p className="text-sm text-red-300">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
