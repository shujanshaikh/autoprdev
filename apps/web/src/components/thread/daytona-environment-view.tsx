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
import { useAction, useQuery } from "convex/react";
import { Check, ClipboardPaste, Eye, EyeOff, KeyRound, Loader2, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState, type ClipboardEvent, type FormEvent } from "react";

import { parseEnvFile } from "#/lib/env-file";

type DaytonaEnvironmentViewProps = {
  projectId: string;
};

type DaytonaEnvironmentDialogProps = DaytonaEnvironmentViewProps & {
  disabled?: boolean;
};

type DraftEnvironmentVariable = {
  id: string;
  envName: string;
  value: string;
};

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_VARIABLES = 50;

function emptyDraftVariable(id = "environment-variable-initial"): DraftEnvironmentVariable {
  return { id, envName: "", value: "" };
}

function parseHosts(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((host) => host.trim()).filter(Boolean))];
}

function actionError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function DaytonaEnvironmentView({ projectId }: DaytonaEnvironmentViewProps) {
  const project = useQuery(api.projects.get, { projectId });
  const importSecrets = useAction(api.projectActions.importSandboxSecrets);
  const removeSecret = useAction(api.projectActions.removeSandboxSecret);
  const secrets = useMemo(() => project?.sandboxSecrets ?? [], [project?.sandboxSecrets]);
  const [draftVariables, setDraftVariables] = useState<DraftEnvironmentVariable[]>(() => [emptyDraftVariable()]);
  const [hosts, setHosts] = useState("");
  const [visibleValueIds, setVisibleValueIds] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [removingName, setRemovingName] = useState<string>();
  const [confirmRemoveName, setConfirmRemoveName] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const updateDraftVariable = (id: string, field: "envName" | "value", value: string) => {
    setDraftVariables((current) => current.map((variable) => (
      variable.id === id ? { ...variable, [field]: value } : variable
    )));
    setError(undefined);
  };

  const addDraftVariable = () => {
    if (draftVariables.length >= MAX_VARIABLES) return;
    setDraftVariables((current) => [
      ...current,
      emptyDraftVariable(`environment-variable-${Date.now()}-${current.length}`),
    ]);
  };

  const removeDraftVariable = (id: string) => {
    setDraftVariables((current) => current.length === 1
      ? [emptyDraftVariable()]
      : current.filter((variable) => variable.id !== id));
    setVisibleValueIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const replaceDraftsFromEnv = (pastedText: string) => {
    const parsed = parseEnvFile(pastedText);
    if (parsed.errors.length > 0) {
      setError(parsed.errors.slice(0, 4).join(" "));
      return false;
    }
    if (parsed.entries.length === 0) {
      setError("No environment variables were detected in the pasted text.");
      return false;
    }
    if (parsed.entries.length > MAX_VARIABLES) {
      setError(`Paste at most ${MAX_VARIABLES} variables at a time.`);
      return false;
    }

    setDraftVariables(parsed.entries.map((entry, index) => ({
      id: `pasted-environment-variable-${index}-${entry.envName}`,
      envName: entry.envName,
      value: entry.value,
    })));
    setVisibleValueIds(new Set());
    setError(undefined);
    setNotice(
      `${parsed.entries.length} ${parsed.entries.length === 1 ? "variable" : "variables"} detected${parsed.duplicateNames.length > 0 ? "; the last duplicate value was kept" : ""}. Review and save below.`,
    );
    return true;
  };

  const handleEnvPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pastedText = event.clipboardData.getData("text");
    if (!pastedText.includes("=")) return;
    event.preventDefault();
    replaceDraftsFromEnv(pastedText);
  };

  const beginRotate = (secret: (typeof secrets)[number]) => {
    setDraftVariables([{
      id: `rotating-environment-variable-${secret.envName}`,
      envName: secret.envName,
      value: "",
    }]);
    setHosts(secret.hosts.join(", "));
    setVisibleValueIds(new Set());
    setNotice(`Enter a new value for ${secret.envName}, then save.`);
    setError(undefined);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const entries = draftVariables.reduce<Array<{ envName: string; value: string }>>((result, variable) => {
      const entry = { envName: variable.envName.trim(), value: variable.value };
      if (entry.envName || entry.value) result.push(entry);
      return result;
    }, []);

    if (entries.length === 0) {
      setError("Add a variable or paste a complete .env file first.");
      return;
    }
    if (entries.some((entry) => !ENV_NAME_PATTERN.test(entry.envName))) {
      setError("Variable names must start with a letter or underscore and contain only letters, numbers, and underscores.");
      return;
    }
    if (entries.some((entry) => !entry.value)) {
      setError("Every variable needs a value.");
      return;
    }
    if (new Set(entries.map((entry) => entry.envName)).size !== entries.length) {
      setError("Each variable name can appear only once.");
      return;
    }

    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await importSecrets({ projectId, entries, hosts: parseHosts(hosts) });
      setDraftVariables([emptyDraftVariable()]);
      setHosts("");
      setVisibleValueIds(new Set());
      setNotice(
        `${result.importedCount} ${result.importedCount === 1 ? "variable" : "variables"} saved.${result.restarted ? " Daytona restarted the sandbox so new processes can read them." : " Start a new terminal or restart the app process to read the updates."}`,
      );
    } catch (saveError) {
      setError(actionError(saveError, "Could not save the environment variables."));
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
            <h2 className="text-base font-semibold tracking-[-0.01em] text-foreground">Environment variables</h2>
            <p className="mt-1 max-w-[560px] text-[13px] leading-relaxed text-muted-foreground">
              Add variables one at a time, or paste an entire .env file into any field to split it into editable rows.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-muted/20 px-4 py-2.5">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-[color:var(--project-selected-strong)]" aria-hidden="true" />
              Environment variables
            </div>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
              {draftVariables.length}/{MAX_VARIABLES}
            </span>
          </div>

          <div className="grid gap-4 p-4">
            <div className="flex items-start gap-2 border border-dashed border-border bg-muted/10 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
              <ClipboardPaste className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>Paste <span className="font-mono text-foreground/80">KEY=value</span> lines into any key or value field. They will automatically become separate rows.</span>
            </div>

            <div className="grid gap-2">
              <div className="hidden grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)_2rem] gap-2 px-0.5 sm:grid">
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Key</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Value</span>
                <span />
              </div>

              {draftVariables.map((variable, index) => {
                const valueVisible = visibleValueIds.has(variable.id);
                const replacesExisting = secrets.some((secret) => secret.envName === variable.envName.trim());
                return (
                  <div key={variable.id} className="grid gap-2 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)_2rem] sm:items-start">
                    <div className="grid gap-1">
                      <Label htmlFor={`${variable.id}-key`} className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground sm:sr-only">Key</Label>
                      <Input
                        id={`${variable.id}-key`}
                        value={variable.envName}
                        onChange={(event) => updateDraftVariable(variable.id, "envName", event.target.value)}
                        onPaste={handleEnvPaste}
                        disabled={saving}
                        autoCapitalize="none"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={index === 0 ? "DATABASE_URL" : "VARIABLE_NAME"}
                        className="font-mono"
                      />
                      {replacesExisting ? <span className="px-1 text-[9px] text-muted-foreground">Replaces existing value</span> : null}
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`${variable.id}-value`} className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground sm:sr-only">Value</Label>
                      <div className="relative">
                        <Input
                          id={`${variable.id}-value`}
                          type={valueVisible ? "text" : "password"}
                          value={variable.value}
                          onChange={(event) => updateDraftVariable(variable.id, "value", event.target.value)}
                          onPaste={handleEnvPaste}
                          disabled={saving}
                          autoComplete="new-password"
                          spellCheck={false}
                          placeholder="Secret value"
                          className="pr-9 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setVisibleValueIds((current) => {
                            const next = new Set(current);
                            if (next.has(variable.id)) next.delete(variable.id);
                            else next.add(variable.id);
                            return next;
                          })}
                          className="absolute inset-y-0 right-0 grid w-9 place-items-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                          aria-label={valueVisible ? `Hide ${variable.envName || "variable"} value` : `Show ${variable.envName || "variable"} value`}
                        >
                          {valueVisible ? <EyeOff className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
                        </button>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeDraftVariable(variable.id)}
                      disabled={saving}
                      className="size-8 justify-self-end text-muted-foreground hover:text-destructive sm:mt-0.5"
                      aria-label={`Remove ${variable.envName || `variable ${index + 1}`}`}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                );
              })}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addDraftVariable}
              disabled={saving || draftVariables.length >= MAX_VARIABLES}
              className="h-8 w-fit gap-1.5 px-2 text-xs text-muted-foreground"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add another
            </Button>

            <div className="grid gap-1.5 border-t border-border/70 pt-4">
              <Label htmlFor="sandbox-env-hosts" className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Allowed hosts for these values <span className="normal-case tracking-normal text-muted-foreground/65">— optional</span>
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
                Daytona substitutes secrets only for these HTTP(S) hosts. Leave empty to allow any host.
              </p>
            </div>

            {error ? <p role="alert" className="border border-destructive/35 bg-destructive/[0.04] px-3 py-2 text-xs leading-relaxed text-destructive">{error}</p> : null}
            {notice ? (
              <p role="status" className="flex items-start gap-2 border border-emerald-500/25 bg-emerald-500/[0.04] px-3 py-2 text-xs leading-relaxed text-foreground/80">
                <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                {notice}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                Values are write-only and never saved to the AutoPR database.
              </p>
              <Button type="submit" size="sm" disabled={saving} className="h-8 gap-1.5 px-3">
                {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                Save variables
              </Button>
            </div>
          </div>
        </form>

        <section aria-labelledby="mounted-secrets-title" className="grid gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <h3 id="mounted-secrets-title" className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Mounted variables</h3>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground/65">{secrets.length}</span>
          </div>

          {project === undefined ? (
            <div className="grid h-20 place-items-center border border-border bg-card text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-label="Loading mounted variables" />
            </div>
          ) : secrets.length === 0 ? (
            <div className="border border-dashed border-border bg-muted/10 px-4 py-6 text-center">
              <p className="font-mono text-xs text-foreground/75">No variables mounted</p>
              <p className="mt-1 text-xs text-muted-foreground">Add a variable or paste your .env file above.</p>
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
                          <Button type="button" variant="ghost" size="sm" onClick={() => beginRotate(secret)} className="h-7 gap-1.5 px-2 text-xs text-muted-foreground">
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
        render={<Button type="button" variant="outline" size="sm" className="h-8 gap-2 font-mono text-[11px]" />}
      >
        <KeyRound className="size-3.5" aria-hidden="true" />
        Add env
        {secretCount > 0 ? (
          <span className="grid min-w-4 place-items-center rounded-full bg-[color:var(--project-selected)] px-1 text-[9px] tabular-nums text-foreground/75">{secretCount}</span>
        ) : null}
      </DialogTrigger>
      <DialogContent className="h-[min(82vh,760px)] gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogTitle className="sr-only">Sandbox environment</DialogTitle>
        <DialogDescription className="sr-only">Add, rotate, or delete environment secrets mounted in this project sandbox.</DialogDescription>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <DaytonaEnvironmentView projectId={projectId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
