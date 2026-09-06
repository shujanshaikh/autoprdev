// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ChatTransportEvent, useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";
import type { ChatStatus, UIMessage } from "ai";
import type { ComponentProps, PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TriggerChatTransport } from "#/lib/trigger-chat-transport";
import type { ThreadMessages } from "./thread-messages";

const mocks = vi.hoisted(() => ({
  chat: {
    messages: [] as UIMessage[],
    status: "ready" as ChatStatus,
    setMessages: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    resumeStream: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    clearError: vi.fn(),
  },
  sessionOptions: vi.fn<(options: Parameters<typeof useTriggerChatTransport>[0]) => void>(),
  taskOptions: vi.fn<(options: ConstructorParameters<typeof TriggerChatTransport>[0]) => void>(),
  sessionTransport: { stopGeneration: vi.fn().mockResolvedValue(undefined) },
  getAccessToken: vi.fn().mockResolvedValue("test-token"),
  mutation: vi.fn(),
}));

vi.mock("@ai-sdk/react", () => ({ useChat: () => mocks.chat }));
vi.mock("@trigger.dev/sdk/chat/react", () => ({
  useTriggerChatTransport: (options: Parameters<typeof useTriggerChatTransport>[0]) => {
    mocks.sessionOptions(options);
    return mocks.sessionTransport;
  },
}));
vi.mock("#/lib/trigger-chat-transport", () => ({
  TriggerChatTransport: class {
    constructor(options: ConstructorParameters<typeof TriggerChatTransport>[0]) {
      mocks.taskOptions(options);
    }
  },
}));
vi.mock("@workos/authkit-tanstack-react-start/client", () => ({
  useAccessToken: () => ({ getAccessToken: mocks.getAccessToken }),
}));
vi.mock("convex/react", () => ({ useMutation: () => mocks.mutation }));
vi.mock("#/lib/thread-git-status-query", () => ({
  useThreadGitStatusQuery: () => ({}),
  resolveThreadBranchLabel: () => undefined,
}));
vi.mock("./thread-messages", () => ({
  ThreadMessages: ({ activeRunStartedAt, onSubmitMessage }: ComponentProps<typeof ThreadMessages>) => (
    <>
      <output data-testid="run-start">{activeRunStartedAt ?? "idle"}</output>
      <button onClick={() => void onSubmitMessage("Continue")}>Send message</button>
    </>
  ),
}));
vi.mock("./thread-computer-preview", () => ({ ThreadComputerPreview: () => null }));
vi.mock("./thread-diff-panel", () => ({ ThreadDiffPanel: () => null }));
vi.mock("./thread-sub-agent-activity", () => ({
  latestSubAgentActivity: () => undefined,
  ThreadSubAgentActivityPanel: () => null,
}));
vi.mock("#/components/agent-model-picker", () => ({ AgentModelPicker: () => null }));
vi.mock("#/components/codex-prompt-connection-line", () => ({ CodexPromptConnectionLine: () => null }));
vi.mock("@/components/ai-elements/tool", () => ({
  isToolDiffPayload: () => false,
  toolSlugFromPart: () => undefined,
}));
vi.mock("./prompt-image-uploads", () => ({
  usePromptImageUploadManager: () => ({}),
  PromptImageAttachments: () => null,
  PromptImageUploadButton: () => null,
}));
vi.mock("@/components/ai-elements/prompt-input", () => {
  const Container = ({ children }: PropsWithChildren) => <div>{children}</div>;
  return {
    PromptInput: Container,
    PromptInputProvider: Container,
    PromptInputBody: Container,
    PromptInputFooter: Container,
    PromptInputHeader: Container,
    PromptInputTools: Container,
    PromptInputTextarea: () => null,
    PromptInputSubmit: ({ onStop }: { onStop: () => void }) => <button onClick={onStop}>Stop</button>,
  };
});

import { ThreadChat } from "./thread-chat";

const props = {
  projectId: "project-1",
  threadId: "thread-1",
  initialMessages: [],
  disabled: false,
  diffPanelOpen: false,
  demoRecordingExperimentEnabled: false,
  gitStatusEnabled: false,
  onDiffPanelOpenChange: () => {},
  onDiffCountChange: () => {},
} satisfies ComponentProps<typeof ThreadChat>;

