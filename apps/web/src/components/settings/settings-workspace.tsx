import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@autopr/ui/components/sidebar";
import { cn } from "@autopr/ui/lib/utils";
import {
  ArrowLeft,
  FlaskConical,
  LayoutDashboard,
  Receipt,
  type LucideIcon,
} from "lucide-react";

import { WorkOSUserButton } from "#/components/auth/workos-user-button";
import { CodexConnectPanel } from "#/components/dashboard/codex-connect-dialog";
import type {
  SandboxRuntimeStatus,
  SandboxStatus,
} from "#/components/dashboard/types";
import { GrokConnectPanel } from "#/components/dashboard/grok-connect-panel";
import { CodexLogo } from "#/components/icons/codex-logo";
import { ModeToggle } from "#/components/mode-toggle";
import type { CodexStatus } from "#/lib/codex-status";
import type { GrokStatus } from "#/lib/grok-status";

import { SettingsBilling } from "./settings-billing";
import { SettingsLabs } from "./settings-labs";
import { SettingsProjects } from "./settings-projects";
import { SettingsStats } from "./settings-stats";

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

export type SettingsTab = "overview" | "models" | "labs" | "billing";

interface SettingsTabDefinition {
  id: SettingsTab;
  label: string;
  description: string;
  icon: LucideIcon | typeof CodexLogo;
}

export const SETTINGS_TABS = [
  {
    id: "overview",
    label: "Overview",
    description: "Projects and workspace activity.",
    icon: LayoutDashboard,
  },
  {
    id: "models",
    label: "Models",
    description: "Connect the providers Autopr can use.",
    icon: CodexLogo,
  },
  {
    id: "labs",
    label: "Labs",
    description: "Opt in to experimental features.",
    icon: FlaskConical,
  },
  {
    id: "billing",
    label: "Billing",
    description: "Review sandbox usage and costs.",
    icon: Receipt,
  },
] as const satisfies readonly SettingsTabDefinition[];

export function isSettingsTab(value: string): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.id === value);
}

export function SettingsSidebar({
  activeTab,
  onSelect,
  onBack,
}: {
  activeTab: SettingsTab;
  onSelect: (tab: SettingsTab) => void;
  onBack: () => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();

  function selectTab(tab: SettingsTab) {
    if (isMobile) setOpenMobile(false);
    onSelect(tab);
  }

  function backToWorkspace() {
    if (isMobile) setOpenMobile(false);
    onBack();
  }

  return (
    <Sidebar collapsible="offcanvas" variant="inset">
      <SidebarHeader className="h-12 shrink-0 justify-center gap-0 border-b border-sidebar-border/80 px-3 py-0">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <img
              src="/images/landing/autopr-icon.png"
              alt=""
              className="size-6 shrink-0 rounded-[5px]"
            />
            <span className="truncate text-[13px] font-semibold text-sidebar-foreground">
              Settings
            </span>
          </div>
          <SidebarTrigger className="text-sidebar-foreground/70 hover:text-sidebar-foreground" />
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        <nav aria-label="Settings sections">
          <SidebarMenu>
            {SETTINGS_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = tab.id === activeTab;

              return (
                <SidebarMenuItem key={tab.id}>
                  <SidebarMenuButton
                    type="button"
                    isActive={isActive}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => selectTab(tab.id)}
                    className={cn(
                      "h-9 rounded-[6px] px-2.5 text-[13px] text-sidebar-foreground/65",
                      "hover:bg-sidebar-accent hover:text-sidebar-foreground",
                      isActive &&
                        "bg-sidebar-accent text-sidebar-foreground before:absolute before:inset-y-2 before:left-0 before:w-[2px] before:bg-[color:var(--project-selected-strong)]",
                    )}
                  >
                    <Icon className="text-sidebar-foreground/50" aria-hidden="true" />
                    <span>{tab.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </nav>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/70 p-2">
        <SidebarMenu>
          <SidebarMenuItem className="flex h-9 items-center gap-1">
            <SidebarMenuButton
              type="button"
              onClick={backToWorkspace}
              className="min-w-0 flex-1 rounded-[6px] text-sidebar-foreground/65 hover:text-sidebar-foreground"
            >
              <ArrowLeft aria-hidden="true" />
              <span>Back to workspace</span>
            </SidebarMenuButton>
            <ModeToggle className="size-8 shrink-0 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
            <WorkOSUserButton className="size-8 shrink-0" />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

interface SettingsPageProps {
  activeTab: SettingsTab;
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

export function SettingsPage({
  activeTab,
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
}: SettingsPageProps) {
  const tab = SETTINGS_TABS.find((item) => item.id === activeTab) ?? SETTINGS_TABS[0];

  return (
    <SidebarInset className="min-w-0 overflow-hidden">
      <header className="flex h-12 shrink-0 items-center border-b border-border px-4 pl-12 md:px-6">
        <SidebarTrigger className="mr-3 hidden text-muted-foreground hover:text-foreground md:flex" />
        <p className="truncate text-[13px] font-medium text-foreground">
          <span className="text-muted-foreground">Settings</span>
          <span className="px-2 text-border" aria-hidden="true">/</span>
          {tab.label}
        </p>
      </header>

      <main className="minimal-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground sm:text-2xl">
              {tab.label}
            </h1>
            <p className="text-sm text-muted-foreground">{tab.description}</p>
          </div>

          <SettingsPanel
            activeTab={activeTab}
            projects={projects}
            sandboxCosts={sandboxCosts}
            userSettings={userSettings}
            userSettingsSaving={userSettingsSaving}
            userSettingsError={userSettingsError}
            onDemoRecordingExperimentEnabledChange={onDemoRecordingExperimentEnabledChange}
            codexStatus={codexStatus}
            onCodexStatusChange={onCodexStatusChange}
            grokStatus={grokStatus}
            onGrokStatusChange={onGrokStatusChange}
          />
        </div>
      </main>
    </SidebarInset>
  );
}

function SettingsPanel({
  activeTab,
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
}: SettingsPageProps) {
  if (activeTab === "overview") {
    return (
      <section aria-label="Workspace overview" className="flex flex-col gap-4">
        <SettingsStats projects={projects} sandboxCosts={sandboxCosts} />
        <SettingsProjects projects={projects} />
      </section>
    );
  }

  if (activeTab === "models") {
    return (
      <section aria-label="Model providers" className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-sm border border-border bg-card">
          <CodexConnectPanel
            active
            autoStart={false}
            status={codexStatus}
            onStatusChange={onCodexStatusChange}
          />
        </div>
        <div className="overflow-hidden rounded-sm border border-border bg-card">
          <GrokConnectPanel
            active
            status={grokStatus}
            onStatusChange={onGrokStatusChange}
          />
        </div>
      </section>
    );
  }

  if (activeTab === "labs") {
    return (
      <section aria-label="Labs settings">
        <SettingsLabs
          userSettings={userSettings}
          saving={userSettingsSaving}
          error={userSettingsError}
          onDemoRecordingExperimentEnabledChange={onDemoRecordingExperimentEnabledChange}
        />
      </section>
    );
  }

  return (
    <section aria-label="Billing settings">
      <SettingsBilling sandboxCosts={sandboxCosts} />
    </section>
  );
}
