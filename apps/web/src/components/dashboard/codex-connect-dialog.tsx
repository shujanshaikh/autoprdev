import { Button } from "@autopr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@autopr/ui/components/dialog";
import { cn } from "@autopr/ui/lib/utils";
import {
  openLoginWithChatGPTConsentPopup,
  useLoginWithChatGPT,
  type ChatGPTUser,
} from "@autopr/chatgpt/react";
import { Check, Copy, ExternalLink, Loader2, Unplug } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { CodexLogo } from "#/components/icons/codex-logo";
import type { CodexStatus } from "#/lib/codex-status";

const APP_NAME = "AutoPR";
const CHATGPT_SECURITY_SETTINGS_URL = "https://chatgpt.com/#settings/Security";

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
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [flowError, setFlowError] = useState<string>();
  const [showInlineConsent, setShowInlineConsent] = useState(false);
  const lastReportedStatusRef = useRef<string | undefined>(undefined);
  const auth = useLoginWithChatGPT({
    basePath: "/api/chatgpt",
    onAuthenticated: () => {
      setShowInlineConsent(false);
      onStatusChange();
    },
    onError: (error) => setFlowError(error.message),
  });

  useEffect(() => {
    if (!active) return;
    if (lastReportedStatusRef.current === auth.status) return;
    lastReportedStatusRef.current = auth.status;

    if (auth.status === "authenticated" || auth.status === "unauthenticated" || auth.status === "expired") {
      onStatusChange();
    }
  }, [active, auth.status, onStatusChange]);

  function startLogin() {
    setFlowError(undefined);
    setShowInlineConsent(false);

    const popup = openLoginWithChatGPTConsentPopup({
      appName: APP_NAME,
      continueLabel: `I trust ${APP_NAME}, continue`,
      securityHref: CHATGPT_SECURITY_SETTINGS_URL,
      login: auth.login,
    });

    if (!popup) {
      setShowInlineConsent(true);
    }
  }

  async function disconnect() {
    setIsDisconnecting(true);
    setFlowError(undefined);
    try {
      await auth.logout();
      onStatusChange();
    } catch (err) {
      setFlowError(err instanceof Error ? err.message : "Could not disconnect Codex.");
    } finally {
      setIsDisconnecting(false);
    }
  }

  const connectedUser = auth.isAuthenticated
    ? auth.user
    : auth.status === "loading" && status?.connected
      ? status
      : undefined;
  const connected = Boolean(connectedUser);
  const isLive = auth.isConnecting || auth.isPending;
  const error = flowError ?? auth.error;
  const statusLabel = connected
    ? "connected"
    : auth.status === "loading"
      ? "checking"
      : auth.isConnecting
        ? "preparing"
        : auth.isPending
          ? "waiting for auth"
          : "idle";

  return (
    <>
      <div className="border-b border-border px-4 pt-4 pb-4 pr-12 min-[420px]:px-5">
        {asDialogHeader ? (
          <DialogHeader className="gap-2">
            <CodexPanelKicker />
            <DialogTitle className="text-base font-medium text-foreground">
              Connect Codex
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
              Route OpenAI models through your ChatGPT subscription. Authorize this
              workspace once with Login with ChatGPT.
            </DialogDescription>
          </DialogHeader>
        ) : (
          <div className="space-y-2">
            <CodexPanelKicker />
            <h2 className="text-base font-medium text-foreground">
              Connect Codex
            </h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Route OpenAI models through your ChatGPT subscription. Authorize this
              workspace once with Login with ChatGPT.
            </p>
          </div>
        )}
      </div>

      {connected ? (
        <ConnectedBody
          user={connectedUser}
          isDisconnecting={isDisconnecting}
          onDisconnect={() => void disconnect()}
        />
      ) : (
        <ol className="divide-y divide-border">
          <Step
            n={1}
            done={auth.isPending || Boolean(auth.userCode)}
            title="Review access"
            hint="Confirm AutoPR can send Codex requests through your ChatGPT plan."
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={auth.isConnecting || auth.isPending}
                className="w-full min-[420px]:w-auto"
                onClick={startLogin}
              >
                {auth.isConnecting ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : null}
                Review access
              </Button>
            }
          />
          {showInlineConsent ? (
            <li className="px-4 py-4 min-[420px]:px-5">
              <InlineConsent
                isConnecting={auth.isConnecting}
                onContinue={() => {
                  setShowInlineConsent(false);
                  void auth.login();
                }}
                onCancel={() => setShowInlineConsent(false)}
              />
            </li>
          ) : null}
          <Step
            n={2}
            done={auth.copied}
            title="Copy this code"
            hint="Paste it on the verification page in step 3."
            action={
              <CodeBox
                userCode={auth.userCode}
                copied={auth.copied}
                onCopy={() => void auth.copyCode()}
                disabled={!auth.userCode}
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
                disabled={!auth.verificationUrl}
                className="w-full min-[420px]:w-auto"
                onClick={auth.reopen}
              >
                Verification page
                <ExternalLink className="size-3" aria-hidden="true" />
              </Button>
            }
          />
        </ol>
      )}

      <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-4 py-2.5 min-[420px]:px-5">
        <span
          aria-hidden
          className={cn(
            "inline-block size-1.5",
            connected
              ? "bg-primary"
              : isLive
                ? "animate-pulse bg-primary"
                : "bg-muted-foreground/40",
          )}
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground min-[420px]:tracking-[0.22em]">
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
          className="border-t border-destructive/40 bg-destructive/[0.04] px-4 py-2.5 font-mono text-xs min-[420px]:px-5"
        >
          <span className="mr-2 uppercase tracking-[0.14em] text-destructive min-[420px]:tracking-[0.2em]">err</span>
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
      <span className="min-w-0 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground min-[420px]:tracking-[0.24em]">
        autopr / codex
      </span>
      <CodexLogo
        aria-hidden
        className="ml-auto size-3.5 text-muted-foreground/70"
      />
    </div>
  );
}

