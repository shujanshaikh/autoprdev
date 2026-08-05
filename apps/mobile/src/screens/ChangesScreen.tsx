import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Clipboard from "expo-clipboard";
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Copy,
  FileDiff,
  MessageSquarePlus,
  WrapText,
} from "lucide-react-native";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { EmptyState, ErrorNotice, LoadingState, PrimaryButton } from "../components/ui";
import { useAppTheme } from "../hooks/useAppTheme";
import { useThreadData } from "../hooks/useThreadData";
import {
  extractDiffEntries,
  hunkContext,
  hunkRange,
  parseUnifiedDiff,
  visibleWhitespace,
  wordDiffSegments,
  type DiffEntry,
  type DiffLine,
} from "../lib/diff";
import { pathBasename, shortDirectory } from "../lib/toolPresentation";
import type { DiffSegment } from "../lib/wordDiff";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Changes">;

type Selection = {
  entry: DiffEntry;
  line: DiffLine;
};

const DIFF_LINE_PAGE_SIZE = 400;
const MONO_FONT = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });
/** Deletion bars are dashed so the two sides read apart without relying on hue. */
const DELETION_BAR_DASHES = 5;

function fallbackPatch(entry: DiffEntry) {
  if (entry.patch) return entry.patch;
  const oldLines = (entry.oldContent ?? "").split("\n");
  const newLines = (entry.newContent ?? "").split("\n");
  return [
    `--- a/${entry.file}`,
    `+++ b/${entry.file}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ].join("\n");
}

function ChangeBar({ type }: { type: DiffLine["type"] }) {
  const theme = useAppTheme();
  if (type === "delete") {
    return (
      <View style={styles.changeBar}>
        {Array.from({ length: DELETION_BAR_DASHES }, (_, index) => (
          <View key={index} style={[styles.changeBarDash, { backgroundColor: theme.delete }]} />
        ))}
      </View>
    );
  }
  return (
    <View style={[
      styles.changeBar,
      { backgroundColor: type === "add" ? theme.add : "transparent" },
    ]} />
  );
}

const HunkRow = memo(function HunkRow({ line, wrapped }: { line: DiffLine; wrapped: boolean }) {
  const theme = useAppTheme();
  const context = hunkContext(line.content);

  return (
    <View style={[
      styles.hunkRow,
      wrapped && styles.hunkRowWrapped,
      { backgroundColor: theme.surfaceSoft, borderTopColor: theme.codeLine, borderBottomColor: theme.codeLine },
    ]}>
      <Text style={[styles.hunkRange, { color: theme.codeMuted }]}>{hunkRange(line.content)}</Text>
      {context ? (
        <Text numberOfLines={1} style={[styles.hunkContext, { color: theme.faint }]}>{context}</Text>
      ) : null}
    </View>
  );
});

const DiffRow = memo(function DiffRow({
  line,
  segments,
  selected,
  wrapped,
  onPress,
}: {
  line: DiffLine;
  segments?: DiffSegment[];
  selected: boolean;
  wrapped: boolean;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  const isAdd = line.type === "add";
  const isDelete = line.type === "delete";
  const backgroundColor = selected
    ? theme.accentSoft
    : isAdd ? theme.addSoft : isDelete ? theme.deleteSoft : theme.code;
  const textColor = isAdd || isDelete ? theme.codeInk : theme.codeMuted;
  const highlight = isAdd ? theme.add : theme.delete;
  const content = line.content || " ";

  return (
    <Pressable
      onPress={onPress}
      style={[styles.diffRow, wrapped && styles.diffRowWrapped, { backgroundColor }]}
    >
      <ChangeBar type={line.type} />
      <Text style={[styles.lineNumber, { color: theme.codeMuted }]}>{line.oldLine ?? ""}</Text>
      <Text style={[styles.lineNumber, { color: theme.codeMuted }]}>{line.newLine ?? ""}</Text>
      <Text style={[styles.marker, { color: isAdd ? theme.add : isDelete ? theme.delete : theme.codeMuted }]}>
        {isAdd ? "+" : isDelete ? "−" : " "}
      </Text>
      <Text
        numberOfLines={wrapped ? undefined : 1}
        selectable
        style={[styles.code, { color: textColor }]}
      >
        {segments
          ? segments.map((segment, index) => (
            <Text
              // Segments are positional runs of one immutable line.
              key={`${index}:${segment.text.length}`}
              style={segment.highlight ? { backgroundColor: `${highlight}33` } : undefined}
            >
              {visibleWhitespace(segment.text, index === 0)}
            </Text>
          ))
          : visibleWhitespace(content, true)}
      </Text>
    </Pressable>
  );
});

function statusTone(status: DiffEntry["status"], theme: ReturnType<typeof useAppTheme>) {
  if (status === "added") return theme.add;
  if (status === "deleted") return theme.delete;
  return theme.warning;
}

function FileReview({
  entry,
  viewed,
  collapsed,
  selection,
  wrapped,
  onViewed,
  onCollapsed,
  onSelect,
}: {
  entry: DiffEntry;
  viewed: boolean;
  collapsed: boolean;
  selection: Selection | null;
  wrapped: boolean;
  onViewed: () => void;
  onCollapsed: () => void;
  onSelect: (line: DiffLine) => void;
}) {
  const theme = useAppTheme();
  const lines = useMemo(
    () => parseUnifiedDiff(fallbackPatch(entry)).flatMap((file) => file.lines),
    [entry],
  );
  const segments = useMemo(() => wordDiffSegments(lines), [lines]);
  const [visibleLineCount, setVisibleLineCount] = useState(DIFF_LINE_PAGE_SIZE);
  const visibleLines = useMemo(
    () => lines.slice(0, visibleLineCount),
    [lines, visibleLineCount],
  );
  const hiddenLineCount = Math.max(0, lines.length - visibleLines.length);
  const name = pathBasename(entry.file);
  const directory = shortDirectory(entry.file);

  return (
    <View style={[styles.file, { borderColor: theme.line, backgroundColor: theme.surface }]}>
      <Pressable
        accessibilityLabel={collapsed ? `Expand ${entry.file}` : `Collapse ${entry.file}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        onPress={onCollapsed}
        style={({ pressed }) => [
          styles.fileHeader,
          { backgroundColor: pressed ? theme.surfaceSoft : theme.surface, opacity: viewed ? 0.6 : 1 },
        ]}
      >
        {collapsed
          ? <ChevronRight color={theme.faint} size={16} />
          : <ChevronDown color={theme.faint} size={16} />}
        <View style={[styles.statusDot, { backgroundColor: statusTone(entry.status, theme) }]} />
        <View style={styles.fileCopy}>
          <Text numberOfLines={1} style={[styles.fileName, { color: theme.ink }]}>{name}</Text>
          {directory ? (
            <Text numberOfLines={1} style={[styles.fileDirectory, { color: theme.faint }]}>
              {directory}
            </Text>
          ) : null}
        </View>
        {entry.additions > 0 ? (
          <Text style={[styles.stat, { color: theme.add }]}>+{entry.additions}</Text>
        ) : null}
        {entry.deletions > 0 ? (
          <Text style={[styles.stat, { color: theme.delete }]}>−{entry.deletions}</Text>
        ) : null}
        <Pressable
          accessibilityLabel={viewed ? `Mark ${name} unviewed` : `Mark ${name} viewed`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: viewed }}
          hitSlop={8}
          onPress={onViewed}
          style={[
            styles.viewedBox,
            {
              borderColor: viewed ? theme.accent : theme.strongLine,
              backgroundColor: viewed ? theme.accent : "transparent",
            },
          ]}
        >
          {viewed ? <Check color={theme.accentInk} size={12} strokeWidth={3} /> : null}
        </Pressable>
      </Pressable>
      {!collapsed ? (
        <ScrollView
          horizontal={!wrapped}
          nestedScrollEnabled
          showsHorizontalScrollIndicator={!wrapped}
          style={[styles.diffScroll, { backgroundColor: theme.code, borderTopColor: theme.codeLine }]}
        >
          <View style={[styles.diffBody, wrapped && styles.diffBodyWrapped]}>
            {visibleLines.length > 0 ? visibleLines.map((line) => (
              line.type === "hunk" ? (
                <HunkRow key={line.id} line={line} wrapped={wrapped} />
              ) : line.type === "meta" ? null : (
                <DiffRow
                  key={line.id}
                  line={line}
                  segments={segments.get(line.id)}
                  selected={selection?.entry.id === entry.id && selection.line.id === line.id}
                  wrapped={wrapped}
                  onPress={() => onSelect(line)}
                />
              )
            )) : (
              <Text style={[styles.unavailable, { color: theme.codeMuted }]}>
                Diff content is unavailable.
              </Text>
            )}
            {hiddenLineCount > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setVisibleLineCount((current) =>
                  Math.min(lines.length, current + DIFF_LINE_PAGE_SIZE))}
                style={[styles.showMore, { backgroundColor: theme.surfaceSoft, borderTopColor: theme.codeLine }]}
              >
                <Text style={[styles.showMoreText, { color: theme.ink }]}>
                  Show {Math.min(DIFF_LINE_PAGE_SIZE, hiddenLineCount)} more · {hiddenLineCount} left
                </Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

export function ChangesScreen({ navigation, route }: Props) {
  const { projectId, threadId } = route.params;
  const theme = useAppTheme();
  const { project, thread, messages, loading, hydrationError } = useThreadData(projectId, threadId);
  const entries = useMemo(() => extractDiffEntries(messages), [messages]);
  const viewedKey = `autopr.mobile.viewed-diffs:${threadId}`;
  const draftKey = `autopr.mobile.diff-draft:${threadId}`;
  const wrapKey = "autopr.mobile.diff-wrap";
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [wrapped, setWrapped] = useState(false);

  useLayoutEffect(() => {
    const additions = entries.reduce((sum, entry) => sum + entry.additions, 0);
    const deletions = entries.reduce((sum, entry) => sum + entry.deletions, 0);
    navigation.setOptions({
      title: "Changes",
      headerTitle: () => (
        <View style={styles.headerTitle}>
          <Text style={[styles.headerTitleText, { color: theme.ink }]}>Changes</Text>
          {entries.length > 0 ? (
            <Text numberOfLines={1} style={[styles.headerSubtitle, { color: theme.muted }]}>
              {entries.length} file{entries.length === 1 ? "" : "s"}
              {"  "}
              <Text style={{ color: theme.add }}>+{additions}</Text>
              {"  "}
              <Text style={{ color: theme.delete }}>−{deletions}</Text>
            </Text>
          ) : null}
        </View>
      ),
    });
  }, [entries, navigation, theme]);

  useEffect(() => {
    void AsyncStorage.getItem(viewedKey).then((stored) => {
      if (!stored) return;
      let ids: unknown;
      try {
        ids = JSON.parse(stored);
      } catch {
        return;
      }
      if (Array.isArray(ids)) setViewed(new Set(ids.filter((value): value is string => typeof value === "string")));
    }).catch(() => undefined);
  }, [viewedKey]);

  useEffect(() => {
    void AsyncStorage.getItem(wrapKey)
      .then((stored) => setWrapped(stored === "1"))
      .catch(() => undefined);
  }, [wrapKey]);

  const updateViewed = useCallback((entryId: string) => {
    const next = new Set(viewed);
    if (next.has(entryId)) next.delete(entryId);
    else next.add(entryId);
    setViewed(next);
    void AsyncStorage.setItem(viewedKey, JSON.stringify([...next]));
  }, [viewed, viewedKey]);

  const renderFileReview = useCallback(({ item: entry }: { item: DiffEntry }) => (
    <FileReview
      entry={entry}
      viewed={viewed.has(entry.id)}
      collapsed={collapsed.has(entry.id)}
      selection={selection}
      wrapped={wrapped}
      onViewed={() => updateViewed(entry.id)}
      onCollapsed={() => setCollapsed((current) => {
        const next = new Set(current);
        if (next.has(entry.id)) next.delete(entry.id);
        else next.add(entry.id);
        return next;
      })}
      onSelect={(line) => setSelection((current) =>
        current?.entry.id === entry.id && current.line.id === line.id ? null : { entry, line })}
    />
  ), [collapsed, selection, updateViewed, viewed, wrapped]);

  const askAboutSelection = async () => {
    if (!selection) return;
    const lineNumber = selection.line.newLine ?? selection.line.oldLine ?? 1;
    const side = selection.line.type === "delete" ? "before" : "after";
    const context = [
      `Please review this selected line from ${selection.entry.file} (${side}, line ${lineNumber}):`,
      "```",
      `${lineNumber}: ${selection.line.content}`,
      "```",
    ].join("\n");
    await AsyncStorage.setItem(draftKey, context);
    navigation.goBack();
  };

  if (loading) return <LoadingState label="Preparing review…" />;
  if (!project || !thread) return <ErrorNotice message="This conversation was not found." />;

  const viewedCount = entries.filter((entry) => viewed.has(entry.id)).length;
  const progress = entries.length > 0 ? viewedCount / entries.length : 0;
  const allViewed = entries.length > 0 && viewedCount >= entries.length;

  return (
    <View style={[styles.screen, { backgroundColor: theme.screen }]}>
      {entries.length > 0 ? (
        <View style={[styles.reviewSummary, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
          <View style={styles.summaryTop}>
            <View style={[styles.progressTrack, { backgroundColor: theme.surfaceSoft }]}>
              <View style={[styles.progressFill, { backgroundColor: theme.accentOn, width: `${progress * 100}%` }]} />
            </View>
            <Text style={[styles.summaryMeta, { color: theme.muted }]}>
              {viewedCount}/{entries.length} viewed
            </Text>
          </View>
          <View style={styles.summaryActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const next = allViewed ? new Set<string>() : new Set(entries.map((entry) => entry.id));
                setViewed(next);
                void AsyncStorage.setItem(viewedKey, JSON.stringify([...next]));
              }}
              style={[styles.summaryButton, { backgroundColor: theme.surfaceSoft }]}
            >
              <CheckCheck color={theme.muted} size={14} />
              <Text style={[styles.summaryButtonText, { color: theme.muted }]}>
                {allViewed ? "Unview all" : "View all"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setCollapsed((current) =>
                current.size >= entries.length
                  ? new Set()
                  : new Set(entries.map((entry) => entry.id)))}
              style={[styles.summaryButton, { backgroundColor: theme.surfaceSoft }]}
            >
              <ChevronDown color={theme.muted} size={14} />
              <Text style={[styles.summaryButtonText, { color: theme.muted }]}>
                {collapsed.size >= entries.length ? "Expand all" : "Collapse all"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void Clipboard.setStringAsync(entries.map((entry) => entry.file).join("\n"))}
              style={[styles.summaryButton, { backgroundColor: theme.surfaceSoft }]}
            >
              <Copy color={theme.muted} size={14} />
              <Text style={[styles.summaryButtonText, { color: theme.muted }]}>Copy files</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: wrapped }}
              onPress={() => {
                const next = !wrapped;
                setWrapped(next);
                void AsyncStorage.setItem(wrapKey, next ? "1" : "0");
              }}
              style={[
                styles.summaryButton,
                { backgroundColor: wrapped ? theme.accentSoft : theme.surfaceSoft },
              ]}
            >
              <WrapText color={wrapped ? theme.accentOn : theme.muted} size={14} />
              <Text style={[styles.summaryButtonText, { color: wrapped ? theme.ink : theme.muted }]}>Wrap</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {hydrationError ? <View style={styles.error}><ErrorNotice message={hydrationError} /></View> : null}

      {entries.length === 0 ? (
        <EmptyState
          icon={FileDiff}
          title="No changes yet"
          body={thread.isLive
            ? "The agent is working. File changes will appear here as soon as edits are persisted."
            : "Start a task in the conversation to create a reviewable diff."}
        />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(entry) => entry.id}
          contentContainerStyle={styles.files}
          renderItem={renderFileReview}
          showsVerticalScrollIndicator={false}
        />
      )}

      {selection ? (
        <View style={[styles.selectionBar, { backgroundColor: theme.surfaceRaised, borderTopColor: theme.line }]}>
          <View style={styles.selectionCopy}>
            <Text numberOfLines={1} style={[styles.selectionTitle, { color: theme.ink }]}>
              {pathBasename(selection.entry.file)}
              <Text style={{ color: theme.faint }}>
                {`  ${selection.line.newLine ?? selection.line.oldLine}`}
              </Text>
            </Text>
            <Text numberOfLines={1} style={[styles.selectionMeta, { color: theme.muted }]}>
              {selection.line.content.trim() || "Blank line"}
            </Text>
          </View>
          <PrimaryButton
            compact
            icon={MessageSquarePlus}
            label="Ask agent"
            onPress={() => void askAboutSelection()}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerTitle: { alignItems: "center" },
  headerTitleText: { fontFamily: "DMSans_700Bold", fontSize: 16, letterSpacing: -0.3 },
  headerSubtitle: { fontFamily: "DMSans_500Medium", fontSize: 11, marginTop: 1, fontVariant: ["tabular-nums"] },
  reviewSummary: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 10, gap: 9 },
  summaryTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  summaryMeta: { flexShrink: 0, fontFamily: "DMSans_500Medium", fontSize: 11, fontVariant: ["tabular-nums"] },
  progressTrack: { flex: 1, height: 3, borderRadius: 999, overflow: "hidden" },
  progressFill: { height: 3, borderRadius: 999 },
  summaryActions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  summaryButton: { minHeight: 30, borderRadius: 8, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 5 },
  summaryButtonText: { fontFamily: "DMSans_500Medium", fontSize: 10 },
  error: { padding: 12 },
  files: { padding: 10, paddingBottom: 110, gap: 10 },
  file: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, overflow: "hidden" },
  fileHeader: { minHeight: 52, paddingLeft: 8, paddingRight: 11, flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  fileCopy: { flex: 1, minWidth: 0 },
  fileName: { fontFamily: "DMSans_500Medium", fontSize: 13, letterSpacing: -0.2 },
  fileDirectory: { fontFamily: MONO_FONT, fontSize: 10, marginTop: 3 },
  stat: { fontFamily: "DMSans_700Bold", fontSize: 10, fontVariant: ["tabular-nums"] },
  viewedBox: { width: 21, height: 21, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center", marginLeft: 2 },
  diffScroll: { borderTopWidth: StyleSheet.hairlineWidth },
  diffBody: { minWidth: 900, paddingBottom: 4 },
  diffBodyWrapped: { minWidth: 0, width: "100%" },
  diffRow: { minHeight: 22, minWidth: 900, flexDirection: "row", alignItems: "center" },
  diffRowWrapped: { minWidth: 0, alignItems: "flex-start", paddingVertical: 2 },
  changeBar: { width: 3, alignSelf: "stretch", overflow: "hidden" },
  changeBarDash: { flex: 1, width: 3, marginBottom: 2 },
  lineNumber: { width: 38, paddingRight: 7, textAlign: "right", fontFamily: MONO_FONT, fontSize: 10, lineHeight: 18 },
  marker: { width: 16, textAlign: "center", fontFamily: MONO_FONT, fontSize: 11, lineHeight: 18 },
  code: { flex: 1, fontFamily: MONO_FONT, fontSize: 11, lineHeight: 18, paddingRight: 20 },
  hunkRow: { minHeight: 26, minWidth: 900, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingLeft: 10, paddingRight: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  hunkRowWrapped: { minWidth: 0 },
  hunkRange: { flexShrink: 0, fontFamily: MONO_FONT, fontSize: 10 },
  hunkContext: { flexShrink: 1, fontFamily: MONO_FONT, fontSize: 10 },
  unavailable: { fontFamily: "DMSans_400Regular", fontSize: 12, padding: 16 },
  showMore: { minHeight: 40, borderTopWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  showMoreText: { fontFamily: "DMSans_500Medium", fontSize: 10 },
  selectionBar: { position: "absolute", bottom: 0, left: 0, right: 0, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 16, flexDirection: "row", alignItems: "center", gap: 10 },
  selectionCopy: { flex: 1, minWidth: 0 },
  selectionTitle: { fontFamily: "DMSans_500Medium", fontSize: 12 },
  selectionMeta: { fontFamily: MONO_FONT, fontSize: 10, marginTop: 4 },
});
