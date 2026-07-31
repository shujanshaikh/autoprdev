import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@autopr/backend/convex/_generated/api";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAction } from "convex/react";
import * as Clipboard from "expo-clipboard";
import {
  Check,
  Copy,
  Eraser,
  Keyboard as KeyboardIcon,
  RefreshCw,
  Send,
  TerminalSquare,
} from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type LayoutChangeEvent,
  type ListRenderItem,
  type PressableStateCallbackType,
  useWindowDimensions,
  View,
} from "react-native";

import { useAppTheme } from "../hooks/useAppTheme";
import type { AppTheme } from "../theme";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Terminal">;
type ConnectionStatus = "connecting" | "connected" | "disconnected";
type TerminalKey =
  | "escape"
  | "ctrl"
  | "tab"
  | "clear"
  | "history-up"
  | "history-down"
  | "interrupt"
  | "insert"
  | "font-down"
  | "font-up";
type TerminalAccessoryKey = {
  key: string;
  label: string;
  action: TerminalKey;
  value?: string;
};

const FONT_SIZE_KEY = "autopr.mobile.terminal-font-size";
const DEFAULT_FONT_SIZE = 12;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 17;
const MAX_OUTPUT_LENGTH = 120_000;

const accessoryKeys: ReadonlyArray<TerminalAccessoryKey> = [
  { key: "escape", label: "esc", action: "escape" },
  { key: "ctrl", label: "ctrl", action: "ctrl" },
  { key: "tab", label: "tab", action: "tab" },
  { key: "interrupt", label: "^C", action: "interrupt" },
  { key: "clear", label: "clear", action: "clear" },
  { key: "history-up", label: "↑", action: "history-up" },
  { key: "history-down", label: "↓", action: "history-down" },
  { key: "tilde", label: "~", action: "insert", value: "~" },
  { key: "pipe", label: "|", action: "insert", value: "|" },
  { key: "slash", label: "/", action: "insert", value: "/" },
  { key: "dash", label: "-", action: "insert", value: "-" },
  { key: "font-down", label: "A−", action: "font-down" },
  { key: "font-up", label: "A+", action: "font-up" },
];

const AccessoryKeyButton = memo(function AccessoryKeyButton({
  item,
  active,
  disabled,
  theme,
  onPress,
}: {
  item: TerminalAccessoryKey;
  active: boolean;
  disabled: boolean;
  theme: AppTheme;
  onPress: (action: TerminalKey, value?: string) => void;
}) {
  const handlePress = useCallback(
    () => onPress(item.action, item.value),
    [item.action, item.value, onPress],
  );
  const accessibilityState = useMemo(
    () => ({ disabled, selected: active }),
    [active, disabled],
  );
  const buttonStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.keyButton,
      {
        backgroundColor: active ? theme.accentSoft : theme.surfaceSoft,
        borderColor: active ? theme.accentOn : theme.codeLine,
        opacity: disabled ? 0.3 : pressed ? 0.62 : 1,
      },
    ],
    [active, disabled, theme.accentOn, theme.accentSoft, theme.codeLine, theme.surfaceSoft],
  );
  const textStyle = useMemo(
    () => [styles.keyText, { color: active ? theme.accentOn : theme.codeInk }],
    [active, theme.accentOn, theme.codeInk],
  );

  return (
    <Pressable
      accessibilityLabel={`${item.label} terminal key`}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      disabled={disabled}
      onPress={handlePress}
      style={buttonStyle}
    >
      <Text style={textStyle}>{item.label}</Text>
    </Pressable>
  );
});

function accessoryKeyExtractor(item: TerminalAccessoryKey) {
  return item.key;
}

function stripAnsi(value: string) {
  // Xterm interprets these sequences on web. The native client retains a
  // readable scrollback buffer while preserving the same PTY byte stream.
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B(?:[@-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .replace(/\r(?!\n)/g, "\n");
}

async function terminalText(data: unknown) {
  if (typeof data === "string") {
    try {
      const message = JSON.parse(data) as { type?: unknown };
      if (message.type === "control") return "";
    } catch {
      // Raw shell output is expected to be plain text.
    }
    return data;
  }
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  if (typeof Blob !== "undefined" && data instanceof Blob) return await data.text();
  return "";
}

function terminalSize(width: number, height: number, fontSize: number) {
  const cellWidth = fontSize * 0.62;
  const cellHeight = fontSize * 1.42;
  return {
    cols: Math.max(32, Math.min(200, Math.floor((width - 24) / cellWidth))),
    rows: Math.max(8, Math.min(100, Math.floor((height - 20) / cellHeight))),
  };
}

function applyCtrlModifier(input: string) {
  const first = input[0];
  if (!first) return input;
  const lower = first.toLowerCase();
  if (lower >= "a" && lower <= "z") {
    return `${String.fromCharCode(lower.charCodeAt(0) - 96)}${input.slice(1)}`;
  }
  if (first === "[") return `\u001b${input.slice(1)}`;
  if (first === "\\") return `\u001c${input.slice(1)}`;
  if (first === "]") return `\u001d${input.slice(1)}`;
  return input;
}

function clampFontSize(value: number) {
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(value)));
}

