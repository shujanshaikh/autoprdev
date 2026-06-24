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

type SettingsTab = "overview" | "codex" | "labs" | "billing";

const tabs: {
  id: SettingsTab;
  label: string;
  icon: typeof LayoutDashboard | typeof CodexLogo;
}[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "codex", label: "Codex", icon: CodexLogo },
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
}: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("overview");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        animated={false}
        className="h-[min(46rem,calc(100svh-2rem))] overflow-hidden p-0 sm:max-w-5xl"
      >
        <div className="flex h-full flex-col sm:flex-row">
          <aside className="shrink-0 border-b border-border sm:w-48 sm:border-b-0 sm:border-r">
            <DialogHeader className="px-4 pb-3 pr-12 pt-4 sm:pr-4">
              <DialogTitle>Settings</DialogTitle>
              <DialogDescription className="text-xs">
                Projects, Codex, labs &amp; billing.
              </DialogDescription>
            </DialogHeader>

            <div
              className="flex gap-0 px-2 pb-2 sm:flex-col sm:pb-4"
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
                      "relative flex items-center gap-2.5 px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                      isActive
                        ? "bg-muted/60 text-foreground"
                        : "text-muted-foreground hover:bg-muted/30 hover:text-foreground/80",
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
          <div className="minimal-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto p-4 pt-12">
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
            ) : activeTab === "codex" ? (
              <div
                id="settings-panel-codex"
                role="tabpanel"
                aria-labelledby="settings-tab-codex"
              >
                <div className="overflow-hidden border border-border bg-background">
                  <CodexConnectPanel
                    active={open && activeTab === "codex"}
                    status={codexStatus}
                    onStatusChange={onCodexStatusChange}
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
