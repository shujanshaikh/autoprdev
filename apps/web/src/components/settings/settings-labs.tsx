import { Checkbox } from "@autopr/ui/components/checkbox";
import { AlertTriangle, Loader2, Video } from "lucide-react";
import type { WorkspaceUserSettings } from "./settings-dialog";

interface SettingsLabsProps {
  userSettings: WorkspaceUserSettings | undefined;
  saving: boolean;
  error?: string;
  onDemoRecordingExperimentEnabledChange: (enabled: boolean) => void | Promise<void>;
}

export function SettingsLabs({
  userSettings,
  saving,
  error,
  onDemoRecordingExperimentEnabledChange,
}: SettingsLabsProps) {
  const enabled = Boolean(userSettings?.demoRecordingExperimentEnabled);
  const loading = userSettings === undefined;
  const disabled = loading || saving;

  return (
    <div className="flex flex-col gap-4">
      <section className="min-w-0 border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              Experimental features
            </h2>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/65">
            Labs
          </span>
        </div>

        <div className="p-4">
          <label
            htmlFor="settings-demo-recording-experiment"
            className="flex cursor-pointer flex-col gap-3 border border-border/70 bg-muted/20 p-3 transition-colors hover:bg-muted/30 has-disabled:cursor-not-allowed has-disabled:opacity-60 min-[420px]:flex-row min-[420px]:items-start"
          >
            <Checkbox
              id="settings-demo-recording-experiment"
              checked={enabled}
              disabled={disabled}
              onCheckedChange={(checked) =>
                void onDemoRecordingExperimentEnabledChange(checked === true)
              }
              className="mt-0.5"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Video className="size-3.5 text-muted-foreground" aria-hidden="true" />
                Demo recording
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Show the Demo button in project and thread composers.
              </span>
            </span>
            <span className="flex h-5 shrink-0 items-center gap-1.5 self-end font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground min-[420px]:self-auto">
              {saving ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : null}
              {enabled ? "On" : "Off"}
            </span>
          </label>

          <div className="mt-3 flex gap-2 border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <p>
              Demo recording is experimental and can fail when the browser preview or Daytona desktop recording is unavailable.
            </p>
          </div>

          {error ? (
            <div className="mt-3 border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