export function TerminalScreen({ route }: Props) {
  const { projectId, threadId, title } = route.params;
  const theme = useAppTheme();
  const getTerminal = useAction(api.projectActions.getPtyTerminal);
  const resizeTerminal = useAction(api.projectActions.resizePtyTerminal);
  const killTerminal = useAction(api.projectActions.killPtyTerminal);
  const dimensions = useWindowDimensions();
  const initialSizeRef = useRef<ReturnType<typeof terminalSize> | null>(null);
  initialSizeRef.current ??= terminalSize(
    dimensions.width,
    dimensions.height - 160,
    DEFAULT_FONT_SIZE,
  );
  const initialSize = initialSizeRef.current;
  const [output, setOutput] = useState("");
  const [command, setCommand] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [surfaceSize, setSurfaceSize] = useState<{ width: number; height: number } | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [pendingCtrl, setPendingCtrl] = useState(false);
  const [copied, setCopied] = useState(false);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const followOutputRef = useRef(true);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandHistoryRef = useRef<string[]>([]);
  const historyDraftRef = useRef("");
  const historyIndexRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(FONT_SIZE_KEY).then((stored) => {
      if (!active || !stored) return;
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) setFontSize(clampFontSize(parsed));
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let activeSessionId: string | null = null;
    let wakeTimer: ReturnType<typeof setTimeout> | null = null;
    let receivedOutput = false;

    const start = async () => {
      setStatus("connecting");
      setError(null);
      setSessionId(null);
      const terminal = await getTerminal({
        projectId,
        threadId,
        ...initialSize,
      });
      if (!active) {
        await killTerminal({ projectId, sessionId: terminal.sessionId }).catch(() => undefined);
        return;
      }
      activeSessionId = terminal.sessionId;
      sessionRef.current = activeSessionId;
      setSessionId(activeSessionId);
      socket = new WebSocket(terminal.websocketUrl, "X-Daytona-SDK-Version~");
      socketRef.current = socket;
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        if (!active || !socket) return;
        setStatus("connected");
        setError(null);
        wakeTimer = setTimeout(() => {
          if (!receivedOutput && socket?.readyState === WebSocket.OPEN) {
            socket.send(new TextEncoder().encode("\r"));
          }
        }, 250);
      };
      socket.onmessage = (event) => {
        void terminalText(event.data).then((text) => {
          if (!active || !text) return;
          receivedOutput = true;
          if (wakeTimer) clearTimeout(wakeTimer);
          setError(null);
          setOutput((current) => `${current}${stripAnsi(text)}`.slice(-MAX_OUTPUT_LENGTH));
          if (followOutputRef.current) {
            requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
          }
        });
      };
      socket.onerror = () => {
        if (active) setError("Terminal connection failed.");
      };
      socket.onclose = () => {
        if (!active) return;
        if (wakeTimer) clearTimeout(wakeTimer);
        setStatus("disconnected");
        setError("Terminal disconnected. Reconnect to continue.");
      };
    };

    void start().catch((cause) => {
      if (!active) return;
      setStatus("disconnected");
      setError(cause instanceof Error ? cause.message : "Could not start the terminal.");
    });

    return () => {
      active = false;
      if (wakeTimer) clearTimeout(wakeTimer);
      socket?.close();
      socketRef.current = null;
      sessionRef.current = null;
      if (activeSessionId) {
        void killTerminal({ projectId, sessionId: activeSessionId }).catch(() => undefined);
      }
    };
  }, [attempt, getTerminal, initialSize, killTerminal, projectId, threadId]);

  useEffect(() => {
    const activeSessionId = sessionRef.current;
    if (status !== "connected" || !activeSessionId) return;
    const measured = surfaceSize ?? {
      width: dimensions.width,
      height: dimensions.height - 160,
    };
    const size = terminalSize(measured.width, measured.height, fontSize);
    const timer = setTimeout(() => {
      void resizeTerminal({
        projectId,
        sessionId: activeSessionId,
        ...size,
      }).catch(() => undefined);
    }, 160);
    return () => clearTimeout(timer);
  }, [
    dimensions.height,
    dimensions.width,
    fontSize,
    projectId,
    resizeTerminal,
    status,
    surfaceSize,
  ]);

  const writeInput = useCallback((value: string) => {
    const socket = socketRef.current;
    if (!value || socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(new TextEncoder().encode(value));
    return true;
  }, []);

  const reconnect = useCallback(() => {
    setPendingCtrl(false);
    setOutput((current) => current
      ? `${current.trimEnd()}\n\n── reconnecting ──\n`
      : current);
    setAttempt((value) => value + 1);
  }, []);

  const clearTerminal = useCallback(() => {
    setOutput("");
    setAwayFromLatest(false);
    followOutputRef.current = true;
    writeInput("\u000c");
  }, [writeInput]);

  const updateFontSize = useCallback((change: number) => {
    const next = clampFontSize(fontSize + change);
    setFontSize(next);
    void AsyncStorage.setItem(FONT_SIZE_KEY, String(next)).catch(() => undefined);
  }, [fontSize]);

  const moveThroughHistory = useCallback((direction: -1 | 1) => {
    const history = commandHistoryRef.current;
    if (history.length === 0) return;
    const current = historyIndexRef.current;
    if (current === null) {
      if (direction === 1) return;
      historyDraftRef.current = command;
      const next = history.length - 1;
      historyIndexRef.current = next;
      setCommand(history[next] ?? "");
      return;
    }
    const next = current + direction;
    if (next >= history.length) {
      historyIndexRef.current = null;
      setCommand(historyDraftRef.current);
      return;
    }
    const bounded = Math.max(0, next);
    historyIndexRef.current = bounded;
    setCommand(history[bounded] ?? "");
  }, [command]);

  const runCommand = useCallback(() => {
    if (status !== "connected") return;
    if (!command) {
      writeInput("\r");
      return;
    }

    const value = command;
    if (pendingCtrl) {
      writeInput(applyCtrlModifier(value));
      setPendingCtrl(false);
    } else {
      writeInput(`${value}\r`);
      const previous = commandHistoryRef.current;
      if (previous[previous.length - 1] !== value) {
        commandHistoryRef.current = [...previous.slice(-49), value];
      }
    }
    setCommand("");
    historyIndexRef.current = null;
    historyDraftRef.current = "";
  }, [command, pendingCtrl, status, writeInput]);

  const handleAccessoryKey = useCallback((action: TerminalKey, value?: string) => {
    if (action === "ctrl") {
      setPendingCtrl((current) => !current);
      inputRef.current?.focus();
      return;
    }
    if (action === "clear") {
      setPendingCtrl(false);
      clearTerminal();
      return;
    }
    if (action === "font-down" || action === "font-up") {
      updateFontSize(action === "font-up" ? 1 : -1);
      return;
    }
    if (action === "history-up" || action === "history-down") {
      moveThroughHistory(action === "history-up" ? -1 : 1);
      inputRef.current?.focus();
      return;
    }
    if (action === "insert") {
      setCommand((current) => `${current}${value ?? ""}`);
      inputRef.current?.focus();
      return;
    }
    if (action === "tab") {
      setCommand((current) => `${current}\t`);
      inputRef.current?.focus();
      return;
    }

    setPendingCtrl(false);
    if (action === "escape") writeInput("\u001b");
    if (action === "interrupt") {
      writeInput("\u0003");
      setCommand("");
      historyIndexRef.current = null;
    }
  }, [clearTerminal, moveThroughHistory, updateFontSize, writeInput]);

  const copyOutput = useCallback(() => {
    if (!output) return;
    void Clipboard.setStringAsync(output);
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1_500);
  }, [output]);

  const handleSurfaceLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSurfaceSize((current) =>
      current?.width === width && current.height === height ? current : { width, height });
  }, []);

  const handleOutputScroll = useCallback((event: {
    nativeEvent: {
      contentSize: { height: number };
      layoutMeasurement: { height: number };
      contentOffset: { y: number };
    };
  }) => {
    const { contentSize, layoutMeasurement, contentOffset } = event.nativeEvent;
    const away = contentSize.height - layoutMeasurement.height - contentOffset.y > 80;
    followOutputRef.current = !away;
    setAwayFromLatest(away);
  }, []);

  const jumpToLatest = useCallback(() => {
    followOutputRef.current = true;
    setAwayFromLatest(false);
    scrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  const statusColor = status === "connected"
    ? theme.success
    : status === "connecting"
      ? theme.warning
      : theme.danger;
  const statusLabel = status === "connected"
    ? "Ready"
    : status === "connecting"
      ? "Connecting"
      : "Offline";
  const renderAccessoryKey = useCallback<ListRenderItem<TerminalAccessoryKey>>(
    ({ item }) => {
      const active = item.action === "ctrl" && pendingCtrl;
      const disabled =
        (item.action === "font-down" && fontSize <= MIN_FONT_SIZE)
        || (item.action === "font-up" && fontSize >= MAX_FONT_SIZE)
        || (status !== "connected"
          && !["font-down", "font-up", "insert"].includes(item.action));
      return (
        <AccessoryKeyButton
          active={active}
          disabled={disabled}
          item={item}
          onPress={handleAccessoryKey}
          theme={theme}
        />
      );
    },
    [fontSize, handleAccessoryKey, pendingCtrl, status, theme],
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
      style={[styles.screen, { backgroundColor: theme.code }]}
    >
      <View style={[styles.sessionBar, { borderBottomColor: theme.codeLine }]}>
        <View style={[styles.terminalMark, { backgroundColor: theme.successSoft }]}>
          <TerminalSquare color={statusColor} size={16} strokeWidth={2} />
        </View>
        <View style={styles.sessionCopy}>
          <Text numberOfLines={1} style={[styles.sessionTitle, { color: theme.codeInk }]}>
            {title || "Workspace shell"}
          </Text>
          <View style={styles.sessionMeta}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.sessionSubtitle, { color: theme.codeMuted }]}>
              {statusLabel}
              {sessionId ? ` · ${sessionId.slice(0, 8)}` : " · Daytona PTY"}
            </Text>
          </View>
        </View>
        {status === "connecting" ? <ActivityIndicator color={theme.accentOn} size="small" /> : null}
        <Pressable
          accessibilityLabel={copied ? "Terminal output copied" : "Copy terminal output"}
          disabled={!output}
          onPress={copyOutput}
          style={({ pressed }) => [
            styles.headerButton,
            { opacity: !output ? 0.28 : pressed ? 0.55 : 1 },
          ]}
        >
          {copied
            ? <Check color={theme.success} size={17} />
            : <Copy color={theme.codeMuted} size={16} />}
        </Pressable>
        <Pressable
          accessibilityLabel="Clear terminal"
          onPress={clearTerminal}
          style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.55 : 1 }]}
        >
          <Eraser color={theme.codeMuted} size={17} />
        </Pressable>
      </View>

      {error ? (
        <View
          accessibilityRole="alert"
          style={[
            styles.errorBar,
            { backgroundColor: theme.dangerSoft, borderBottomColor: theme.danger },
          ]}
        >
          <Text numberOfLines={2} style={[styles.errorText, { color: theme.danger }]}>
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={reconnect}
            style={({ pressed }) => [styles.reconnectButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <RefreshCw color={theme.danger} size={13} />
            <Text style={[styles.reconnectText, { color: theme.danger }]}>Reconnect</Text>
          </Pressable>
        </View>
      ) : null}

      <View onLayout={handleSurfaceLayout} style={styles.surface}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.output}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => {
            if (followOutputRef.current) scrollRef.current?.scrollToEnd({ animated: false });
          }}
          onScroll={handleOutputScroll}
          scrollEventThrottle={32}
          showsVerticalScrollIndicator={false}
        >
          <Text
            selectable
            style={[
              styles.outputText,
              {
                color: theme.codeInk,
                fontSize,
                lineHeight: Math.round(fontSize * 1.42),
              },
            ]}
          >
            {output || (status === "connected"
              ? "Shell ready. Enter a command below.\n"
              : "Opening a shell in this workspace…\n")}
          </Text>
        </ScrollView>

        {awayFromLatest ? (
          <Pressable
            accessibilityLabel="Jump to latest terminal output"
            onPress={jumpToLatest}
            style={({ pressed }) => [
              styles.latestButton,
              {
                backgroundColor: theme.surfaceRaised,
                borderColor: theme.codeLine,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <Text style={[styles.latestText, { color: theme.ink }]}>Latest ↓</Text>
          </Pressable>
        ) : null}
      </View>

      {keyboardVisible ? (
        <View style={[styles.accessory, { borderTopColor: theme.codeLine }]}>
          <FlatList
            contentContainerStyle={styles.accessoryContent}
            data={accessoryKeys}
            horizontal
            keyboardShouldPersistTaps="always"
            keyExtractor={accessoryKeyExtractor}
            renderItem={renderAccessoryKey}
            showsHorizontalScrollIndicator={false}
          />
        </View>
      ) : null}

      <View style={[styles.commandDock, { borderTopColor: theme.codeLine }]}>
        <Pressable
          accessibilityLabel={keyboardVisible ? "Dismiss keyboard" : "Show keyboard"}
          onPress={() => {
            if (keyboardVisible) Keyboard.dismiss();
            else inputRef.current?.focus();
          }}
          style={({ pressed }) => [styles.keyboardButton, { opacity: pressed ? 0.55 : 1 }]}
        >
          <KeyboardIcon color={theme.codeMuted} size={18} />
        </Pressable>
        <View
          style={[
            styles.commandField,
            {
              backgroundColor: theme.surfaceSoft,
              borderColor: pendingCtrl ? theme.accentOn : theme.codeLine,
            },
          ]}
        >
          <Text style={[styles.promptMark, { color: pendingCtrl ? theme.accentOn : theme.success }]}>
            {pendingCtrl ? "^" : "$"}
          </Text>
          <TextInput
            ref={inputRef}
            autoCapitalize="none"
            autoCorrect={false}
            editable={status === "connected"}
            keyboardAppearance={theme.mode}
            onChangeText={(value) => {
              setCommand(value);
              historyIndexRef.current = null;
            }}
            onSubmitEditing={runCommand}
            placeholder={status === "connected" ? "Type a command" : "Waiting for terminal"}
            placeholderTextColor={theme.codeMuted}
            returnKeyType="send"
            selectionColor={theme.accent}
            spellCheck={false}
            value={command}
            style={[styles.input, { color: theme.codeInk }]}
          />
        </View>
        <Pressable
          accessibilityLabel="Run command"
          accessibilityRole="button"
          accessibilityState={{ disabled: status !== "connected" }}
          disabled={status !== "connected"}
          onPress={runCommand}
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: theme.accent,
              opacity: status !== "connected" ? 0.3 : pressed ? 0.72 : 1,
            },
          ]}
        >
          <Send color={theme.accentInk} size={16} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const mono = Platform.select({ ios: "Menlo", android: "monospace" });

