// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsBilling } from "./settings-billing";
import type { WorkspaceSandboxCost } from "./settings-workspace";

const row: WorkspaceSandboxCost = {
  _id: "cost-1", projectId: "project-1", sandboxId: "sandbox-1",
  status: "active", sandboxProvider: "e2b", costSource: "estimated",
  sandboxCreatedAt: 0, e2bState: "running", latestTotalPrice: 0.25,
};

describe("sandbox billing counts", () => {
  afterEach(cleanup);

  it("counts running, paused, and finalized sandboxes separately", () => {
    render(<SettingsBilling sandboxCosts={[
      row,
      { ...row, _id: "paused-1", e2bState: "paused" },
      { ...row, _id: "paused-2", e2bState: "paused" },
      { ...row, _id: "gone", status: "finalized", e2bState: "killed" },
      { ...row, _id: "unknown", e2bState: undefined },
    ]} />);
    expect(screen.getAllByText("Active")[0]?.nextElementSibling?.textContent).toBe("1");
    expect(screen.getAllByText("Paused")[0]?.nextElementSibling?.textContent).toBe("2");
    expect(screen.getAllByText("Finalized")[0]?.nextElementSibling?.textContent).toBe("1");
    expect(screen.getByText("Awaiting sync")).toBeDefined();
  });

  it("labels missing history and unknown prices without presenting them as complete totals", () => {
    render(<SettingsBilling sandboxCosts={[
      { ...row, e2bUsageHistoryComplete: false, latestTotalPrice: undefined },
    ]} />);
    expect(screen.getByText("Known Spend")).toBeDefined();
    expect(screen.getByText(/Missing history/)).toBeDefined();
    expect(screen.getAllByText("Unknown")).toHaveLength(2);
  });
});
