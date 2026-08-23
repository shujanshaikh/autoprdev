import { describe, expect, it } from "vitest";

import {
  isSettingsTab,
  SETTINGS_TABS,
} from "./settings-workspace";

describe("settings workspace navigation", () => {
  it("keeps every visible section routable", () => {
    expect(SETTINGS_TABS.map((tab) => tab.id)).toEqual([
      "overview",
      "models",
      "labs",
      "billing",
    ]);
    expect(SETTINGS_TABS.every((tab) => isSettingsTab(tab.id))).toBe(true);
  });

  it("rejects unknown route sections", () => {
    expect(isSettingsTab("providers")).toBe(false);
    expect(isSettingsTab("")).toBe(false);
  });
});
