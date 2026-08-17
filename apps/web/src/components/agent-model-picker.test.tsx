// @vitest-environment jsdom

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentModelPicker } from "./agent-model-picker";

const models = [
  {
    key: "openai-codex:gpt-5.6-sol",
    provider: "openai-codex" as const,
    modelId: "gpt-5.6-sol",
    label: "GPT-5.6-Sol",
  },
  {
    key: "xai:grok-4",
    provider: "xai" as const,
    modelId: "grok-4",
    label: "Grok-4",
  },
];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AgentModelPicker", () => {
  it("switches provider catalogs and selects a model", async () => {
    const onValueChange = vi.fn();
    render(
      <AgentModelPicker
        models={models}
        value="openai-codex:gpt-5.6-sol"
        onValueChange={onValueChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /choose model/i }));
    expect(await screen.findByPlaceholderText("Search Codex models…")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "SuperGrok, 1 models" }));
    expect(screen.getByPlaceholderText("Search Grok models…")).toBeTruthy();

    fireEvent.click(screen.getByText("Grok-4"));
    expect(onValueChange).toHaveBeenCalledWith("xai:grok-4");
  });
});