function emitSessionEvent(event: ChatTransportEvent) {
  act(() => mocks.sessionOptions.mock.lastCall?.[0].onEvent?.(event));
}

function expectRunStart(timestamp: number | "idle") {
  expect(screen.getByTestId("run-start").textContent).toBe(String(timestamp));
}

beforeEach(() => {
  mocks.chat.status = "ready";
  mocks.chat.messages = [];
  vi.spyOn(Date, "now").mockReturnValue(10_000);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ publicAccessToken: "session-token" })));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ThreadChat run timer lifecycle", () => {
  it.each(["ready", "streaming"] as const)("resets a replaced remote task run while chat status stays %s", (status) => {
    mocks.chat.status = status;
    const { rerender } = render(<ThreadChat {...props} currentRunId="run-a" />);
    expectRunStart(10_000);

    vi.mocked(Date.now).mockReturnValue(30_000);
    rerender(<ThreadChat {...props} currentRunId="run-b" />);
    expectRunStart(30_000);

    vi.mocked(Date.now).mockReturnValue(40_000);
    mocks.chat.status = "ready";
    rerender(<ThreadChat {...props} currentRunId="run-b" />);
    expectRunStart(30_000);

    act(() => { void mocks.taskOptions.mock.lastCall?.[0].onChatEnd?.({ chatId: props.threadId, chunkIndex: 0 }); });
    rerender(<ThreadChat {...props} />);
    expectRunStart("idle");
  });

  it("starts consecutive submissions and preserves the start when the task ID arrives", async () => {
    const { rerender } = render(<ThreadChat {...props} />);
    await act(async () => fireEvent.click(screen.getByText("Send message")));
    expectRunStart(10_000);
    expect(mocks.chat.sendMessage).toHaveBeenCalledWith({ text: "Continue" });

    vi.mocked(Date.now).mockReturnValue(15_000);
    act(() => { void mocks.taskOptions.mock.lastCall?.[0].onChatSendMessage?.(
      new Response(null, { headers: { "x-trigger-run-id": "run-a" } }),
      { chatId: props.threadId, trigger: "submit-message", messages: [] },
    ); });
    rerender(<ThreadChat {...props} currentRunId="run-a" />);
    expectRunStart(10_000);

    act(() => { void mocks.taskOptions.mock.lastCall?.[0].onChatEnd?.({ chatId: props.threadId, chunkIndex: 0 }); });
    rerender(<ThreadChat {...props} />);
    expectRunStart("idle");

    vi.mocked(Date.now).mockReturnValue(30_000);
    await act(async () => fireEvent.click(screen.getByText("Send message")));
    expectRunStart(30_000);
  });

  it("resets session turns, preserves reconnects, and clears completion and stop", async () => {
    mocks.chat.status = "streaming";
    await act(async () => {
      render(<ThreadChat {...props} currentRunId="session-run" thread={{ currentRunTransport: "session", isLive: true }} />);
    });
    emitSessionEvent({ type: "message-sent", chatId: props.threadId, source: "submit-message", timestamp: 12_000, durationMs: 0 });
    expectRunStart(12_000);
    emitSessionEvent({ type: "message-sent", chatId: props.threadId, source: "regenerate-message", timestamp: 30_000, durationMs: 0 });
    expectRunStart(30_000);
    emitSessionEvent({ type: "stream-connected", chatId: props.threadId, timestamp: 35_000, resumed: true });
    emitSessionEvent({ type: "first-chunk", chatId: props.threadId, timestamp: 36_000 });
    expectRunStart(30_000);
    emitSessionEvent({ type: "turn-completed", chatId: props.threadId, timestamp: 40_000 });
    expectRunStart("idle");

    emitSessionEvent({ type: "message-sent", chatId: props.threadId, source: "submit-message", timestamp: 50_000, durationMs: 0 });
    expectRunStart(50_000);
    fireEvent.click(screen.getByText("Stop"));
    expectRunStart("idle");
    expect(mocks.sessionTransport.stopGeneration).toHaveBeenCalledWith(props.threadId);
  });
});
