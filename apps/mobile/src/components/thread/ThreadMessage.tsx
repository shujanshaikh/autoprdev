import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  ExternalLink,
  FileText,
  Play,
  Sparkles,
  ToolCase,
  Video,
} from "lucide-react-native";
import { useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { webRequest } from "../../api/web";
import { useAuth } from "../../auth/AuthProvider";
import { useAppTheme } from "../../hooks/useAppTheme";
import { messageParts, type MessagePartView } from "../../lib/messages";

export type ThreadMessageValue = {
  messageId: string;
  role: string;
  parts: unknown[];
  metadata?: unknown;
  createdAt?: number;
  updatedAt?: number;
};

const messageTimeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function keyed<T>(items: readonly T[], baseKey: (item: T) => string) {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = baseKey(item);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return { item, key: `${base}:${occurrence}` };
  });
}

function displayToolName(name: string) {
  return name.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function timeLabel(timestamp?: number) {
  if (!timestamp) return "";
  return messageTimeFormatter.format(timestamp);
}

function runSummary(metadata: unknown) {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return "";
  const value = metadata as Record<string, unknown>;
  const usage = typeof value.usage === "object" && value.usage !== null && !Array.isArray(value.usage)
    ? value.usage as Record<string, unknown>
    : null;
  const run = typeof value.run === "object" && value.run !== null && !Array.isArray(value.run)
    ? value.run as Record<string, unknown>
    : null;
  const cost = usage && typeof usage.cost === "object" && usage.cost !== null && !Array.isArray(usage.cost)
    ? usage.cost as Record<string, unknown>
    : null;
  const totalTokens = typeof usage?.totalTokens === "number" ? usage.totalTokens : undefined;
  const duration = typeof run?.durationSeconds === "number" ? run.durationSeconds : undefined;
  const totalCost = typeof cost?.total === "number" ? cost.total : undefined;
  const details: string[] = [];
  if (duration !== undefined) {
    details.push(duration < 60 ? `${Math.round(duration)}s` : `${Math.floor(duration / 60)}m ${Math.round(duration) % 60}s`);
  }
  if (totalTokens !== undefined) {
    details.push(totalTokens >= 1_000 ? `${(totalTokens / 1_000).toFixed(totalTokens >= 100_000 ? 0 : 1)}k tokens` : `${totalTokens} tokens`);
  }
  if (totalCost !== undefined && totalCost > 0) {
    details.push(totalCost < 0.0001 ? "<$0.0001" : `$${totalCost.toFixed(totalCost < 1 ? 4 : 2)}`);
  }
  return details.join(" · ");
}

function inlineMarkdown(value: string, color: string, muted: string): ReactNode[] {
  const tokens = value.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*|\[[^\]\n]+\]\([^)]+\))/g);
  return keyed(tokens, (token) => token).map(({ item: token, key }) => {
    if (token.startsWith("`") && token.endsWith("`")) {
      return (
        <Text key={key} style={[styles.inlineCode, { backgroundColor: muted }]}>
          {token.slice(1, -1)}
        </Text>
      );
    }
    if (token.startsWith("**") && token.endsWith("**")) {
      return <Text key={key} style={styles.bold}>{token.slice(2, -2)}</Text>;
    }
    if (token.startsWith("~~") && token.endsWith("~~")) {
      return <Text key={key} style={styles.strikethrough}>{token.slice(2, -2)}</Text>;
    }
    if (token.startsWith("*") && token.endsWith("*")) {
      return <Text key={key} style={styles.italic}>{token.slice(1, -1)}</Text>;
    }
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return (
        <Text
          accessibilityRole="link"
          key={key}
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
      | {
          kind: "line";
          value: string;
          style: "body" | "heading" | "bullet" | "numbered" | "quote";
          marker?: string;
        }
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
      } else if (/^\s*\d+\.\s+/.test(line)) {
        const marker = line.match(/^\s*(\d+\.)\s+/)?.[1] ?? "1.";
        result.push({ kind: "line", value: line.replace(/^\s*\d+\.\s+/, ""), style: "numbered", marker });
      } else if (/^\s*[-*]\s+\[[ xX]\]\s+/.test(line)) {
        const checked = /^\s*[-*]\s+\[[xX]\]/.test(line);
        result.push({
          kind: "line",
          value: line.replace(/^\s*[-*]\s+\[[ xX]\]\s+/, ""),
          style: "bullet",
          marker: checked ? "☑" : "☐",
        });
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
  const linkColor = inverted
    ? theme.accentInk
    : theme.mode === "light" ? theme.secondary : theme.secondaryInk;

  return (
    <View style={styles.richText}>
      {keyed(blocks, (block) => `${block.kind}:${block.value}:${block.kind === "code" ? block.language : block.style}`).map(({ item: block, key }) => {
        if (block.kind === "code") {
          return (
            <View key={key} style={[styles.codeBlock, { backgroundColor: theme.code, borderColor: theme.codeLine }]}>
              {block.language ? (
                <Text style={[styles.codeLanguage, { color: theme.codeMuted }]}>{block.language}</Text>
              ) : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Text selectable style={[styles.codeText, { color: theme.codeInk }]}>{block.value}</Text>
              </ScrollView>
            </View>
          );
        }
        if (!block.value && block.style === "body") return <View key={key} style={styles.paragraphSpace} />;
        return (
          <View
            key={key}
            style={[
              styles.line,
              block.style === "quote" && [styles.quote, { borderLeftColor: theme.strongLine }],
            ]}
          >
            {block.style === "bullet" || block.style === "numbered" ? (
              <Text style={[styles.bullet, { color: textColor }]}>
                {block.marker ?? "•"}
              </Text>
            ) : null}
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

function WorkLogItem({
  part,
}: {
  part: Extract<MessagePartView, { kind: "reasoning" | "tool" }>;
}) {
  const theme = useAppTheme();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const canExpand = part.kind === "tool" && Boolean(part.details);
  return (
    <View style={styles.workItem}>
      {part.kind === "tool"
        ? part.failed
          ? <CircleAlert color={theme.danger} size={13} />
          : part.state === "output-available"
            ? <Check color={theme.success} size={13} />
            : <ToolCase color={theme.muted} size={13} />
        : <Sparkles color={theme.accentOn} size={13} />}
      <View style={styles.workCopy}>
        <Pressable
          accessibilityRole={canExpand ? "button" : undefined}
          accessibilityState={canExpand ? { expanded: detailsOpen } : undefined}
          disabled={!canExpand}
          onPress={() => setDetailsOpen((value) => !value)}
          style={styles.workItemHeading}
        >
          <Text style={[styles.workName, { color: theme.ink }]}>
            {part.kind === "tool" ? displayToolName(part.name) : "Reasoning"}
          </Text>
          {canExpand
            ? detailsOpen
              ? <ChevronDown color={theme.faint} size={13} />
              : <ChevronRight color={theme.faint} size={13} />
            : null}
        </Pressable>
        {part.kind === "reasoning" || part.summary ? (
          <Text style={[
            styles.workSummary,
            { color: part.kind === "tool" && part.failed ? theme.danger : theme.muted },
          ]}>
            {part.kind === "reasoning" ? part.text : part.summary}
          </Text>
        ) : null}
        {part.kind === "tool" && part.details && detailsOpen ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text
              selectable
              style={[styles.toolDetails, { color: theme.codeMuted, backgroundColor: theme.code }]}
            >
              {part.details}
            </Text>
          </ScrollView>
        ) : null}
      </View>
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
        {live ? <View style={[styles.liveDot, { backgroundColor: theme.accentOn }]} /> : null}
        {expanded
          ? <ChevronDown color={theme.faint} size={14} />
          : <ChevronRight color={theme.faint} size={14} />}
      </Pressable>
      {expanded ? (
        <View style={[styles.workItems, { borderLeftColor: theme.line }]}>
          {keyed(activities, (part) => part.kind === "reasoning"
            ? `reasoning:${part.text}`
            : `tool:${part.name}:${part.state ?? ""}:${part.summary ?? ""}`).map(({ item: part, key }) => (
            <WorkLogItem key={key} part={part} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function RecordingCard({
  recording,
  projectId,
  threadId,
}: {
  recording: Extract<MessagePartView, { kind: "recording" }>;
  projectId: string;
  threadId: string;
}) {
  const theme = useAppTheme();
  const { getAccessToken } = useAuth();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string>();

  const open = async () => {
    if (opening) return;
    setOpening(true);
    setError(undefined);
    try {
      if (recording.url) {
        await Linking.openURL(recording.url);
        return;
      }
      const request = async (forceRefresh = false) => {
        const token = await getAccessToken(forceRefresh);
        if (!token) throw new Error("Sign in to open this recording.");
        return await webRequest<{ url: string }>(
          `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}?recordingId=${encodeURIComponent(recording.id)}&prepare=1`,
          token,
        );
      };
      let result: { url: string };
      try {
        result = await request();
      } catch {
        result = await request(true);
      }
      await Linking.openURL(result.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The recording could not be opened.");
    } finally {
      setOpening(false);
    }
  };

  const duration = recording.durationSeconds === undefined
    ? null
    : recording.durationSeconds < 60
      ? `${Math.max(1, Math.round(recording.durationSeconds))}s`
      : `${Math.floor(recording.durationSeconds / 60)}:${String(Math.round(recording.durationSeconds) % 60).padStart(2, "0")}`;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={opening}
      onPress={() => void open()}
      style={({ pressed }) => [
        styles.recording,
        {
          backgroundColor: pressed ? theme.surfaceSoft : theme.surface,
          borderColor: error ? theme.danger : theme.line,
        },
      ]}
    >
      <View style={[styles.recordingIcon, { backgroundColor: theme.accentSoft }]}>
        {opening
          ? <ActivityIndicator color={theme.accentOn} size="small" />
          : <Video color={theme.accentOn} size={19} />}
      </View>
      <View style={styles.recordingCopy}>
        <Text numberOfLines={1} style={[styles.recordingTitle, { color: theme.ink }]}>
          {recording.title ?? "Demo walkthrough"}
        </Text>
        <Text numberOfLines={2} style={[styles.recordingMeta, { color: error ? theme.danger : theme.muted }]}>
          {(error ?? [duration, recording.status].filter(Boolean).join(" · ")) || "Screen recording"}
        </Text>
      </View>
      {opening ? null : <Play color={theme.muted} size={17} />}
    </Pressable>
  );
}

export function ThreadMessage({
  message,
  isLast,
  isLive,
  projectId,
  threadId,
}: {
  message: ThreadMessageValue;
  isLast: boolean;
  isLive: boolean;
  projectId: string;
  threadId: string;
}) {
  const theme = useAppTheme();
  const parts = messageParts(message.parts);
  const isUser = message.role === "user";
  const textParts = parts.filter((part) => part.kind === "text");
  const images = parts.filter((part) => part.kind === "file" && part.mediaType.startsWith("image/"));
  const files = parts.filter((part) => part.kind === "file" && !part.mediaType.startsWith("image/"));
  const recordings = parts.filter((part) => part.kind === "recording");
  const timestamp = timeLabel(message.updatedAt ?? message.createdAt);
  const assistantRunSummary = runSummary(message.metadata);
  const copyText = textParts.map((part) => part.kind === "text" ? part.text : "").join("\n\n");

  if (isUser) {
    return (
      <View style={styles.userMessage}>
        <View style={[styles.userBubble, { backgroundColor: theme.surfaceSoft, borderColor: theme.line }]}>
          {keyed(textParts, (part) => part.kind === "text" ? part.text : part.kind).map(({ item: part, key }) => part.kind === "text"
            ? <RichMessageText key={`${message.messageId}:text:${key}`} value={part.text} />
            : null)}
          {keyed(images, (part) => part.kind === "file" ? `${part.url}:${part.filename ?? ""}` : part.kind).map(({ item: part, key }) => part.kind === "file" ? (
            <Image
              key={`${message.messageId}:image:${key}`}
              accessibilityLabel={part.filename ?? "Attached image"}
              source={{ uri: part.url }}
              style={[styles.userImage, { backgroundColor: theme.surface }]}
            />
          ) : null)}
          {keyed(files, (part) => part.kind === "file" ? `${part.url}:${part.filename ?? ""}` : part.kind).map(({ item: part, key }) => part.kind === "file" ? (
            <Pressable
              accessibilityRole="link"
              key={`${message.messageId}:file:${key}`}
              onPress={() => void Linking.openURL(part.url)}
              style={[styles.fileCard, { backgroundColor: theme.surface, borderColor: theme.line }]}
            >
              <FileText color={theme.muted} size={17} />
              <Text numberOfLines={1} style={[styles.fileName, { color: theme.ink }]}>
                {part.filename ?? part.mediaType}
              </Text>
              <ExternalLink color={theme.faint} size={14} />
            </Pressable>
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
            <View style={[styles.liveDot, { backgroundColor: theme.accentOn }]} />
            <Text style={[styles.workingLabel, { color: theme.muted }]}>Working</Text>
          </>
        ) : null}
      </View>
      <WorkLog parts={parts} live={isLast && isLive} />
      {keyed(textParts, (part) => part.kind === "text" ? part.text : part.kind).map(({ item: part, key }) => part.kind === "text"
        ? <RichMessageText key={`${message.messageId}:text:${key}`} value={part.text} />
        : null)}
      {keyed(images, (part) => part.kind === "file" ? `${part.url}:${part.filename ?? ""}` : part.kind).map(({ item: part, key }) => part.kind === "file" ? (
        <Image
          key={`${message.messageId}:image:${key}`}
          accessibilityLabel={part.filename ?? "Attached image"}
          source={{ uri: part.url }}
          style={[styles.assistantImage, { backgroundColor: theme.surfaceSoft }]}
        />
      ) : null)}
      {keyed(files, (part) => part.kind === "file" ? `${part.url}:${part.filename ?? ""}` : part.kind).map(({ item: part, key }) => part.kind === "file" ? (
        <Pressable
          accessibilityRole="link"
          key={`${message.messageId}:file:${key}`}
          onPress={() => void Linking.openURL(part.url)}
          style={[styles.fileCard, { backgroundColor: theme.surface, borderColor: theme.line }]}
        >
          <FileText color={theme.muted} size={17} />
          <Text numberOfLines={1} style={[styles.fileName, { color: theme.ink }]}>
            {part.filename ?? part.mediaType}
          </Text>
          <ExternalLink color={theme.faint} size={14} />
        </Pressable>
      ) : null)}
      {keyed(recordings, (part) => part.kind === "recording" ? part.id : part.kind).map(({ item: part, key }) => part.kind === "recording" ? (
        <RecordingCard
          key={`${message.messageId}:recording:${key}`}
          recording={part}
          projectId={projectId}
          threadId={threadId}
        />
      ) : null)}
      {(timestamp || copyText || assistantRunSummary) && !(isLast && isLive) ? (
        <View style={[styles.messageMeta, styles.assistantMeta]}>
          {copyText ? (
            <Pressable accessibilityLabel="Copy response" onPress={() => void Clipboard.setStringAsync(copyText)} style={styles.copyButton}>
              <Copy color={theme.faint} size={13} />
            </Pressable>
          ) : null}
          {assistantRunSummary ? (
            <Text style={[styles.runSummary, { color: theme.faint }]}>{assistantRunSummary}</Text>
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
  italic: { fontStyle: "italic" },
  strikethrough: { textDecorationLine: "line-through" },
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
  runSummary: { fontFamily: "Inter_500Medium", fontSize: 9, fontVariant: ["tabular-nums"] },
  copyButton: { width: 28, height: 26, alignItems: "center", justifyContent: "center" },
  workLog: { marginBottom: 2 },
  workHeader: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 6 },
  workTitle: { fontFamily: "Inter_500Medium", fontSize: 11 },
  workItems: { borderLeftWidth: 1, marginLeft: 6, paddingLeft: 13, gap: 10, paddingVertical: 5 },
  workItem: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  workCopy: { flex: 1, minWidth: 0 },
  workItemHeading: { minHeight: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  workName: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  workSummary: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, marginTop: 3 },
  toolDetails: { minWidth: 280, maxWidth: 620, borderRadius: 7, padding: 9, fontFamily: "monospace", fontSize: 10, lineHeight: 15, marginTop: 7 },
  fileCard: { minHeight: 48, borderRadius: 9, borderWidth: 1, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 9 },
  fileName: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 11 },
  recording: { minHeight: 66, borderRadius: 12, borderWidth: 1, padding: 11, flexDirection: "row", alignItems: "center", gap: 10 },
  recordingIcon: { width: 40, height: 40, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  recordingCopy: { flex: 1, minWidth: 0 },
  recordingTitle: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  recordingMeta: { fontFamily: "Inter_400Regular", fontSize: 10, lineHeight: 15, marginTop: 4 },
});
