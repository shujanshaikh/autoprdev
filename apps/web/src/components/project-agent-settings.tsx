import { api } from "@autopr/backend/convex/_generated/api";
import {
  resolveProjectSettings,
  type ProjectSettings,
} from "@autopr/backend/convex/lib/projectSettings";
import { Button } from "@autopr/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@autopr/ui/components/dialog";
import { useMutation } from "convex/react";
import { Settings } from "lucide-react";
import { useState } from "react";

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
        <DialogContent animated={false} className="max-h-[90svh] overflow-y-auto rounded-sm bg-black text-white sm:max-w-xl">
          <div className="pr-8">
            <DialogTitle>Project settings</DialogTitle>
            <p className="mt-1 truncate font-mono text-xs">{repoFullName}</p>
            <DialogDescription className="mt-3 text-xs text-white/60">
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
      <fieldset disabled={saving} className="min-w-0 divide-y divide-white/15">
        <ProjectModelSettings model={draft.model} models={models} disabled={saving}
          onChange={(model) => setDraft({ ...draft, model })} />
        <label className="flex items-center justify-between gap-3 py-4 text-sm">
          Workspace
          <select className="max-w-[65%] rounded-sm border border-white/20 bg-black p-2 text-xs" value={draft.workspaceMode}
            onChange={(event) => setDraft({ ...draft, workspaceMode: event.target.value === "worktree" ? "worktree" : "checkout" })}>
            <option value="checkout">Shared checkout</option>
            <option value="worktree">Isolated worktree</option>
          </select>
        </label>
        <SettingToggle label="Computer use" description="Let the agent control the browser and desktop."
          checked={draft.computerUseEnabled}
          onChange={(computerUseEnabled) => setDraft({ ...draft, computerUseEnabled, demoEnabled: computerUseEnabled && draft.demoEnabled })} />
        <SettingToggle label="Subagents" description="Let the agent delegate work to additional agents."
          checked={draft.subAgentsEnabled} onChange={(subAgentsEnabled) => setDraft({ ...draft, subAgentsEnabled })} />
        <SettingToggle label="Demo recording"
          description={!draft.computerUseEnabled ? "Requires computer use." : !demoAvailable ? "Enable demo recording in Settings → Labs first." : "Record a demo of the agent's work."}
          disabled={!draft.computerUseEnabled || !demoAvailable}
          checked={draft.demoEnabled && draft.computerUseEnabled && demoAvailable}
          onChange={(demoEnabled) => setDraft({ ...draft, demoEnabled })} />
      </fieldset>
      {error && <p role="alert" className="py-2 text-xs text-red-400">{error}</p>}
      <div className="flex items-center justify-between border-t border-white/15 pt-4">
        <Button type="button" variant="ghost" size="sm" disabled={saving || !settings} onClick={() => void save(null)}>Reset defaults</Button>
        <Button type="submit" size="sm" disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>
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
  return <label className="flex cursor-pointer items-center justify-between gap-4 py-4">
    <span><span className="block text-sm">{label}</span><span className="mt-1 block text-xs text-white/60">{description}</span></span>
    <input type="checkbox" aria-label={label} checked={checked} disabled={disabled}
      onChange={(event) => onChange(event.target.checked)} className="size-4 shrink-0 accent-white" />
  </label>;
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
    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
      <span className="text-sm">Model</span>
      <div className="flex flex-wrap items-center gap-2">
        <AgentModelPicker models={models} value={selectedKey} disabled={disabled || models.length === 0}
          onValueChange={(key) => {
            const selected = models.find((option) => option.key === key);
            if (selected) onChange({
              provider: selected.provider,
              modelId: selected.modelId,
              reasoningEffort: selectAgentReasoningEffort(selected, model?.reasoningEffort),
            });
          }} />
        {model && <button type="button" className="text-xs text-white/60 hover:text-white" onClick={() => onChange(undefined)}>Use app default</button>}
      </div>
      {!model && <p className="w-full text-xs text-white/60">Use the app default model from your connected providers.</p>}
      {!available && <p role="status" className="w-full text-xs text-amber-400">{model?.modelId} is unavailable. Connect its provider or choose another model. New threads will use an available model.</p>}
    </div>
    {model && efforts.length > 0 && <div className="flex items-center justify-between gap-3 py-4">
      <span className="text-sm">Reasoning level</span>
      <AgentReasoningPicker efforts={efforts} value={selectAgentReasoningEffort(model, model.reasoningEffort)} disabled={disabled}
        onValueChange={(reasoningEffort) => onChange({ ...model, reasoningEffort })} />
    </div>}
  </>;
}
