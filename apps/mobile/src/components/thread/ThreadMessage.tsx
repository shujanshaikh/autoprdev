import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Sparkles,
  ToolCase,
} from "lucide-react-native";
import { useMemo, useState, type ReactNode } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useAppTheme } from "../../hooks/useAppTheme";
import { messageParts, type MessagePartView } from "../../lib/messages";

export type ThreadMessageValue = {
  messageId: string;
  role: string;
  parts: unknown[];
  createdAt?: number;
  updatedAt?: number;
};

function displayToolName(name: string) {
  return name.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function timeLabel(timestamp?: number) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(timestamp);
}

function inlineMarkdown(value: string, color: string, muted: string): ReactNode[] {
  const tokens = value.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)]+\))/g);
  return tokens.map((token, index) => {
    if (token.startsWith("`") && token.endsWith("`")) {
      return (
        <Text key={`${token}:${index}`} style={[styles.inlineCode, { backgroundColor: muted }]}>
          {token.slice(1, -1)}
        </Text>
      );
    }
    if (token.startsWith("**") && token.endsWith("**")) {
      return <Text key={`${token}:${index}`} style={styles.bold}>{token.slice(2, -2)}</Text>;
    }
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return (
        <Text
          accessibilityRole="link"
          key={`${token}:${index}`}
          onPress={() => void Linking.openURL(link[2] ?? "")}
          style={[styles.link, { color }]}
        >
          {link[1]}
        </Text>
      );
    }
    return token;
  });
}

