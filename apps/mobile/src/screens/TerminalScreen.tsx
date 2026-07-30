import { api } from "@autopr/backend/convex/_generated/api";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAction } from "convex/react";
import { Eraser, RefreshCw, Send, TerminalSquare } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { ErrorNotice } from "../components/ui";
import { useAppTheme } from "../hooks/useAppTheme";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Terminal">;

function stripAnsi(value: string) {
  // Terminal control sequences are interpreted by xterm on web. Mobile keeps a
  // readable command log and strips display-only cursor/color instructions.
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

function terminalSize(width: number, height: number) {
  return {
    cols: Math.max(40, Math.min(160, Math.floor((width - 26) / 7))),
    rows: Math.max(14, Math.min(60, Math.floor((height - 118) / 17))),
  };
}

export function TerminalScreen({ route }: Props) {
  const { projectId, threadId } = route.params;
  const theme = useAppTheme();
  const getTerminal = useAction(api.projectActions.getPtyTerminal);
  const resizeTerminal = useAction(api.projectActions.resizePtyTerminal);
  const killTerminal = useAction(api.projectActions.killPtyTerminal);
  const dimensions = useWindowDimensions();
  const initialSizeRef = useRef<ReturnType<typeof terminalSize> | null>(null);
  initialSizeRef.current ??= terminalSize(dimensions.width, dimensions.height);
  const initialSize = initialSizeRef.current;
  const [output, setOutput] = useState("");
  const [command, setCommand] = useState("");
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let sessionId: string | null = null;
    const start = async () => {
      setStatus("connecting");
      setError(null);
      const terminal = await getTerminal({
        projectId,
        threadId,
        ...initialSize,
      });
      if (!active) {
        await killTerminal({ projectId, sessionId: terminal.sessionId }).catch(() => undefined);
        return;
      }
      sessionId = terminal.sessionId;
      sessionRef.current = sessionId;
      socket = new WebSocket(terminal.websocketUrl, "X-Daytona-SDK-Version~");
      socketRef.current = socket;
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        if (!active || !socket) return;
        setStatus("connected");
        socket.send(new TextEncoder().encode("\r"));
      };
      socket.onmessage = (event) => {
        void terminalText(event.data).then((text) => {
          if (!active || !text) return;
          setOutput((current) => `${current}${stripAnsi(text)}`.slice(-120_000));
          requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
        });
      };
      socket.onerror = () => {
        if (active) setError("Terminal connection failed.");
      };
      socket.onclose = () => {
        if (active) setStatus("disconnected");
      };
    };
    void start().catch((cause) => {
      if (!active) return;
      setStatus("disconnected");
      setError(cause instanceof Error ? cause.message : "Could not start the terminal.");
    });
    return () => {
      active = false;
      socket?.close();
      socketRef.current = null;
      sessionRef.current = null;
      if (sessionId) void killTerminal({ projectId, sessionId }).catch(() => undefined);
    };
  }, [attempt, getTerminal, initialSize, killTerminal, projectId, threadId]);

  useEffect(() => {
    const sessionId = sessionRef.current;
    if (status !== "connected" || !sessionId) return;
    const size = terminalSize(dimensions.width, dimensions.height);
    const timer = setTimeout(() => {
      void resizeTerminal({ projectId, sessionId, ...size }).catch(() => undefined);
    }, 180);
    return () => clearTimeout(timer);
  }, [dimensions.height, dimensions.width, projectId, resizeTerminal, status]);

  const send = () => {
    const value = command.trim();
    const socket = socketRef.current;
    if (!value || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(new TextEncoder().encode(`${value}\r`));
    setCommand("");
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
      style={[styles.screen, { backgroundColor: theme.code }]}
    >
      <View style={[styles.statusBar, { borderBottomColor: theme.codeLine }]}>
        <View style={styles.statusCopy}>
          <TerminalSquare color={status === "connected" ? theme.success : theme.codeMuted} size={16} />
          <Text style={[styles.cwd, { color: theme.codeMuted }]}>
            {status === "connecting" ? "Starting shell…" : status}
          </Text>
        </View>
        {status === "connecting" ? <ActivityIndicator color={theme.accent} size="small" /> : null}
        <Pressable accessibilityLabel="Clear terminal" onPress={() => setOutput("")} style={styles.iconButton}>
          <Eraser color={theme.codeMuted} size={17} />
        </Pressable>
        {status === "disconnected" ? (
          <Pressable accessibilityLabel="Reconnect terminal" onPress={() => setAttempt((value) => value + 1)} style={styles.iconButton}>
            <RefreshCw color={theme.codeMuted} size={17} />
          </Pressable>
        ) : null}
      </View>
      {error ? <View style={styles.error}><ErrorNotice message={error} /></View> : null}
      <ScrollView ref={scrollRef} contentContainerStyle={styles.output}>
        <Text selectable style={[styles.outputText, { color: theme.codeInk }]}>
          {output || "A shell will appear here when the workspace is ready.\n"}
        </Text>
      </ScrollView>
      <View style={[styles.inputRow, { borderTopColor: theme.codeLine }]}>
        <Text style={[styles.promptMark, { color: theme.success }]}>$</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          editable={status === "connected"}
          onSubmitEditing={send}
          placeholder="Enter command"
          placeholderTextColor={theme.codeMuted}
          returnKeyType="send"
          value={command}
          onChangeText={setCommand}
          style={[styles.input, { color: theme.codeInk }]}
        />
        <Pressable accessibilityLabel="Run command" onPress={send} style={[styles.send, { backgroundColor: theme.accent }]}>
          <Send color={theme.accentInk} size={16} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const mono = Platform.select({ ios: "Menlo", android: "monospace" });

const styles = StyleSheet.create({
  screen: { flex: 1 },
  statusBar: { minHeight: 46, borderBottomWidth: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  statusCopy: { flex: 1, flexDirection: "row", alignItems: "center", gap: 7 },
  cwd: { fontFamily: mono, fontSize: 10, textTransform: "capitalize" },
  iconButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  error: { padding: 10 },
  output: { padding: 13, paddingBottom: 24 },
  outputText: { fontFamily: mono, fontSize: 11, lineHeight: 17 },
  inputRow: { minHeight: 56, borderTopWidth: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  promptMark: { fontFamily: mono, fontSize: 14, fontWeight: "700" },
  input: { flex: 1, fontFamily: mono, fontSize: 12 },
  send: { width: 35, height: 35, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});
