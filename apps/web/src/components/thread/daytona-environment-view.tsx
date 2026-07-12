import { api } from "@autopr/backend/convex/_generated/api";
import { Button } from "@autopr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@autopr/ui/components/dialog";
import { Input } from "@autopr/ui/components/input";
import { Label } from "@autopr/ui/components/label";
import { Textarea } from "@autopr/ui/components/textarea";
import { cn } from "@autopr/ui/lib/utils";
import { useAction, useQuery } from "convex/react";
import { Check, ClipboardPaste, Eye, EyeOff, KeyRound, Loader2, Pencil, Plus, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { useMemo, useState, type ClipboardEvent, type FormEvent } from "react";

import { parseEnvFile } from "#/lib/env-file";

type DaytonaEnvironmentViewProps = {
  projectId: string;
};

type DaytonaEnvironmentDialogProps = DaytonaEnvironmentViewProps & {
  disabled?: boolean;
};

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_BULK_VARIABLES = 50;

function parseHosts(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((host) => host.trim()).filter(Boolean))];
}

function actionError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function DaytonaEnvironmentView({ projectId }: DaytonaEnvironmentViewProps) {
  const project = useQuery(api.projects.get, { projectId });
  const upsertSecret = useAction(api.projectActions.upsertSandboxSecret);
  const importSecrets = useAction(api.projectActions.importSandboxSecrets);
  const removeSecret = useAction(api.projectActions.removeSandboxSecret);
  const secrets = useMemo(() => project?.sandboxSecrets ?? [], [project?.sandboxSecrets]);
  const [envName, setEnvName] = useState("");
  const [value, setValue] = useState("");
  const [hosts, setHosts] = useState("");
  const [editingName, setEditingName] = useState<string>();
  const [showValue, setShowValue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingName, setRemovingName] = useState<string>();
  const [confirmRemoveName, setConfirmRemoveName] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkHosts, setBulkHosts] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string>();
  const parsedBulkEnv = useMemo(() => parseEnvFile(bulkText), [bulkText]);

  const resetForm = () => {
    setEnvName("");
    setValue("");
    setHosts("");
    setEditingName(undefined);
    setShowValue(false);
    setError(undefined);
  };

  const beginRotate = (secret: (typeof secrets)[number]) => {
    setEditingName(secret.envName);
    setEnvName(secret.envName);
    setValue("");
    setHosts(secret.hosts.join(", "));
    setNotice(undefined);
    setError(undefined);
  };

  const openBulkImport = (text = "") => {
    setBulkText(text);
    setBulkOpen(true);
    setBulkError(undefined);
    setNotice(undefined);
    setEditingName(undefined);
  };

  const handleVariableNamePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pastedText = event.clipboardData.getData("text");
    if (!pastedText.includes("=")) return;

    event.preventDefault();
    openBulkImport(pastedText);
  };

  const handleBulkSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      parsedBulkEnv.errors.length > 0 ||
      parsedBulkEnv.entries.length === 0 ||
      parsedBulkEnv.entries.length > MAX_BULK_VARIABLES
    ) {
      setBulkError("Fix the highlighted .env lines before importing.");
      return;
    }

    setBulkSaving(true);
    setBulkError(undefined);
    setNotice(undefined);
    try {
      const result = await importSecrets({
        projectId,
        entries: parsedBulkEnv.entries,
        hosts: parseHosts(bulkHosts),
      });
      setBulkText("");
      setBulkHosts("");
      setBulkOpen(false);
      setNotice(
        `${result.importedCount} ${result.importedCount === 1 ? "variable" : "variables"} imported.${result.restarted ? " Daytona restarted the sandbox so new processes can read them." : " Start a new terminal or restart the app process to read the updates."}`,
      );
    } catch (importError) {
      setBulkError(actionError(importError, "Could not import the environment file."));
    } finally {
      setBulkSaving(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = envName.trim();
    if (!ENV_NAME_PATTERN.test(normalizedName)) {
      setError("Use a variable name such as DATABASE_URL or API_TOKEN.");
      return;
    }
    if (!value) {
      setError("Enter the secret value. Daytona does not return saved values later.");
      return;
    }

    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await upsertSecret({
        projectId,
        envName: normalizedName,
        value,
        hosts: parseHosts(hosts),
      });
      resetForm();
      setNotice(
        result.restarted
          ? `${result.envName} is mounted. Daytona restarted the sandbox so new processes can read it.`
          : `${result.envName} is mounted. Start a new terminal or restart the app process to read the update.`,
      );
    } catch (submitError) {
      setError(actionError(submitError, "Could not save the sandbox secret."));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (name: string) => {
    setRemovingName(name);
    setError(undefined);
    setNotice(undefined);
    try {
      await removeSecret({ projectId, envName: name });
      if (editingName === name) resetForm();
      setConfirmRemoveName(undefined);
      setNotice(`${name} was detached from the sandbox and deleted from Daytona.`);
    } catch (removeError) {
      setError(actionError(removeError, "Could not remove the sandbox secret."));
    } finally {
      setRemovingName(undefined);
    }
  };

  return (
    <div className="minimal-scrollbar min-h-0 flex-1 overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-5 px-5 py-6 sm:px-7 sm:py-8">
        <div className="flex items-start gap-3 border-b border-border/70 pb-5">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[10px] border border-border bg-[color:var(--project-panel-soft)]">
            <KeyRound className="size-4 text-foreground/80" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold tracking-[-0.01em] text-foreground">Sandbox environment</h2>
            <p className="mt-1 max-w-[560px] text-[13px] leading-relaxed text-muted-foreground">
              Store project credentials as Daytona secrets. The sandbox receives an opaque placeholder, and Daytona substitutes the real value only in outbound HTTP(S) requests.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => bulkOpen ? setBulkOpen(false) : openBulkImport()}
            className={cn("h-8 shrink-0 gap-1.5 px-2.5 font-mono text-[10px]", bulkOpen && "bg-muted text-foreground")}
          >
            {bulkOpen ? <X className="size-3.5" aria-hidden="true" /> : <ClipboardPaste className="size-3.5" aria-hidden="true" />}
            {bulkOpen ? "Close import" : "Paste .env"}
          </Button>
        </div>

        {bulkOpen ? (
          <form onSubmit={handleBulkSubmit} className="border border-[color:var(--project-selected-strong)]/35 bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-[color:var(--project-selected)] px-4 py-2.5">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/75">
                <ClipboardPaste className="size-3.5" aria-hidden="true" />
                Import .env file
              </div>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {parsedBulkEnv.entries.length} detected
              </span>
            </div>
            <div className="grid gap-4 p-4">
              <div className="grid gap-1.5">
                <Label htmlFor="sandbox-env-bulk" className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Environment file
                </Label>
                <Textarea
                  id="sandbox-env-bulk"
                  value={bulkText}
                  onChange={(event) => {
                    setBulkText(event.target.value);
                    setBulkError(undefined);
                  }}
                  disabled={bulkSaving}
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  rows={8}
                  placeholder={"DATABASE_URL=postgres://…\nAPI_TOKEN=secret\n# Comments are ignored"}
                  className="min-h-40 resize-y font-mono text-xs leading-relaxed"
                  autoFocus
                />
              </div>

              {parsedBulkEnv.entries.length > 0 ? (
                <div className="border border-border bg-muted/15">
                  <div className="flex items-center justify-between border-b border-border/70 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                    <span>Detected keys</span>
                    {parsedBulkEnv.duplicateNames.length > 0 ? <span>last duplicate wins</span> : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5 p-2.5">
                    {parsedBulkEnv.entries.slice(0, 12).map((entry) => (
                      <span key={entry.envName} className="inline-flex items-center gap-1.5 border border-border bg-background px-2 py-1 font-mono text-[10px] text-foreground/80">
                        <Check className="size-3 text-emerald-500" aria-hidden="true" />
                        {entry.envName}
                        {secrets.some((secret) => secret.envName === entry.envName) ? <span className="text-muted-foreground">· replace</span> : null}
                      </span>
                    ))}
                    {parsedBulkEnv.entries.length > 12 ? (
                      <span className="px-2 py-1 font-mono text-[10px] text-muted-foreground">+{parsedBulkEnv.entries.length - 12} more</span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {parsedBulkEnv.errors.length > 0 ? (
                <div role="alert" className="border border-destructive/35 bg-destructive/[0.04] px-3 py-2 text-xs leading-relaxed text-destructive">
                  <p className="font-medium">Could not parse {parsedBulkEnv.errors.length} {parsedBulkEnv.errors.length === 1 ? "line" : "lines"}:</p>
                  <ul className="mt-1 list-inside list-disc font-mono text-[10px]">
                    {parsedBulkEnv.errors.slice(0, 4).map((parseError) => <li key={parseError}>{parseError}</li>)}
                  </ul>
                </div>
              ) : null}

              {parsedBulkEnv.entries.length > MAX_BULK_VARIABLES ? (
                <p role="alert" className="border border-destructive/35 bg-destructive/[0.04] px-3 py-2 text-xs text-destructive">
                  Import at most {MAX_BULK_VARIABLES} variables at a time.
                </p>
              ) : null}

              <div className="grid gap-1.5">
                <Label htmlFor="sandbox-env-bulk-hosts" className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Allowed hosts for all imported values <span className="normal-case tracking-normal text-muted-foreground/65">— optional</span>
                </Label>
                <Input
                  id="sandbox-env-bulk-hosts"
                  value={bulkHosts}
                  onChange={(event) => setBulkHosts(event.target.value)}
                  disabled={bulkSaving}
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="api.example.com, *.example.org"
                  className="font-mono"
                />
              </div>

              {bulkError ? <p role="alert" className="border border-destructive/35 bg-destructive/[0.04] px-3 py-2 text-xs text-destructive">{bulkError}</p> : null}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] leading-relaxed text-muted-foreground">Existing keys are rotated. Values are never shown again.</p>
                <Button type="submit" size="sm" disabled={bulkSaving || parsedBulkEnv.entries.length === 0 || parsedBulkEnv.entries.length > MAX_BULK_VARIABLES || parsedBulkEnv.errors.length > 0} className="h-8 gap-1.5 px-3">
                  {bulkSaving ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Upload className="size-3.5" aria-hidden="true" />}
                  Import {parsedBulkEnv.entries.length || "variables"}
                </Button>
              </div>
            </div>
          </form>
        ) : null}

        <form onSubmit={handleSubmit} className="border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-muted/20 px-4 py-2.5">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-[color:var(--project-selected-strong)]" aria-hidden="true" />
              {editingName ? "Rotate secret" : "Add variable"}
            </div>
            {editingName ? (
              <Button type="button" variant="ghost" size="sm" onClick={resetForm} className="h-7 gap-1.5 px-2 text-xs text-muted-foreground">
                <X className="size-3.5" aria-hidden="true" />
                Cancel
              </Button>
            ) : null}
          </div>

          <div className="grid gap-4 p-4">
            <div className="grid gap-1.5">
              <Label htmlFor="sandbox-env-name" className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Variable name
              </Label>
              <Input
                id="sandbox-env-name"
                value={envName}
                onChange={(event) => setEnvName(event.target.value)}
                onPaste={handleVariableNamePaste}
                disabled={Boolean(editingName) || saving}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                placeholder="DATABASE_URL"
                className="font-mono"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="sandbox-env-value" className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Secret value
              </Label>
              <div className="relative">
                <Input
                  id="sandbox-env-value"
                  type={showValue ? "text" : "password"}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  disabled={saving}
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder={editingName ? "Enter the replacement value" : "Paste a credential"}
                  className="pr-10 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowValue((current) => !current)}
                  className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                  aria-label={showValue ? "Hide secret value" : "Show secret value"}
                >
                  {showValue ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                </button>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="sandbox-env-hosts" className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Allowed hosts <span className="normal-case tracking-normal text-muted-foreground/65">— recommended</span>
              </Label>
              <Input
                id="sandbox-env-hosts"
                value={hosts}
                onChange={(event) => setHosts(event.target.value)}
                disabled={saving}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                placeholder="api.example.com, *.example.org"
                className="font-mono"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Hostnames only—no protocol, path, or port. Leaving this empty lets Daytona substitute the credential for any host.
              </p>
            </div>

            {error ? <p role="alert" className="border border-destructive/35 bg-destructive/[0.04] px-3 py-2 text-xs leading-relaxed text-destructive">{error}</p> : null}
            {notice ? (
              <p role="status" className="flex items-start gap-2 border border-emerald-500/25 bg-emerald-500/[0.04] px-3 py-2 text-xs leading-relaxed text-foreground/80">
                <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                {notice}
              </p>
            ) : null}

            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                Values are write-only and never saved to the AutoPR database.
              </p>
              <Button type="submit" size="sm" disabled={saving} className="h-8 gap-1.5 px-3">
                {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
                {editingName ? "Rotate secret" : "Add variable"}
              </Button>
            </div>
          </div>
        </form>

        <section aria-labelledby="mounted-secrets-title" className="grid gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <h3 id="mounted-secrets-title" className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Mounted variables
            </h3>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground/65">{secrets.length}</span>
          </div>

          {project === undefined ? (
            <div className="grid h-20 place-items-center border border-border bg-card text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-label="Loading mounted variables" />
            </div>
          ) : secrets.length === 0 ? (
            <div className="border border-dashed border-border bg-muted/10 px-4 py-6 text-center">
              <p className="font-mono text-xs text-foreground/75">No variables mounted</p>
              <p className="mt-1 text-xs text-muted-foreground">Add the first credential for this project above.</p>
            </div>
          ) : (
            <div className="divide-y divide-border border border-border bg-card">
              {secrets.map((secret) => {
                const removing = removingName === secret.envName;
                const confirming = confirmRemoveName === secret.envName;
                return (
                  <div key={secret.envName} className="grid gap-2.5 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2 font-mono text-xs">
                        <span className="truncate font-semibold text-foreground">{secret.envName}</span>
                        <span className="select-none text-muted-foreground/45" aria-label="Secret value hidden">••••••••</span>
                      </div>
                      <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                        {secret.hosts.length > 0 ? secret.hosts.join(", ") : "all hosts · unrestricted"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {confirming ? (
                        <>
                          <span className="mr-1 text-[11px] text-destructive">Delete permanently?</span>
                          <Button type="button" variant="destructive" size="sm" disabled={removing} onClick={() => void handleRemove(secret.envName)} className="h-7 px-2 text-xs">
                            {removing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : "Delete"}
                          </Button>
                          <Button type="button" variant="ghost" size="sm" disabled={removing} onClick={() => setConfirmRemoveName(undefined)} className="h-7 px-2 text-xs">Cancel</Button>
                        </>
                      ) : (
                        <>
                          <Button type="button" variant="ghost" size="sm" onClick={() => beginRotate(secret)} className={cn("h-7 gap-1.5 px-2 text-xs text-muted-foreground", editingName === secret.envName && "bg-muted text-foreground")}>
                            <Pencil className="size-3.5" aria-hidden="true" />
                            Rotate
                          </Button>
                          <Button type="button" variant="ghost" size="icon" onClick={() => setConfirmRemoveName(secret.envName)} className="size-7 text-muted-foreground hover:text-destructive" aria-label={`Delete ${secret.envName}`}>
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function DaytonaEnvironmentDialog({ projectId, disabled = false }: DaytonaEnvironmentDialogProps) {
  const project = useQuery(api.projects.get, { projectId });
  const secretCount = project?.sandboxSecrets?.length ?? 0;

  return (
    <Dialog>
      <DialogTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-2 font-mono text-[11px]"
          />
        }
      >
        <KeyRound className="size-3.5" aria-hidden="true" />
        Add env
        {secretCount > 0 ? (
          <span className="grid min-w-4 place-items-center rounded-full bg-[color:var(--project-selected)] px-1 text-[9px] tabular-nums text-foreground/75">
            {secretCount}
          </span>
        ) : null}
      </DialogTrigger>
      <DialogContent className="h-[min(82vh,760px)] gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogTitle className="sr-only">Sandbox environment</DialogTitle>
        <DialogDescription className="sr-only">
          Add, rotate, or delete environment secrets mounted in this project sandbox.
        </DialogDescription>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <DaytonaEnvironmentView projectId={projectId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
