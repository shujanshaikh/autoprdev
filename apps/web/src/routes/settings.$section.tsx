import { createFileRoute, redirect } from "@tanstack/react-router";

import { AuthGate } from "#/components/project-shell";
import {
  isSettingsTab,
} from "#/components/settings/settings-workspace";
import { WorkspaceShell } from "#/components/workspace-shell";

function SettingsRoute() {
  const { section } = Route.useParams();
  const activeTab = isSettingsTab(section) ? section : "overview";

  return (
    <AuthGate>
      <WorkspaceShell settingsTab={activeTab} />
    </AuthGate>
  );
}

export const Route = createFileRoute("/settings/$section")({
  beforeLoad: ({ params }) => {
    if (!isSettingsTab(params.section)) {
      throw redirect({
        to: "/settings/$section",
        params: { section: "overview" },
        replace: true,
      });
    }
  },
  component: SettingsRoute,
});
