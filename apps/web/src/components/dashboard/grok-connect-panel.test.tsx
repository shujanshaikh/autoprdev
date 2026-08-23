// @vitest-environment jsdom

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GrokConnectPanel } from "./grok-connect-panel";

const flow = {
  flowId: "flow-1",
  userCode: "ABCD-EFGH",
  verificationUrl: "https://x.ai/device?code=ABCD-EFGH",
  verificationUri: "https://x.ai/device",
  expiresAt: Date.now() + 600_000,
  intervalMs: 60_000,
};

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("open", vi.fn());
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(flow)));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GrokConnectPanel", () => {
  it("resumes a pending authorization after returning to the app", async () => {
    const first = render(
      <GrokConnectPanel active status={{ connected: false }} onStatusChange={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect Grok" }));
    await screen.findByText("Finish in Grok");
    expect(window.localStorage.getItem("autopr:grok-device-flow")).toContain("flow-1");

    first.unmount();
    render(<GrokConnectPanel active status={{ connected: false }} onStatusChange={() => undefined} />);

    await waitFor(() => expect(screen.getByText("Finish in Grok")).toBeTruthy());
    expect(screen.getByText("ABCD-EFGH")).toBeTruthy();
  });
});