const styles = StyleSheet.create({
  screen: { flex: 1 },
  sessionBar: {
    minHeight: 58,
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  terminalMark: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  sessionCopy: { minWidth: 0, flex: 1 },
  sessionTitle: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  sessionMeta: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  sessionSubtitle: {
    flexShrink: 1,
    fontFamily: mono,
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 0.35,
  },
  headerButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  errorBar: {
    minHeight: 43,
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  errorText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 10, lineHeight: 14 },
  reconnectButton: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 7,
  },
  reconnectText: { fontFamily: "Inter_700Bold", fontSize: 10 },
  surface: { flex: 1 },
  output: { flexGrow: 1, paddingHorizontal: 13, paddingTop: 12, paddingBottom: 28 },
  outputText: { fontFamily: mono, fontWeight: "500" },
  latestButton: {
    position: "absolute",
    right: 12,
    bottom: 10,
    minHeight: 32,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  latestText: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
  accessory: { minHeight: 47, borderTopWidth: 1, justifyContent: "center" },
  accessoryContent: { paddingHorizontal: 8, paddingVertical: 6, gap: 6 },
  keyButton: {
    minWidth: 42,
    height: 34,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  keyText: {
    fontFamily: mono,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  commandDock: {
    minHeight: 62,
    borderTopWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  keyboardButton: { width: 32, height: 40, alignItems: "center", justifyContent: "center" },
  commandField: {
    minWidth: 0,
    flex: 1,
    height: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  promptMark: { fontFamily: mono, fontSize: 13, fontWeight: "700" },
  input: { minWidth: 0, flex: 1, paddingVertical: 0, fontFamily: mono, fontSize: 12 },
  send: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});
