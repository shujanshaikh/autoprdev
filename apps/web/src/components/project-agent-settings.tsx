import { api } from "@autopr/backend/convex/_generated/api";
import {
  resolveProjectSettings,
  type ProjectSettings,
} from "@autopr/backend/convex/lib/projectSettings";
import { Button } from "@autopr/ui/components/button";
import { Checkbox } from "@autopr/ui/components/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@autopr/ui/components/dialog";
import { useMutation } from "convex/react";
import { ChevronDown, Settings } from "lucide-react";
import { useId, useState } from "react";

import { AgentModelPicker } from "#/components/agent-model-picker";
import { AgentReasoningPicker } from "#/components/agent-reasoning-picker";
import {
  agentModelKey,
  getAgentReasoningEfforts,
  selectAgentReasoningEffort,
  type AgentModelOption,
} from "#/lib/agent-models";

export function ProjectAgentSettings({ projectId, repoFullName, settings, models, demoAvailable }: {
  projectId: string;
  repoFullName: string;
  settings?: ProjectSettings;
  models: readonly AgentModelOption[];
  demoAvailable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const updateSettings = useMutation(api.projects.updateAgentSettings);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Settings className="size-3.5" aria-hidden="true" />
        Project settings
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent animated={false} className="max-h-[min(90svh,42rem)] gap-0 overflow-y-auto rounded-sm border-border bg-black p-0 text-white sm:max-w-lg">
          <div className="border-b border-border px-5 pb-4 pt-5 pr-12 sm:px-6 sm:pr-12">
            <DialogTitle className="text-base font-semibold tracking-tight">Project settings</DialogTitle>
            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{repoFullName}</p>
            <DialogDescription className="mt-3 text-xs leading-5 text-muted-foreground">
              Defaults for new threads. Existing threads keep their settings.
            </DialogDescription>
          </div>
          {open && <ProjectAgentSettingsForm
            settings={settings}
            models={models}
            demoAvailable={demoAvailable}
            onSave={async (next) => {
              await updateSettings({ projectId, settings: next });
              setOpen(false);
            }}
          />}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ProjectAgentSettingsForm({ settings, models, demoAvailable, onSave }: {
  settings?: ProjectSettings;
  models: readonly AgentModelOption[];
  demoAvailable: boolean;
  onSave: (settings: ProjectSettings | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => resolveProjectSettings(settings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function save(next: ProjectSettings | null) {
    setSaving(true);
    setError(undefined);
    try {
      await onSave(next);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save project settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      void save({ ...draft, demoEnabled: draft.demoEnabled && draft.computerUseEnabled && demoAvailable });
    }}>
      <fieldset disabled={saving} className="min-w-0 divide-y divide-border px-5 sm:px-6">
        <ProjectModelSettings model={draft.model} models={models} disabled={saving}
          onChange={(model) => setDraft({ ...draft, model })} />
        <label className="flex min-h-14 items-center justify-between gap-3 py-3 text-sm">
          <span className="font-medium">Workspace</span>
          <span className="relative min-w-0 shrink-0">
            <select className="h-8 max-w-[11rem] appearance-none rounded-sm border border-border bg-black py-1 pl-3 pr-8 text-xs text-white outline-none transition-colors hover:border-muted-foreground/60 focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/40" value={draft.workspaceMode}
              onChange={(event) => setDraft({ ...draft, workspaceMode: event.target.value === "worktree" ? "worktree" : "checkout" })}>
              <option value="checkout">Shared checkout</option>
              <option value="worktree">Isolated worktree</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          </span>
        </label>
        <SettingToggle label="Computer use" description="Let the agent control the browser and desktop."
          checked={draft.computerUseEnabled} disabled={saving}
          onChange={(computerUseEnabled) => setDraft({ ...draft, computerUseEnabled, demoEnabled: computerUseEnabled && draft.demoEnabled })} />
        <SettingToggle label="Subagents" description="Let the agent delegate work to additional agents."
          checked={draft.subAgentsEnabled} disabled={saving} onChange={(subAgentsEnabled) => setDraft({ ...draft, subAgentsEnabled })} />
        <SettingToggle label="Demo recording"
          description={!draft.computerUseEnabled ? "Requires computer use." : !demoAvailable ? "Enable demo recording in Settings → Labs first." : "Record a demo of the agent's work."}
          disabled={saving || !draft.computerUseEnabled || !demoAvailable}
          checked={draft.demoEnabled && draft.computerUseEnabled && demoAvailable}
          onChange={(demoEnabled) => setDraft({ ...draft, demoEnabled })} />
      </fieldset>
      {error && <p role="alert" className="px-5 py-2 text-xs text-destructive sm:px-6">{error}</p>}
      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-6">
        <Button type="button" variant="ghost" size="sm" className="rounded-sm px-2 text-muted-foreground hover:bg-muted hover:text-white" disabled={saving || !settings} onClick={() => void save(null)}>Reset defaults</Button>
        <Button type="submit" size="sm" className="rounded-sm px-4 font-medium" disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>
      </div>
    </form>
  );
}

function SettingToggle({ label, description, checked, disabled, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return <div className="flex min-h-16 items-center justify-between gap-4 py-3">
    <div className="min-w-0"><label htmlFor={id} className="block cursor-pointer text-sm font-medium">{label}</label><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{description}</span></div>
    <Checkbox id={id} checked={checked} disabled={disabled}
      onCheckedChange={(value) => onChange(value === true)} className="border-border bg-black" />
  </div>;
}

function ProjectModelSettings({ model, models, disabled, onChange }: {
  model: ProjectSettings["model"];
  models: readonly AgentModelOption[];
  disabled: boolean;
  onChange: (model: ProjectSettings["model"]) => void;
}) {
  const selectedKey = model ? agentModelKey(model) : "";
  const available = !selectedKey || models.some((option) => option.key === selectedKey);
  const efforts = getAgentReasoningEfforts(model);
  return <>
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 py-3">
      <span className="text-sm font-medium">Model</span>
      <div className="flex flex-wrap items-center gap-2">
        <AgentModelPicker models={models} value={selectedKey} disabled={disabled || models.length === 0} triggerClassName="rounded-sm border border-border bg-black hover:border-muted-foreground/60 hover:bg-muted/40"
          onValueChange={(key) => {
            const selected = models.find((option) => option.key === key);
            if (selected) onChange({
              provider: selected.provider,
              modelId: selected.modelId,
              reasoningEffort: selectAgentReasoningEffort(selected, model?.reasoningEffort),
            });
          }} />
        {model && <button type="button" className="text-xs text-muted-foreground hover:text-white focus-visible:outline-none focus-visible:underline" onClick={() => onChange(undefined)}>Use app default</button>}
      </div>
      {!model && <p className="w-full text-xs text-muted-foreground">Uses the app default from your connected providers.</p>}
      {!available && <p role="status" className="w-full text-xs text-amber-400">{model?.modelId} is unavailable. Connect its provider or choose another model. New threads will use an available model.</p>}
    </div>
    {model && efforts.length > 0 && <div className="flex min-h-14 items-center justify-between gap-3 py-3">
      <span className="text-sm font-medium">Reasoning level</span>
      <AgentReasoningPicker efforts={efforts} value={selectAgentReasoningEffort(model, model.reasoningEffort)} disabled={disabled}
        onValueChange={(reasoningEffort) => onChange({ ...model, reasoningEffort })} />
    </div>}
  </>;
}
