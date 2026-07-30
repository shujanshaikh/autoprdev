import { api } from "@autopr/backend/convex/_generated/api";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAction } from "convex/react";
import { Eraser, RefreshCw, Send, TerminalSquare } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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

export function TerminalScreen({ route }: Props) {
  const { projectId, threadId } = route.params;
  const theme = useAppTheme();
  const getTerminal = useAction(api.projectActions.getPtyTerminal);
  const killTerminal = useAction(api.projectActions.killPtyTerminal);
  const [output, setOutput] = useState("");
  const [command, setCommand] = useState("");
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    const terminal = await getTerminal({ projectId, threadId, cols: 100, rows: 32 });
    sessionRef.current = terminal.sessionId;
    const socket = new WebSocket(terminal.websocketUrl, "X-Daytona-SDK-Version~");
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;
    socket.onopen = () => {
      setStatus("connected");
      socket.send(new TextEncoder().encode("\r"));
    };
    socket.onmessage = (event) => {
      void terminalText(event.data).then((text) => {
        if (!text) return;
        setOutput((current) => `${current}${stripAnsi(text)}`.slice(-120_000));
        requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
      });
    };
    socket.onerror = () => setError("Terminal connection failed.");
    socket.onclose = () => setStatus("disconnected");
  }, [getTerminal, projectId, threadId]);

  useEffect(() => {
    let active = true;
    void connect().catch((cause) => {
      if (active) {
        setStatus("disconnected");
        setError(cause instanceof Error ? cause.message : "Could not start the terminal.");
      }
    });
    return () => {
      active = false;
      socketRef.current?.close();
      const sessionId = sessionRef.current;
      if (sessionId) void killTerminal({ projectId, sessionId }).catch(() => undefined);
    };
  }, [attempt, connect, killTerminal, projectId]);

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
