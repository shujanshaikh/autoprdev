import { Button } from "@autopr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@autopr/ui/components/dialog";
import { useQuery as useReactQuery } from "@tanstack/react-query";
import { cn } from "@autopr/ui/lib/utils";
import { Check, Copy, ExternalLink, Loader2, Unplug } from "lucide-react";
import { useEffect, useState } from "react";

import { CodexLogo } from "#/components/icons/codex-logo";
import { readJson } from "#/components/dashboard/types";
import type { CodexStatus } from "#/lib/codex-status";

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

function CodexConnectDialog({
  open,
  status,
  onOpenChange,
  onStatusChange,
}: CodexConnectDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 border-border bg-background p-0 sm:max-w-md">
        <CodexConnectPanel
          active={open}
          asDialogHeader
          status={status}
          onStatusChange={onStatusChange}
        />
      </DialogContent>
    </Dialog>
  );
}

export function CodexConnectPanel({
  active,
  asDialogHeader = false,
  status,
  onStatusChange,
}: {
  active: boolean;
  asDialogHeader?: boolean;
  status?: CodexStatus;
  onStatusChange: () => void;
}) {
  const [deviceStartNonce, setDeviceStartNonce] = useState(0);
  const [isPolling, setIsPolling] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [flowError, setFlowError] = useState<string>();

  const deviceStartQuery = useReactQuery({
    queryKey: ["codex", "device-start", deviceStartNonce],
    enabled: active && !status?.connected,
    retry: false,
    queryFn: async () => readJson<DeviceStartResponse>(
      await fetch("/api/codex/device/start", { method: "POST" }),
    ),
  });
  const device = deviceStartQuery.data;
  const isStarting = active && !status?.connected && deviceStartQuery.isPending;
  const error =
    flowError ??
    (deviceStartQuery.error instanceof Error
      ? deviceStartQuery.error.message
      : deviceStartQuery.isError
        ? "Could not start Codex authorization."
        : undefined);

  useEffect(() => {
    if (!active || !device || status?.connected) return;

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
          setFlowError(
            err instanceof Error ? err.message : "Could not complete Codex authorization.",
          );
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
  }, [active, device, onStatusChange, status?.connected]);

  async function copyCode() {
    if (!device) return;
    await navigator.clipboard.writeText(device.userCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  async function disconnect() {
    setIsDisconnecting(true);
    setFlowError(undefined);
    try {
      await readJson(await fetch("/api/codex/disconnect", { method: "POST" }));
      setDeviceStartNonce((current) => current + 1);
      onStatusChange();
    } catch (err) {
      setFlowError(err instanceof Error ? err.message : "Could not disconnect Codex.");
    } finally {
      setIsDisconnecting(false);
    }
  }

  const isLive = isStarting || isPolling;
  const statusLabel = status?.connected
    ? "connected"
    : isStarting
      ? "preparing"
      : isPolling
        ? "waiting for auth"
        : "idle";

  return (
    <>
      {/* Header */}
      <div className="border-b border-border px-5 pt-4 pb-4 pr-12">
        {asDialogHeader ? (
          <DialogHeader className="gap-2">
            <CodexPanelKicker />
            <DialogTitle className="text-base font-semibold tracking-tight text-foreground">
              Connect Codex
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
              Route OpenAI models through your ChatGPT subscription. Authorize this
              workspace once via device code.
            </DialogDescription>
          </DialogHeader>
        ) : (
          <div className="space-y-2">
            <CodexPanelKicker />
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              Connect Codex
            </h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Route OpenAI models through your ChatGPT subscription. Authorize this
              workspace once via device code.
            </p>
          </div>
        )}
      </div>

      {/* Body */}
      {status?.connected ? (
        <ConnectedBody
          status={status}
          isDisconnecting={isDisconnecting}
          onDisconnect={() => void disconnect()}
        />
      ) : (
        <ol className="divide-y divide-border">
          <Step
            n={1}
            done={Boolean(device)}
            title="Enable device code authorization"
            hint="Open your ChatGPT security settings and turn on device codes."
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!device}
                onClick={() =>
                  device &&
                  window.open(
                    device.securitySettingsUrl,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                Security settings
                <ExternalLink className="size-3" aria-hidden="true" />
              </Button>
            }
          />
          <Step
            n={2}
            done={copied}
            title="Copy this code"
            hint="Paste it on the verification page in step 3."
            action={
              <CodeBox
                userCode={device?.userCode}
                copied={copied}
                onCopy={() => void copyCode()}
                disabled={!device}
              />
            }
          />
          <Step
            n={3}
            done={false}
            title="Verify in your browser"
            hint="Paste the code on ChatGPT's verification page to authorize."
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!device}
                onClick={() =>
                  device &&
                  window.open(
                    device.verificationUrl,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                Verification page
                <ExternalLink className="size-3" aria-hidden="true" />
              </Button>
            }
          />
        </ol>
      )}

      {/* Status bar */}
      <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-5 py-2.5">
        <span
          aria-hidden
          className={cn(
            "inline-block size-1.5",
            status?.connected
              ? "bg-primary"
              : isLive
                ? "animate-pulse bg-primary"
                : "bg-muted-foreground/40",
          )}
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {statusLabel}
        </span>
        {isLive ? (
          <Loader2
            className="ml-auto size-3 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="border-t border-destructive/40 bg-destructive/[0.04] px-5 py-2.5 font-mono text-xs"
        >
          <span className="mr-2 uppercase tracking-[0.2em] text-destructive">err</span>
          <span className="text-destructive/90">{error}</span>
        </div>
      ) : null}
    </>
  );
}

function CodexPanelKicker() {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className="inline-block size-1.5 bg-primary" />
      <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
        autopr / codex
      </span>
      <CodexLogo
        aria-hidden
        className="ml-auto size-3.5 text-muted-foreground/70"
      />
    </div>
  );
}

function Step({
  n,
  done,
  title,
  hint,
  action,
}: {
  n: number;
  done: boolean;
  title: string;
  hint: string;
  action: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 px-5 py-4">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 inline-flex size-5 items-center justify-center border font-mono text-[10px] leading-none transition-colors",
          done
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-background text-muted-foreground",
        )}
      >
        {done ? <Check className="size-3" strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 space-y-2">
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
        </div>
        {action}
      </div>
    </li>
  );
}

