import { hasNumberType, hasObjectType } from "@autopr/config/runtime-type";
import { type JsonObject } from "@autopr/config/runtime-value";

import * as Clipboard from "expo-clipboard";
import { ChevronDown, ChevronRight, Copy, ExternalLink, FileText, Play, Video } from "lucide-react-native";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { webRequest } from "../../api/web";
import { useAuth } from "../../auth/AuthProvider";
import { useAppTheme } from "../../hooks/useAppTheme";
import { trustedAttachmentImageUrl } from "../../lib/attachmentUrls";
import { messageParts, type MessagePartView } from "../../lib/messages";
import { confirmOpenExternalUrl, openExternalUrl } from "../../lib/openUrl";
import { formatRecordingDuration } from "../../lib/recordingDuration";
import { exploreGroupSummary, shortDirectory } from "../../lib/toolPresentation";
import { RemoteImage } from "../RemoteImage";
import { PulsingDots, Shimmer } from "../Shimmer";

export type ThreadMessageValue = {
  messageId: string;
  role: string;
  parts: unknown[];
  metadata?: unknown;
  createdAt?: number;
  updatedAt?: number;
};

const messageTimeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function keyed<T>(items: readonly T[], baseKey: (item: T, index: number) => string) {
  const seen = new Map<string, number>();
  return items.map((item, index) => {
    const base = baseKey(item, index);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return { item, key: `${base}:${occurrence}` };
  });
}

function trustedImageParts(parts: MessagePartView[]) {
  const images: Array<Extract<MessagePartView, { kind: "file" }>> = [];
  for (const part of parts) {
    if (part.kind !== "file" || !part.mediaType.startsWith("image/")) continue;
    const url = trustedAttachmentImageUrl(part.url);
    if (url) images.push({ ...part, url });
  }
  return images;
}

function timeLabel(timestamp?: number) {
  if (!timestamp) return "";
  return messageTimeFormatter.format(timestamp);
}

type RunPresentation = { durationSeconds?: number; metrics: string[] };

function runPresentation<MetadataValue>(metadata: MetadataValue): RunPresentation {
  if (!hasObjectType(metadata) || metadata === null || Array.isArray(metadata)) {
    return { metrics: [] };
  }
  const value = /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ metadata as JsonObject;
  const usage = hasObjectType(value.usage) && value.usage !== null && !Array.isArray(value.usage)
    ? /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ value.usage as JsonObject
    : null;
  const run = hasObjectType(value.run) && value.run !== null && !Array.isArray(value.run)
    ? /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ value.run as JsonObject
    : null;
  const cost = usage && hasObjectType(usage.cost) && usage.cost !== null && !Array.isArray(usage.cost)
    ? /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ usage.cost as JsonObject
    : null;
  const totalTokens = hasNumberType(usage?.totalTokens) ? usage.totalTokens : undefined;
  const duration = hasNumberType(run?.durationSeconds) ? run.durationSeconds : undefined;
  const totalCost = hasNumberType(cost?.total) ? cost.total : undefined;
  const metrics: string[] = [];
  if (totalTokens !== undefined) {
    metrics.push(totalTokens >= 1_000 ? `${(totalTokens / 1_000).toFixed(totalTokens >= 100_000 ? 0 : 1)}k tokens` : `${totalTokens} tokens`);
  }
  if (totalCost !== undefined && totalCost > 0) {
    metrics.push(totalCost < 0.0001 ? "<$0.0001" : `$${totalCost.toFixed(totalCost < 1 ? 4 : 2)}`);
  }
  return {
    durationSeconds: duration,
    metrics,
  };
}

function formatRunDuration(durationSeconds: number) {
  const rounded = Math.max(0, Math.round(durationSeconds));
  return rounded < 60
    ? `${rounded}s`
    : `${Math.floor(rounded / 60)}m ${rounded % 60}s`;
}

function useElapsedSeconds(startedAt: number | undefined) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === undefined) return;
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return startedAt === undefined
    ? undefined
    : Math.max(0, Math.floor((now - startedAt) / 1_000));
}

