import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@autopr/ui/components/dialog";
import { cn } from "@autopr/ui/lib/utils";
import { FlaskConical, LayoutDashboard, Receipt } from "lucide-react";
import { CodexConnectPanel } from "#/components/dashboard/codex-connect-dialog";
import { CodexLogo } from "#/components/icons/codex-logo";
import type { SandboxStatus, SandboxRuntimeStatus } from "#/components/dashboard/types";
import type { CodexStatus } from "#/lib/codex-status";
import type { GrokStatus } from "#/lib/grok-status";
import { GrokConnectPanel } from "#/components/dashboard/grok-connect-panel";
import { SettingsStats } from "./settings-stats";
import { SettingsProjects } from "./settings-projects";
import { SettingsBilling } from "./settings-billing";
import { SettingsLabs } from "./settings-labs";

export interface WorkspaceProject {
  projectId: string;
  repoFullName: string;
  sandboxStatus: SandboxStatus;
  sandboxRuntimeStatus?: SandboxRuntimeStatus | null;
  currentBranch?: string | null;
  repoBranch?: string | null;
  defaultBranch?: string | null;
  lastOpenedAt?: number;
  updatedAt: number;
}

export interface WorkspaceSandboxCost {
  _id: string;
  projectId: string;
  sandboxId: string;
  sandboxName?: string;
  repoFullName?: string;
  status: "active" | "pending_finalization" | "finalized";
  latestTotalPrice?: number;
  finalTotalPrice?: number;
  sandboxCreatedAt: number;
  deletedAt?: number;
}

export interface WorkspaceUserSettings {
  demoRecordingExperimentEnabled: boolean;
}

type SettingsTab = "overview" | "models" | "labs" | "billing";

const tabs: {
  id: SettingsTab;
  label: string;
  icon: typeof LayoutDashboard | typeof CodexLogo;
}[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "models", label: "Models", icon: CodexLogo },
  { id: "labs", label: "Labs", icon: FlaskConical },
  { id: "billing", label: "Billing", icon: Receipt },
];

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: WorkspaceProject[] | undefined;
  sandboxCosts: WorkspaceSandboxCost[] | undefined;
  userSettings: WorkspaceUserSettings | undefined;
  userSettingsSaving: boolean;
  userSettingsError?: string;
  onDemoRecordingExperimentEnabledChange: (enabled: boolean) => void | Promise<void>;
  codexStatus?: CodexStatus;
  onCodexStatusChange: () => void;
  grokStatus?: GrokStatus;
  onGrokStatusChange: () => void;
}

export function SettingsDialog({
  open,
  onOpenChange,
  projects,
  sandboxCosts,
  userSettings,
  userSettingsSaving,
  userSettingsError,
  onDemoRecordingExperimentEnabledChange,
  codexStatus,
  onCodexStatusChange,
  grokStatus,
  onGrokStatusChange,
}: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("overview");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        animated={false}
        className="h-[100svh] max-h-[100svh] max-w-none overflow-hidden p-0 sm:h-[min(46rem,calc(100svh-2rem))] sm:max-h-none sm:max-w-5xl"
      >
        <div className="flex h-full flex-col sm:flex-row">
          <aside className="min-w-0 shrink-0 border-b border-border bg-popover sm:w-48 sm:border-b-0 sm:border-r">
            <DialogHeader className="px-4 pb-2 pr-12 pt-3 sm:pb-3 sm:pr-4 sm:pt-4">
              <DialogTitle>Settings</DialogTitle>
              <DialogDescription className="hidden text-xs min-[380px]:block">
                Projects, models, labs &amp; billing.
              </DialogDescription>
            </DialogHeader>

            <div
              className="minimal-scrollbar flex min-w-0 gap-1 overflow-x-auto px-2 pb-2 sm:flex-col sm:gap-0 sm:overflow-visible sm:pb-4"
              role="tablist"
              aria-label="Settings sections"
            >
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    id={`settings-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`settings-panel-${tab.id}`}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "relative flex h-9 shrink-0 items-center justify-center gap-1.5 px-2.5 text-left font-mono text-[10px] uppercase tracking-[0.08em] transition-colors min-[380px]:gap-2 min-[380px]:px-3 min-[380px]:text-[11px] min-[380px]:tracking-[0.12em] sm:h-auto sm:justify-start sm:py-2 sm:tracking-[0.14em]",
                      isActive
                        ? "rounded-xs bg-[color:var(--project-selected)] text-[color:var(--project-selected-strong)]"
                        : "rounded-xs text-muted-foreground hover:bg-muted/30 hover:text-foreground/80",
                    )}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1 bottom-1 hidden w-[2px] bg-primary sm:block" />
                    )}
                    {isActive && (
                      <span className="absolute inset-x-2 bottom-0 h-[2px] bg-primary sm:hidden" />
                    )}
                    <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </aside>
          <div className="minimal-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto p-2.5 min-[380px]:p-3 sm:p-4 sm:pt-12">
            {activeTab === "overview" ? (
              <div
                id="settings-panel-overview"
                role="tabpanel"
                aria-labelledby="settings-tab-overview"
                className="flex flex-col gap-4"
              >
                <SettingsStats
                  projects={projects}
                  sandboxCosts={sandboxCosts}
                />
                <SettingsProjects projects={projects} />
              </div>
            ) : activeTab === "models" ? (
              <div
                id="settings-panel-models"
                role="tabpanel"
                aria-labelledby="settings-tab-models"
                className="grid gap-4 lg:grid-cols-2"
              >
                <div className="overflow-hidden rounded-sm border border-border bg-background">
                  <CodexConnectPanel
                    active={open && activeTab === "models"}
                    autoStart={false}
                    status={codexStatus}
                    onStatusChange={onCodexStatusChange}
                  />
                </div>
                <div className="overflow-hidden rounded-sm border border-border bg-background">
                  <GrokConnectPanel
                    active={open && activeTab === "models"}
                    status={grokStatus}
                    onStatusChange={onGrokStatusChange}
                  />
                </div>
              </div>
            ) : activeTab === "labs" ? (
              <div
                id="settings-panel-labs"
                role="tabpanel"
                aria-labelledby="settings-tab-labs"
              >
                <SettingsLabs
                  userSettings={userSettings}
                  saving={userSettingsSaving}
                  error={userSettingsError}
                  onDemoRecordingExperimentEnabledChange={onDemoRecordingExperimentEnabledChange}
                />
              </div>
            ) : (
              <div
                id="settings-panel-billing"
                role="tabpanel"
                aria-labelledby="settings-tab-billing"
              >
                <SettingsBilling sandboxCosts={sandboxCosts} />
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
