// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT_SETTINGS } from "@autopr/backend/convex/lib/projectSettings";
import { ProjectAgentSettingsForm } from "./project-agent-settings";

describe("project settings form", () => {
  afterEach(cleanup);

  it("turns recording off when computer use is disabled and saves the selected workspace", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProjectAgentSettingsForm settings={{ ...DEFAULT_PROJECT_SETTINGS, demoEnabled: true }} models={[]} demoAvailable onSave={onSave} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Computer use" }));
    expect((screen.getByRole("checkbox", { name: "Demo recording" }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "Workspace" }), { target: { value: "worktree" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_PROJECT_SETTINGS, computerUseEnabled: false, demoEnabled: false, workspaceMode: "worktree" }));
  });

  it("keeps edits visible after a failed save and supports resetting inherited defaults", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("Could not save settings.")).mockResolvedValue(undefined);
    render(<ProjectAgentSettingsForm settings={DEFAULT_PROJECT_SETTINGS} models={[]} demoAvailable={false} onSave={onSave} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Subagents" }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await screen.findByRole("alert");
    expect((screen.getByRole("checkbox", { name: "Subagents" }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Reset defaults" }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(null));
  });
});