export function AgentWorkingIndicator({ startedAt }: { startedAt?: number }) {
  const theme = useAppTheme();
  const elapsedSeconds = useElapsedSeconds(startedAt);

  return (
    <View accessibilityLiveRegion="polite" style={styles.workingPlaceholder}>
      <PulsingDots color={theme.faint} size={5} />
      <Shimmer style={[styles.workTitle, { color: theme.muted }]}>
        {elapsedSeconds === undefined
          ? "Working"
          : `Working for ${formatRunDuration(elapsedSeconds)}`}
      </Shimmer>
    </View>
  );
}

function inlineMarkdown(
  value: string,
  color: string,
  muted: string,
  onOpenLink: (url: string) => void,
): ReactNode[] {
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
          onPress={() => void onOpenLink(link[2] ?? "")}
          style={[styles.link, { color }]}
        >
          {link[1]}
        </Text>
      );
    }
    return token;
  });
}

function RichMessageText({
  value,
  inverted = false,
  compact = false,
  onOpenLink = confirmOpenExternalUrl,
}: {
  value: string;
  inverted?: boolean;
  compact?: boolean;
  /**
   * Rendered text is agent output by default, so links confirm with the raw
   * URL before opening. User-authored bubbles pass `openExternalUrl`.
   */
  onOpenLink?: (url: string) => void;
}) {
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
            <View key={key} style={[styles.codeBlock, compact && styles.detailCodeBlock, { backgroundColor: theme.code, borderColor: theme.codeLine }]}>
              {block.language ? (
                <Text style={[styles.codeLanguage, { color: theme.codeMuted }]}>{block.language}</Text>
              ) : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Text selectable style={[styles.codeText, compact && styles.detailCodeText, { color: theme.codeInk }]}>{block.value}</Text>
              </ScrollView>
            </View>
          );
        }
        if (!block.value && block.style === "body") {
          return <View key={key} style={compact ? styles.detailParagraphSpace : styles.paragraphSpace} />;
        }
        return (
          <View
            key={key}
            style={[
              styles.line,
              block.style === "quote" && [styles.quote, { borderLeftColor: theme.strongLine }],
            ]}
          >
            {block.style === "bullet" || block.style === "numbered" ? (
              <Text style={[compact ? styles.detailBullet : styles.bullet, { color: textColor }]}>
                {block.marker ?? "•"}
              </Text>
            ) : null}
            <Text
              selectable
              style={[
                compact ? styles.detailBody : styles.body,
                { color: textColor },
                block.style === "heading" && (compact ? styles.detailHeading : styles.heading),
                block.style === "quote" && { color: inverted ? theme.accentInk : theme.muted },
              ]}
            >
              {inlineMarkdown(block.value, linkColor, inverted ? "#FFFFFF2B" : theme.surfaceSoft, onOpenLink)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

type ToolPartView = Extract<MessagePartView, { kind: "tool" }>;
type ReasoningPartView = Extract<MessagePartView, { kind: "reasoning" }>;

type Activity =
  | { kind: "reasoning"; part: ReasoningPartView }
  | { kind: "tool"; part: ToolPartView }
  | { kind: "explore"; parts: ToolPartView[] };

/**
 * Consecutive read-only tools collapse into a single "Explored" row, the way
 * the web thread groups them, so a long search sweep stays one line.
 */
function toActivities(parts: MessagePartView[]): Activity[] {
  const activities: Activity[] = [];
  for (const part of parts) {
    if (part.kind === "reasoning") {
      activities.push({ kind: "reasoning", part });
      continue;
    }
    if (part.kind !== "tool") continue;
    if (!part.explore) {
      activities.push({ kind: "tool", part });
      continue;
    }
    const last = activities.at(-1);
    if (last?.kind === "explore") last.parts.push(part);
    else activities.push({ kind: "explore", parts: [part] });
  }
  return activities;
}

function activityKey(activity: Activity, index: number) {
  if (activity.kind === "reasoning") return `${index}:reasoning`;
  if (activity.kind === "tool") return `${index}:tool:${activity.part.name}`;
  return `${index}:explore`;
}

function Disclosure({ open }: { open: boolean }) {
  const theme = useAppTheme();
  return open
    ? <ChevronDown color={theme.faint} size={13} />
    : <ChevronRight color={theme.faint} size={13} />;
}

function ReasoningRow({ part, live }: { part: ReasoningPartView; live: boolean }) {
  const theme = useAppTheme();
  const [open, setOpen] = useState(live);

  return (
    <View style={styles.workItem}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.workItemHeading}
      >
        {live ? (
          <Shimmer style={[styles.workName, { color: theme.muted }]}>Thinking</Shimmer>
        ) : (
          <Text style={[styles.workName, { color: theme.muted }]}>Thought</Text>
        )}
        <Disclosure open={open} />
      </Pressable>
      {open ? (
        <View style={[styles.reasoningContent, { borderLeftColor: theme.line }]}>
          <RichMessageText compact value={part.text} />
        </View>
      ) : null}
    </View>
  );
}

function ToolRow({ part }: { part: ToolPartView }) {
  const theme = useAppTheme();
  const [open, setOpen] = useState(false);
  const canExpand = Boolean(part.details);
  const directory = part.path ? shortDirectory(part.path) : "";
  const status = part.failed
    ? "failed"
    : part.state === "approval-requested"
      ? "awaiting approval"
      : part.state === "output-denied" ? "denied" : "";

  return (
    <View style={styles.workItem}>
      <Pressable
        accessibilityRole={canExpand ? "button" : undefined}
        accessibilityState={canExpand ? { expanded: open } : undefined}
        disabled={!canExpand}
        onPress={() => setOpen((value) => !value)}
        style={styles.workItemHeading}
      >
        {canExpand ? <Disclosure open={open} /> : <View style={styles.workChevronSpace} />}
        {part.streaming ? (
          <Shimmer style={[styles.workName, { color: theme.ink }]}>{part.label}</Shimmer>
        ) : (
          <Text numberOfLines={1} style={[styles.workName, { color: theme.ink }]}>{part.label}</Text>
        )}
        {part.summary ? (
          <Text numberOfLines={1} style={[styles.workSummary, { color: theme.muted }]}>
            {part.summary}
          </Text>
        ) : null}
        {directory ? (
          <Text numberOfLines={1} style={[styles.workPath, { color: theme.faint }]}>{directory}</Text>
        ) : null}
        {status ? (
          <Text style={[styles.workStatus, { color: part.failed ? theme.danger : theme.faint }]}>
            {status}
          </Text>
        ) : null}
      </Pressable>
      {part.details && open ? (
        <View style={[styles.toolDetails, { backgroundColor: theme.code, borderColor: theme.codeLine }]}>
          <RichMessageText compact value={part.details} />
        </View>
      ) : null}
    </View>
  );
}

function ExploreRow({ parts }: { parts: ToolPartView[] }) {
  const theme = useAppTheme();
  const [open, setOpen] = useState(false);
  const streaming = parts.some((part) => part.streaming);
  const summary = exploreGroupSummary(parts.map((part) => part.label));

  return (
    <View style={styles.workItem}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.workItemHeading}
      >
        <Disclosure open={open} />
        {streaming ? (
          <Shimmer style={[styles.workName, { color: theme.muted }]}>Exploring</Shimmer>
        ) : (
          <Text style={[styles.workName, { color: theme.muted }]}>Explored</Text>
        )}
        <Text numberOfLines={1} style={[styles.workSummary, { color: theme.faint }]}>{summary}</Text>
      </Pressable>
      {open ? (
        <View style={[styles.exploreItems, { borderLeftColor: theme.line }]}>
          {keyed(parts, (part) => `${part.name}:${part.summary ?? ""}`).map(({ item: part, key }) => (
            <View key={key} style={styles.exploreItem}>
              <Text style={[styles.exploreName, { color: theme.muted }]}>{part.label}</Text>
              {part.summary ? (
                <Text numberOfLines={1} style={[styles.exploreSummary, { color: theme.faint }]}>
                  {part.summary}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function WorkLog({
  parts,
  live,
  run,
  startedAt,
}: {
  parts: MessagePartView[];
  live: boolean;
  run: RunPresentation;
  startedAt?: number;
}) {
  const theme = useAppTheme();
  const activities = useMemo(() => toActivities(parts), [parts]);
  const [expanded, setExpanded] = useState(live);
  const elapsedSeconds = useElapsedSeconds(live ? startedAt : undefined);
  const lastElapsedSecondsRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (elapsedSeconds !== undefined) {
      lastElapsedSecondsRef.current = elapsedSeconds;
    }
  }, [elapsedSeconds]);
  const durationSeconds = live
    ? elapsedSeconds
    : run.durationSeconds ?? lastElapsedSecondsRef.current;

  if (activities.length === 0 && durationSeconds === undefined && !live) return null;

  const title = durationSeconds === undefined
    ? live ? "Working" : "Worked"
    : `${live ? "Working" : "Worked"} for ${formatRunDuration(durationSeconds)}`;
  const headerContent = (
    <>
      {live
        ? <Shimmer style={[styles.workTitle, { color: theme.muted }]}>{title}</Shimmer>
        : <Text style={[styles.workTitle, { color: theme.muted }]}>{title}</Text>}
      {run.metrics.map((metric) => (
        <View key={metric} style={styles.workMetricGroup}>
          <View style={[styles.workMetricDivider, { backgroundColor: theme.line }]} />
          <Text style={[styles.workMetric, { color: theme.faint }]}>{metric}</Text>
        </View>
      ))}
      {activities.length > 0 ? <Disclosure open={expanded} /> : null}
    </>
  );

  return (
    <View style={styles.workLog}>
      {activities.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((value) => !value)}
          style={styles.workHeader}
        >
          {headerContent}
        </Pressable>
      ) : (
        <View style={styles.workHeader}>{headerContent}</View>
      )}
      {activities.length > 0 && expanded ? (
        <View style={[styles.workItems, { borderLeftColor: theme.line }]}>
          {keyed(activities, activityKey).map(({ item: activity, key }) => {
            if (activity.kind === "reasoning") {
              return (
                <ReasoningRow
                  key={key}
                  live={live && activity === activities.at(-1)}
                  part={activity.part}
                />
              );
            }
            if (activity.kind === "explore") {
              return <ExploreRow key={key} parts={activity.parts} />;
            }
            return <ToolRow key={key} part={activity.part} />;
          })}
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
        if (await openExternalUrl(recording.url)) return;
        throw new Error("The recording link could not be opened.");
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
      if (!(await openExternalUrl(result.url))) {
        throw new Error("The recording link could not be opened.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The recording could not be opened.");
    } finally {
      setOpening(false);
    }
  };

  const duration = formatRecordingDuration(recording.durationSeconds);

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

function ThreadMessageView({
  message,
  isLast,
  isLive,
  runStartedAt,
  projectId,
  threadId,
}: {
  message: ThreadMessageValue;
  isLast: boolean;
  isLive: boolean;
  runStartedAt?: number;
  projectId: string;
  threadId: string;
}) {
  const theme = useAppTheme();
  const parts = useMemo(() => messageParts(message.parts), [message.parts]);
  const isUser = message.role === "user";
  const { textParts, images, files, recordings, timestamp, assistantRun, copyText } = useMemo(() => {
    const text = parts.filter((part) => part.kind === "text");
    return {
      textParts: text,
      images: trustedImageParts(parts),
      files: parts.filter((part) => part.kind === "file" && !part.mediaType.startsWith("image/")),
      recordings: parts.filter((part) => part.kind === "recording"),
      timestamp: timeLabel(message.updatedAt ?? message.createdAt),
      assistantRun: runPresentation(message.metadata),
      copyText: text.map((part) => part.kind === "text" ? part.text : "").join("\n\n"),
    };
  }, [message.createdAt, message.metadata, message.updatedAt, parts]);

  if (isUser) {
    return (
      <View style={styles.userMessage}>
        <View style={[styles.userBubble, { backgroundColor: theme.accent }]}>
          {keyed(textParts, (part) => part.kind === "text" ? part.text : part.kind).map(({ item: part, key }) => part.kind === "text"
            ? <RichMessageText inverted key={`${message.messageId}:text:${key}`} onOpenLink={openExternalUrl} value={part.text} />
            : null)}
          {keyed(images, (part) => part.kind === "file" ? `${part.url}:${part.filename ?? ""}` : part.kind).map(({ item: part, key }) => part.kind === "file" ? (
            <RemoteImage
              accessibilityLabel={part.filename ?? "Attached image"}
              key={`${message.messageId}:image:${key}`}
              style={[styles.userImage, { backgroundColor: theme.surface }]}
              url={part.url}
            />
          ) : null)}
          {keyed(files, (part) => part.kind === "file" ? `${part.url}:${part.filename ?? ""}` : part.kind).map(({ item: part, key }) => part.kind === "file" ? (
            <Pressable
              accessibilityRole="link"
              key={`${message.messageId}:file:${key}`}
              onPress={() => void openExternalUrl(part.url)}
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
      <WorkLog
        run={assistantRun}
        parts={parts}
        live={isLast && isLive}
        startedAt={isLast && isLive ? runStartedAt : undefined}
      />
      {keyed(textParts, (part) => part.kind === "text" ? part.text : part.kind).map(({ item: part, key }) => part.kind === "text"
        ? <RichMessageText key={`${message.messageId}:text:${key}`} value={part.text} />
        : null)}
      {keyed(images, (part) => part.kind === "file" ? `${part.url}:${part.filename ?? ""}` : part.kind).map(({ item: part, key }) => part.kind === "file" ? (
        <RemoteImage
          accessibilityLabel={part.filename ?? "Attached image"}
          key={`${message.messageId}:image:${key}`}
          style={[styles.assistantImage, { backgroundColor: theme.surfaceSoft }]}
          url={part.url}
        />
      ) : null)}
      {keyed(files, (part) => part.kind === "file" ? `${part.url}:${part.filename ?? ""}` : part.kind).map(({ item: part, key }) => part.kind === "file" ? (
        <Pressable
          accessibilityRole="link"
          key={`${message.messageId}:file:${key}`}
          onPress={() => confirmOpenExternalUrl(part.url)}
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

export const ThreadMessage = memo(ThreadMessageView);

const styles = StyleSheet.create({
  richText: { gap: 2 },
  line: { minWidth: 0, flexDirection: "row" },
  body: { flexShrink: 1, fontFamily: "DMSans_400Regular", fontSize: 16, lineHeight: 25 },
  bold: { fontFamily: "DMSans_700Bold" },
  italic: { fontStyle: "italic" },
  strikethrough: { textDecorationLine: "line-through" },
  heading: { fontFamily: "DMSans_700Bold", fontSize: 18, lineHeight: 25, marginTop: 7 },
  bullet: { width: 18, fontFamily: "DMSans_500Medium", fontSize: 16, lineHeight: 25 },
  quote: { borderLeftWidth: 2, paddingLeft: 10, marginVertical: 3 },
  link: { textDecorationLine: "underline" },
  inlineCode: { fontFamily: "monospace", fontSize: 13 },
  paragraphSpace: { height: 7 },
  codeBlock: { borderWidth: 1, borderRadius: 6, padding: 10, marginVertical: 7 },
  codeLanguage: { fontFamily: "DMSans_500Medium", fontSize: 9, textTransform: "uppercase", marginBottom: 7 },
  codeText: { fontFamily: "monospace", fontSize: 12, lineHeight: 18 },
  detailBody: { flexShrink: 1, fontFamily: "DMSans_400Regular", fontSize: 12, lineHeight: 18 },
  detailHeading: { fontFamily: "DMSans_500Medium", fontSize: 13, lineHeight: 19, marginTop: 4 },
  detailBullet: { width: 15, fontFamily: "DMSans_500Medium", fontSize: 12, lineHeight: 18 },
  detailParagraphSpace: { height: 5 },
  detailCodeBlock: { padding: 8, marginVertical: 5 },
  detailCodeText: { fontSize: 10, lineHeight: 15 },
  userMessage: { alignItems: "flex-end", marginBottom: 26 },
  userBubble: { maxWidth: "88%", borderRadius: 20, paddingHorizontal: 15, paddingVertical: 12, gap: 8 },
  userImage: { width: 220, aspectRatio: 1.35, borderRadius: 8 },
  assistantMessage: { marginBottom: 30, paddingHorizontal: 3, gap: 10 },
  assistantImage: { width: "100%", aspectRatio: 1.4, borderRadius: 10 },
  messageMeta: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: 2, paddingTop: 2 },
  assistantMeta: { justifyContent: "flex-start" },
  timestamp: { fontFamily: "DMSans_500Medium", fontSize: 11 },
  copyButton: { width: 28, height: 26, alignItems: "center", justifyContent: "center" },
  workLog: { marginBottom: 8 },
  workingPlaceholder: { minHeight: 42, paddingHorizontal: 3, flexDirection: "row", alignItems: "center", gap: 9 },
  workHeader: { minHeight: 32, flexDirection: "row", alignItems: "center", columnGap: 7, flexWrap: "wrap" },
  workTitle: { fontFamily: "DMSans_500Medium", fontSize: 12, fontVariant: ["tabular-nums"] },
  workMetricGroup: { flexDirection: "row", alignItems: "center", gap: 7 },
  workMetricDivider: { width: StyleSheet.hairlineWidth, height: 12 },
  workMetric: { fontFamily: "DMSans_500Medium", fontSize: 10, fontVariant: ["tabular-nums"] },
  workItems: { borderLeftWidth: 1, marginLeft: 6, paddingLeft: 12, gap: 3, paddingTop: 8, paddingBottom: 2 },
  workItem: { minWidth: 0 },
  workItemHeading: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: 6 },
  workChevronSpace: { width: 13 },
  workName: { flexShrink: 0, fontFamily: "DMSans_500Medium", fontSize: 11 },
  workSummary: { flexShrink: 1, fontFamily: "DMSans_400Regular", fontSize: 10 },
  workPath: { flexShrink: 1, fontFamily: "DMSans_400Regular", fontSize: 9 },
  workStatus: { flexShrink: 0, marginLeft: "auto", fontFamily: "DMSans_500Medium", fontSize: 9 },
  reasoningContent: { borderLeftWidth: 1, paddingLeft: 10, marginLeft: 3, marginTop: 3, marginBottom: 4 },
  exploreItems: { borderLeftWidth: 1, marginLeft: 6, paddingLeft: 10, marginTop: 3, marginBottom: 4, gap: 2 },
  exploreItem: { minHeight: 19, flexDirection: "row", alignItems: "center", gap: 6 },
  exploreName: { flexShrink: 0, fontFamily: "DMSans_500Medium", fontSize: 10 },
  exploreSummary: { flexShrink: 1, fontFamily: "DMSans_400Regular", fontSize: 9 },
  toolDetails: { borderWidth: 1, borderRadius: 8, padding: 9, marginTop: 5, marginLeft: 19 },
  fileCard: { minHeight: 48, borderRadius: 9, borderWidth: 1, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 9 },
  fileName: { flex: 1, fontFamily: "DMSans_500Medium", fontSize: 11 },
  recording: { minHeight: 66, borderRadius: 12, borderWidth: 1, padding: 11, flexDirection: "row", alignItems: "center", gap: 10 },
  recordingIcon: { width: 40, height: 40, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  recordingCopy: { flex: 1, minWidth: 0 },
  recordingTitle: { fontFamily: "DMSans_500Medium", fontSize: 12 },
  recordingMeta: { fontFamily: "DMSans_400Regular", fontSize: 10, lineHeight: 15, marginTop: 4 },
});