function InlineConsent({
  isConnecting,
  onContinue,
  onCancel,
}: {
  isConnecting: boolean;
  onContinue: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3 border border-border bg-muted/30 px-3 py-3">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          Authorize {APP_NAME} to use ChatGPT
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Continue only if you trust {APP_NAME} and its developer.
        </p>
      </div>
      <ul className="space-y-2 text-xs leading-relaxed text-muted-foreground">
        <li>AI requests are billed to your own ChatGPT plan until you disconnect.</li>
        <li>Your prompts and files pass through {APP_NAME}'s server before reaching OpenAI.</li>
        <li>{APP_NAME} never sees your ChatGPT password and cannot sign in as you.</li>
      </ul>
      <div className="flex flex-col gap-2 min-[420px]:flex-row">
        <Button
          type="button"
          size="sm"
          disabled={isConnecting}
          className="min-[420px]:flex-1"
          onClick={onContinue}
        >
          {isConnecting ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : null}
          I trust {APP_NAME}, continue
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isConnecting}
          className="min-[420px]:flex-1"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
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
  action: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2.5 px-4 py-4 min-[420px]:grid-cols-[1.75rem_minmax(0,1fr)] min-[420px]:gap-3 min-[420px]:px-5">
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
    <div className="flex min-w-0 items-stretch gap-2">
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center justify-center overflow-hidden border border-border bg-muted/40 px-2 py-2 font-mono text-sm font-semibold tracking-[0.12em] min-[420px]:px-3 min-[420px]:text-base min-[420px]:tracking-[0.22em]",
          userCode ? "text-foreground" : "text-muted-foreground/50",
        )}
        aria-live="polite"
      >
        {userCode ?? "---------"}
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
  user,
  isDisconnecting,
  onDisconnect,
}: {
  user?: ChatGPTUser | Pick<CodexStatus, "email" | "accountId" | "name" | "plan">;
  isDisconnecting: boolean;
  onDisconnect: () => void;
}) {
  const identity =
    user?.email ??
    user?.name ??
    user?.accountId ??
    "ChatGPT session stored by Login with ChatGPT.";
  const plan = user?.plan ? `${user.plan} plan` : undefined;

  return (
    <div className="space-y-3 px-4 py-5 min-[420px]:px-5">
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
            {plan ? (
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {plan}
              </p>
            ) : null}
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