function CodeBox({
  userCode,
  copied,
  disabled,
  onCopy,
}: {
  userCode?: string;
  copied: boolean;
  disabled: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-stretch gap-2">
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center justify-center border border-border bg-muted/40 px-3 py-2 font-mono text-base font-semibold tracking-[0.22em]",
          userCode ? "text-foreground" : "text-muted-foreground/50",
        )}
        aria-live="polite"
      >
        {userCode ?? "─────────"}
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        disabled={disabled}
        onClick={onCopy}
        aria-label={copied ? "Copied" : "Copy code"}
        className="self-stretch"
      >
        {copied ? (
          <Check className="size-3.5 text-primary" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}

function ConnectedBody({
  status,
  isDisconnecting,
  onDisconnect,
}: {
  status: { email?: string; accountId?: string };
  isDisconnecting: boolean;
  onDisconnect: () => void;
}) {
  const identity =
    status.email ??
    status.accountId ??
    "ChatGPT subscription stored in WorkOS Vault.";

  return (
    <div className="space-y-3 px-5 py-5">
      <div className="border border-border bg-muted/30 px-3 py-3">
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden
            className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center border border-primary bg-primary text-primary-foreground"
          >
            <Check className="size-3" strokeWidth={3} />
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-sm font-medium text-foreground">Codex is connected</p>
            <p className="break-words font-mono text-[11px] text-muted-foreground">
              {identity}
            </p>
          </div>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isDisconnecting}
        onClick={onDisconnect}
        className="w-full"
      >
        {isDisconnecting ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Unplug className="size-3.5" aria-hidden="true" />
        )}
        Disconnect
      </Button>
    </div>
  );
}