function RichMessageText({ value, inverted = false }: { value: string; inverted?: boolean }) {
  const theme = useAppTheme();
  const blocks = useMemo(() => {
    const result: Array<
      | { kind: "code"; value: string; language: string }
      | { kind: "line"; value: string; style: "body" | "heading" | "bullet" | "quote" }
    > = [];
    const lines = value.split("\n");
    let code: string[] | null = null;
    let language = "";
    for (const line of lines) {
      if (line.startsWith("```")) {
        if (code) {
          result.push({ kind: "code", value: code.join("\n"), language });
          code = null;
          language = "";
        } else {
          code = [];
          language = line.slice(3).trim();
        }
        continue;
      }
      if (code) {
        code.push(line);
        continue;
      }
      if (/^#{1,3}\s/.test(line)) {
        result.push({ kind: "line", value: line.replace(/^#{1,3}\s+/, ""), style: "heading" });
      } else if (/^\s*[-*]\s+/.test(line)) {
        result.push({ kind: "line", value: line.replace(/^\s*[-*]\s+/, ""), style: "bullet" });
      } else if (/^>\s?/.test(line)) {
        result.push({ kind: "line", value: line.replace(/^>\s?/, ""), style: "quote" });
      } else {
        result.push({ kind: "line", value: line, style: "body" });
      }
    }
    if (code) result.push({ kind: "code", value: code.join("\n"), language });
    return result;
  }, [value]);
  const textColor = inverted ? theme.accentInk : theme.ink;
  const linkColor = inverted ? theme.accentInk : theme.secondaryInk;

  return (
    <View style={styles.richText}>
      {blocks.map((block, index) => {
        if (block.kind === "code") {
          return (
            <View key={`code:${index}`} style={[styles.codeBlock, { backgroundColor: theme.code, borderColor: theme.codeLine }]}>
              {block.language ? (
                <Text style={[styles.codeLanguage, { color: theme.codeMuted }]}>{block.language}</Text>
              ) : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Text selectable style={[styles.codeText, { color: theme.codeInk }]}>{block.value}</Text>
              </ScrollView>
            </View>
          );
        }
        if (!block.value && block.style === "body") return <View key={`space:${index}`} style={styles.paragraphSpace} />;
        return (
          <View
            key={`line:${index}`}
            style={[
              styles.line,
              block.style === "quote" && [styles.quote, { borderLeftColor: theme.strongLine }],
            ]}
          >
            {block.style === "bullet" ? <Text style={[styles.bullet, { color: textColor }]}>•</Text> : null}
            <Text
              selectable
              style={[
                styles.body,
                { color: textColor },
                block.style === "heading" && styles.heading,
                block.style === "quote" && { color: inverted ? theme.accentInk : theme.muted },
              ]}
            >
              {inlineMarkdown(block.value, linkColor, inverted ? "#FFFFFF2B" : theme.surfaceSoft)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function WorkLog({ parts, live }: { parts: MessagePartView[]; live: boolean }) {
  const theme = useAppTheme();
  const activities = parts.filter((part) => part.kind === "reasoning" || part.kind === "tool");
  const [expanded, setExpanded] = useState(live);
  if (activities.length === 0) return null;

  return (
    <View style={styles.workLog}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={styles.workHeader}
      >
        <Sparkles color={theme.muted} size={13} />
        <Text style={[styles.workTitle, { color: theme.muted }]}>
          {live ? "Working" : `Explored ${activities.length} ${activities.length === 1 ? "step" : "steps"}`}
        </Text>
        {live ? <View style={[styles.liveDot, { backgroundColor: theme.accent }]} /> : null}
        {expanded
          ? <ChevronDown color={theme.faint} size={14} />
          : <ChevronRight color={theme.faint} size={14} />}
      </Pressable>
      {expanded ? (
        <View style={[styles.workItems, { borderLeftColor: theme.line }]}>
          {activities.map((part, index) => (
            <View key={`${part.kind}:${index}`} style={styles.workItem}>
              {part.kind === "tool"
                ? part.state === "output-available"
                  ? <Check color={theme.success} size={13} />
                  : <ToolCase color={theme.muted} size={13} />
                : <Sparkles color={theme.accent} size={13} />}
              <View style={styles.workCopy}>
                <Text style={[styles.workName, { color: theme.ink }]}>
                  {part.kind === "tool" ? displayToolName(part.name) : "Reasoning"}
                </Text>
                {part.kind === "reasoning" || part.summary ? (
                  <Text numberOfLines={expanded ? 8 : 2} style={[styles.workSummary, { color: theme.muted }]}>
                    {part.kind === "reasoning" ? part.text : part.summary}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function ThreadMessage({
  message,
  isLast,
  isLive,
}: {
  message: ThreadMessageValue;
  isLast: boolean;
  isLive: boolean;
}) {
  const theme = useAppTheme();
  const parts = messageParts(message.parts);
  const isUser = message.role === "user";
  const textParts = parts.filter((part) => part.kind === "text");
  const images = parts.filter((part) => part.kind === "file" && part.mediaType.startsWith("image/"));
  const timestamp = timeLabel(message.updatedAt ?? message.createdAt);
  const copyText = textParts.map((part) => part.kind === "text" ? part.text : "").join("\n\n");

  if (isUser) {
    return (
      <View style={styles.userMessage}>
        <View style={[styles.userBubble, { backgroundColor: theme.surfaceSoft, borderColor: theme.line }]}>
          {textParts.map((part, index) => part.kind === "text"
            ? <RichMessageText key={`${message.messageId}:text:${index}`} value={part.text} />
            : null)}
          {images.map((part, index) => part.kind === "file" ? (
            <Image
              key={`${message.messageId}:image:${index}`}
              accessibilityLabel={part.filename ?? "Attached image"}
              source={{ uri: part.url }}
              style={[styles.userImage, { backgroundColor: theme.surface }]}
            />
          ) : null)}
        </View>
        <View style={styles.messageMeta}>
          {timestamp ? <Text style={[styles.timestamp, { color: theme.faint }]}>{timestamp}</Text> : null}
          {copyText ? (
            <Pressable accessibilityLabel="Copy message" onPress={() => void Clipboard.setStringAsync(copyText)} style={styles.copyButton}>
              <Copy color={theme.faint} size={13} />
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.assistantMessage}>
      <View style={styles.assistantLabelRow}>
        <Text style={[styles.assistantLabel, { color: theme.muted }]}>AUTOPR</Text>
        {isLast && isLive ? (
          <>
            <View style={[styles.liveDot, { backgroundColor: theme.accent }]} />
            <Text style={[styles.workingLabel, { color: theme.muted }]}>Working</Text>
          </>
        ) : null}
      </View>
      <WorkLog parts={parts} live={isLast && isLive} />
      {textParts.map((part, index) => part.kind === "text"
        ? <RichMessageText key={`${message.messageId}:text:${index}`} value={part.text} />
        : null)}
      {images.map((part, index) => part.kind === "file" ? (
        <Image
          key={`${message.messageId}:image:${index}`}
          accessibilityLabel={part.filename ?? "Attached image"}
          source={{ uri: part.url }}
          style={[styles.assistantImage, { backgroundColor: theme.surfaceSoft }]}
        />
      ) : null)}
      {(timestamp || copyText) && !(isLast && isLive) ? (
        <View style={[styles.messageMeta, styles.assistantMeta]}>
          {copyText ? (
            <Pressable accessibilityLabel="Copy response" onPress={() => void Clipboard.setStringAsync(copyText)} style={styles.copyButton}>
              <Copy color={theme.faint} size={13} />
            </Pressable>
          ) : null}
          {timestamp ? <Text style={[styles.timestamp, { color: theme.faint }]}>{timestamp}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  richText: { gap: 2 },
  line: { minWidth: 0, flexDirection: "row" },
  body: { flexShrink: 1, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 22 },
  bold: { fontFamily: "Inter_700Bold" },
  heading: { fontFamily: "Inter_600SemiBold", fontSize: 16, lineHeight: 23, marginTop: 5 },
  bullet: { width: 16, fontFamily: "Inter_600SemiBold", fontSize: 14, lineHeight: 22 },
  quote: { borderLeftWidth: 2, paddingLeft: 10, marginVertical: 3 },
  link: { textDecorationLine: "underline" },
  inlineCode: { fontFamily: "monospace", fontSize: 13 },
  paragraphSpace: { height: 7 },
  codeBlock: { borderWidth: 1, borderRadius: 6, padding: 10, marginVertical: 7 },
  codeLanguage: { fontFamily: "Inter_600SemiBold", fontSize: 9, textTransform: "uppercase", marginBottom: 7 },
  codeText: { fontFamily: "monospace", fontSize: 12, lineHeight: 18 },
  userMessage: { alignItems: "flex-end", marginBottom: 20 },
  userBubble: { maxWidth: "88%", borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10, gap: 8 },
  userImage: { width: 220, aspectRatio: 1.35, borderRadius: 8 },
  assistantMessage: { marginBottom: 24, paddingHorizontal: 3, gap: 8 },
  assistantLabelRow: { minHeight: 18, flexDirection: "row", alignItems: "center", gap: 6 },
  assistantLabel: { fontFamily: "Inter_700Bold", fontSize: 9, letterSpacing: 1.2 },
  workingLabel: { fontFamily: "Inter_500Medium", fontSize: 10 },
  liveDot: { width: 6, height: 6, borderRadius: 999 },
  assistantImage: { width: "100%", aspectRatio: 1.4, borderRadius: 10 },
  messageMeta: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: 2, paddingTop: 2 },
  assistantMeta: { justifyContent: "flex-start" },
  timestamp: { fontFamily: "Inter_500Medium", fontSize: 10 },
  copyButton: { width: 28, height: 26, alignItems: "center", justifyContent: "center" },
  workLog: { marginBottom: 2 },
  workHeader: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 6 },
  workTitle: { fontFamily: "Inter_500Medium", fontSize: 11 },
  workItems: { borderLeftWidth: 1, marginLeft: 6, paddingLeft: 13, gap: 10, paddingVertical: 5 },
  workItem: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  workCopy: { flex: 1, minWidth: 0 },
  workName: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  workSummary: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, marginTop: 3 },
});
