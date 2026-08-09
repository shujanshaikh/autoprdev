import { Button, buttonVariants } from "@autopr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@autopr/ui/components/dialog";
import { cn } from "@autopr/ui/lib/utils";
import {
  ChatGPTMark,
  useLoginWithChatGPT,
  type ChatGPTUser,
} from "@autopr/chatgpt/react";
import { Check, Copy, Loader2, Unplug } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { CodexStatus } from "#/lib/codex-status";

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
      <DialogContent className="gap-0 border-border bg-background p-0 sm:max-w-sm">
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
  const loginStartedRef = useRef(false);
  const lastReportedStatusRef = useRef<string | undefined>(undefined);
  const auth = useLoginWithChatGPT({
    basePath: "/api/chatgpt",
    openPopup: false,
    autoCopyCode: false,
    onAuthenticated: onStatusChange,
    onError: (error) => setFlowError(error.message),
  });

  useEffect(() => {
    if (!active || auth.status !== "unauthenticated" || loginStartedRef.current) return;
    loginStartedRef.current = true;
    void auth.login();
  }, [active, auth.login, auth.status]);

  useEffect(() => {
    if (!active || lastReportedStatusRef.current === auth.status) return;
    lastReportedStatusRef.current = auth.status;

    if (
      auth.status === "authenticated" ||
      auth.status === "unauthenticated" ||
      auth.status === "expired"
    ) {
      onStatusChange();
    }
  }, [active, auth.status, onStatusChange]);

  function retryLogin() {
    setFlowError(undefined);
    void auth.login();
  }

  async function disconnect() {
    setIsDisconnecting(true);
    setFlowError(undefined);
    try {
      await auth.logout();
      loginStartedRef.current = false;
      onStatusChange();
    } catch (error) {
      setFlowError(error instanceof Error ? error.message : "Could not disconnect ChatGPT.");
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
  const error = flowError ?? auth.error;
  const title = connected
    ? "ChatGPT connected"
    : auth.isPending
      ? "Finish in ChatGPT"
      : "Connect ChatGPT";
  const description = connected
    ? "autopr can use Codex through your ChatGPT plan."
    : auth.isPending
      ? "Open ChatGPT and paste the one-time code."
      : "Preparing a one-time code for your ChatGPT account.";

  return (
    <div className="p-5 pr-12 min-[420px]:p-6 min-[420px]:pr-12">
      {asDialogHeader ? (
        <DialogHeader className="gap-1.5 text-left">
          <DialogTitle className="text-lg font-medium tracking-tight text-foreground">
            <ConnectTitle connected={connected}>{title}</ConnectTitle>
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
            {description}
          </DialogDescription>
        </DialogHeader>
      ) : (
        <div className="space-y-1.5">
          <h2 className="text-lg font-medium tracking-tight text-foreground">
            <ConnectTitle connected={connected}>{title}</ConnectTitle>
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
      )}

      <div className="mt-5">
        {connected ? (
          <ConnectedBody
            user={connectedUser}
            isDisconnecting={isDisconnecting}
            onDisconnect={() => void disconnect()}
          />
        ) : auth.isPending ? (
          <PendingBody
            userCode={auth.userCode}
            copied={auth.copied}
            verificationUrl={auth.verificationUrl}
            onCopy={() => void auth.copyCode()}
          />
        ) : error || auth.status === "expired" ? (
          <Button type="button" variant="outline" className="w-full" onClick={retryLogin}>
            Try again
          </Button>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Getting your code…
          </div>
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-xs leading-relaxed text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ConnectTitle({
  connected,
  children,
}: {
  connected: boolean;
  children: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      {connected ? <ChatGPTMark className="size-5" /> : null}
      <span>{children}</span>
    </span>
  );
}

function PendingBody({
  userCode,
  copied,
  verificationUrl,
  onCopy,
}: {
  userCode?: string;
  copied: boolean;
  verificationUrl?: string;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-4">
      <CodeRow userCode={userCode} copied={copied} onCopy={onCopy} />

      <a
        href={verificationUrl}
        target="login-with-chatgpt"
        rel="noreferrer"
        onClick={onCopy}
        className={cn(buttonVariants(), "w-full")}
      >
        <ChatGPTMark className="size-4" />
        Open ChatGPT
      </a>

      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        {copied
          ? "Code copied. Paste it in ChatGPT; this dialog will update automatically."
          : "The code will be copied when you open ChatGPT."}
      </p>
    </div>
  );
}

function CodeRow({
  userCode,
  copied,
  onCopy,
}: {
  userCode?: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2.5">
      <code
        className={cn(
          "truncate font-mono text-base font-medium tracking-[0.14em]",
          userCode ? "text-foreground" : "text-muted-foreground",
        )}
        aria-live="polite"
      >
        {userCode ?? "Preparing…"}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        disabled={!userCode}
        onClick={onCopy}
        aria-label={copied ? "Code copied" : "Copy code"}
      >
        {copied ? (
          <Check className="size-3.5" aria-hidden="true" />
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
  const identity = user?.email ?? user?.name ?? user?.accountId;
  const plan = user?.plan?.trim();

  return (
    <div className="space-y-4">
      {identity || plan ? (
        <div className="space-y-1">
          {identity ? (
            <p className="truncate text-sm text-foreground">{identity}</p>
          ) : null}
          {plan ? (
            <p className="text-xs text-muted-foreground">
              <span className="capitalize">{plan}</span> plan
            </p>
          ) : null}
        </div>
      ) : null}
      <Button
        type="button"
        variant="outline"
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
