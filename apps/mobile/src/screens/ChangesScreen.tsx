import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Clipboard from "expo-clipboard";
import { Check, CheckCheck, ChevronDown, ChevronRight, Copy, FileDiff, MessageSquare, MessageSquarePlus, WrapText } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { EmptyState, ErrorNotice, LoadingState, PrimaryButton } from "../components/ui";
import { useAppTheme } from "../hooks/useAppTheme";
import { useThreadData } from "../hooks/useThreadData";
import { extractDiffEntries, parseUnifiedDiff, type DiffEntry, type DiffLine } from "../lib/diff";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Changes">;

type Selection = {
  entry: DiffEntry;
  line: DiffLine;
};

const DIFF_LINE_PAGE_SIZE = 400;

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

function DiffRow({
  line,
  selected,
  wrapped,
  onPress,
}: {
  line: DiffLine;
  selected: boolean;
  wrapped: boolean;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  const isAdd = line.type === "add";
  const isDelete = line.type === "delete";
  const isHunk = line.type === "hunk";
  const backgroundColor = selected
    ? theme.accentSoft
    : isAdd ? theme.addSoft : isDelete ? theme.deleteSoft : isHunk ? theme.surfaceSoft : theme.code;
  const textColor = isAdd
    ? theme.add
    : isDelete
      ? theme.delete
      : isHunk
        ? theme.accentOn
        : theme.codeInk;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.diffRow, wrapped && styles.diffRowWrapped, { backgroundColor }]}
    >
      <View style={[
        styles.changeBar,
        { backgroundColor: isAdd ? theme.add : isDelete ? theme.delete : "transparent" },
      ]} />
      <Text style={[styles.lineNumber, { color: theme.codeMuted }]}>
        {line.oldLine ?? ""}
      </Text>
      <Text style={[styles.lineNumber, { color: theme.codeMuted }]}>
        {line.newLine ?? ""}
      </Text>
      <Text style={[styles.marker, { color: textColor }]}>
        {isAdd ? "+" : isDelete ? "−" : isHunk ? "@" : " "}
      </Text>
      <Text numberOfLines={wrapped ? undefined : 1} style={[styles.code, { color: textColor }]}>
        {line.content || " "}
      </Text>
    </Pressable>
  );
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
  const parsed = useMemo(() => parseUnifiedDiff(fallbackPatch(entry)), [entry]);
  const lines = useMemo(() => parsed.flatMap((file) => file.lines), [parsed]);
  const [visibleLineCount, setVisibleLineCount] = useState(DIFF_LINE_PAGE_SIZE);
  const visibleLines = useMemo(
    () => lines.slice(0, visibleLineCount),
    [lines, visibleLineCount],
  );
  const hiddenLineCount = Math.max(0, lines.length - visibleLines.length);
  return (
    <View style={[styles.file, { borderColor: theme.line, opacity: viewed ? 0.67 : 1 }]}>
      <View style={[styles.fileHeader, { backgroundColor: theme.surface }]}>
        <Pressable accessibilityLabel={collapsed ? "Expand diff" : "Collapse diff"} onPress={onCollapsed} style={styles.headerIcon}>
          {collapsed
            ? <ChevronRight color={theme.muted} size={17} />
            : <ChevronDown color={theme.muted} size={17} />}
        </Pressable>
        <View style={styles.fileCopy}>
          <Text numberOfLines={1} style={[styles.filePath, { color: theme.ink }]}>{entry.file}</Text>
          <Text style={[styles.fileMeta, { color: theme.muted }]}>
            {entry.status} · {lines.length} diff rows
          </Text>
        </View>
        <Text style={[styles.stat, { color: theme.add }]}>+{entry.additions}</Text>
        <Text style={[styles.stat, { color: theme.delete }]}>−{entry.deletions}</Text>
        <Pressable
          accessibilityLabel={viewed ? "Mark unviewed" : "Mark viewed"}
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
      </View>
      {!collapsed ? (
        <ScrollView
          horizontal={!wrapped}
          nestedScrollEnabled
          showsHorizontalScrollIndicator
          style={{ backgroundColor: theme.code }}
        >
          <View style={[styles.diffBody, wrapped && styles.diffBodyWrapped]}>
            {visibleLines.length > 0 ? visibleLines.map((line) => (
              <DiffRow
                key={line.id}
                line={line}
                selected={selection?.entry.id === entry.id && selection.line.id === line.id}
                wrapped={wrapped}
                onPress={() => onSelect(line)}
              />
            )) : (
              <Text style={[styles.unavailable, { color: theme.codeMuted }]}>Diff content is unavailable.</Text>
            )}
            {hiddenLineCount > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setVisibleLineCount((current) =>
                  Math.min(lines.length, current + DIFF_LINE_PAGE_SIZE))}
                style={[styles.showMore, { backgroundColor: theme.surfaceSoft, borderColor: theme.codeLine }]}
              >
                <Text style={[styles.showMoreText, { color: theme.ink }]}>
                  Show next {Math.min(DIFF_LINE_PAGE_SIZE, hiddenLineCount)} lines · {hiddenLineCount} remaining
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

  useEffect(() => {
    void AsyncStorage.getItem(viewedKey).then((stored) => {
      if (!stored) return;
      const ids = JSON.parse(stored) as unknown;
      if (Array.isArray(ids)) setViewed(new Set(ids.filter((value): value is string => typeof value === "string")));
    });
  }, [viewedKey]);

  useEffect(() => {
    void AsyncStorage.getItem(wrapKey).then((stored) => setWrapped(stored === "1"));
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

  const additions = entries.reduce((sum, entry) => sum + entry.additions, 0);
  const deletions = entries.reduce((sum, entry) => sum + entry.deletions, 0);
  const viewedCount = entries.filter((entry) => viewed.has(entry.id)).length;
  const progress = entries.length > 0 ? viewedCount / entries.length : 0;

  return (
    <View style={[styles.screen, { backgroundColor: theme.screen }]}>
      <View style={[styles.viewSwitcherWrap, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
        <View style={[styles.viewSwitcher, { backgroundColor: theme.surfaceSoft }]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [styles.viewOption, { opacity: pressed ? 0.6 : 1 }]}
          >
            <MessageSquare color={theme.muted} size={14} />
            <Text style={[styles.viewOptionText, { color: theme.muted }]}>Chat</Text>
          </Pressable>
          <View style={[styles.viewOption, { backgroundColor: theme.surfaceRaised, borderColor: theme.line }]}>
            <FileDiff color={theme.ink} size={14} />
            <Text style={[styles.viewOptionText, { color: theme.ink }]}>Diff</Text>
            {entries.length > 0 ? (
              <View style={[styles.viewBadge, { backgroundColor: theme.accentSoft }]}>
                <Text style={[styles.viewBadgeText, { color: theme.ink }]}>{entries.length}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
      <View style={[styles.reviewSummary, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
        <View style={styles.summaryTop}>
          <View>
            <Text style={[styles.summaryTitle, { color: theme.ink }]}>Review progress</Text>
            <Text style={[styles.summaryMeta, { color: theme.muted }]}>
              {viewedCount} of {entries.length} files viewed
            </Text>
          </View>
          <View style={styles.summaryStats}>
            <Text style={[styles.summaryStat, { color: theme.add }]}>+{additions}</Text>
            <Text style={[styles.summaryStat, { color: theme.delete }]}>−{deletions}</Text>
          </View>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: theme.surfaceSoft }]}>
          <View style={[styles.progressFill, { backgroundColor: theme.accentOn, width: `${progress * 100}%` }]} />
        </View>
        <View style={styles.summaryActions}>
          <Pressable
            onPress={() => {
              const allViewed = viewedCount >= entries.length;
              const next = allViewed ? new Set<string>() : new Set(entries.map((entry) => entry.id));
              setViewed(next);
              void AsyncStorage.setItem(viewedKey, JSON.stringify([...next]));
            }}
            style={[styles.summaryButton, { backgroundColor: theme.surfaceSoft }]}
          >
            <CheckCheck color={theme.muted} size={15} />
            <Text style={[styles.summaryButtonText, { color: theme.muted }]}>
              {viewedCount >= entries.length ? "Mark all unviewed" : "Mark all viewed"}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void Clipboard.setStringAsync(entries.map((entry) => entry.file).join("\n"))}
            style={[styles.summaryButton, { backgroundColor: theme.surfaceSoft }]}
          >
            <Copy color={theme.muted} size={15} />
            <Text style={[styles.summaryButtonText, { color: theme.muted }]}>Copy file list</Text>
          </Pressable>
          <Pressable
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
            <WrapText color={wrapped ? theme.accentOn : theme.muted} size={15} />
            <Text style={[styles.summaryButtonText, { color: wrapped ? theme.ink : theme.muted }]}>Wrap</Text>
          </Pressable>
        </View>
      </View>

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
        />
      )}

      {selection ? (
        <View style={[styles.selectionBar, { backgroundColor: theme.surface, borderTopColor: theme.line }]}>
          <View style={styles.selectionCopy}>
            <Text numberOfLines={1} style={[styles.selectionTitle, { color: theme.ink }]}>
              {selection.entry.file}
            </Text>
            <Text style={[styles.selectionMeta, { color: theme.muted }]}>
              Line {selection.line.newLine ?? selection.line.oldLine}
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
  viewSwitcherWrap: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 7 },
  viewSwitcher: { alignSelf: "center", minWidth: 210, borderRadius: 10, padding: 3, flexDirection: "row", gap: 3 },
  viewOption: { flex: 1, minHeight: 32, borderRadius: 8, borderWidth: 1, borderColor: "transparent", paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  viewOptionText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  viewBadge: { minWidth: 19, height: 19, borderRadius: 10, paddingHorizontal: 5, alignItems: "center", justifyContent: "center" },
  viewBadgeText: { fontFamily: "Inter_700Bold", fontSize: 9 },
  reviewSummary: { borderBottomWidth: 1, padding: 14, gap: 10 },
  summaryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryTitle: { fontFamily: "Inter_700Bold", fontSize: 14 },
  summaryMeta: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 4 },
  summaryStats: { flexDirection: "row", gap: 9 },
  summaryStat: { fontFamily: "Inter_700Bold", fontSize: 12 },
  progressTrack: { height: 4, borderRadius: 999, overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 999 },
  summaryActions: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  summaryButton: { borderRadius: 9, paddingHorizontal: 9, paddingVertical: 7, flexDirection: "row", alignItems: "center", gap: 6 },
  summaryButtonText: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
  error: { padding: 12 },
  files: { padding: 10, paddingBottom: 100, gap: 10 },
  file: { borderWidth: 1, borderRadius: 8, overflow: "hidden" },
  fileHeader: { minHeight: 58, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 7 },
  headerIcon: { width: 28, height: 36, alignItems: "center", justifyContent: "center" },
  fileCopy: { flex: 1, minWidth: 0 },
  filePath: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  fileMeta: { fontFamily: "Inter_400Regular", fontSize: 9, marginTop: 4, textTransform: "capitalize" },
  stat: { fontFamily: "Inter_700Bold", fontSize: 10 },
  viewedBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center", marginLeft: 3 },
  diffBody: { minWidth: 900, paddingVertical: 6 },
  diffBodyWrapped: { minWidth: 0, width: "100%" },
  diffRow: { height: 24, minWidth: 900, flexDirection: "row", alignItems: "center" },
  diffRowWrapped: { height: "auto", minHeight: 24, minWidth: 0, alignItems: "flex-start", paddingVertical: 3 },
  changeBar: { width: 3, height: "100%" },
  lineNumber: { width: 42, paddingRight: 8, textAlign: "right", fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 10 },
  marker: { width: 20, textAlign: "center", fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 11 },
  code: { flex: 1, fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 11, paddingRight: 20 },
  unavailable: { fontFamily: "Inter_400Regular", fontSize: 12, padding: 16 },
  showMore: { minHeight: 42, borderTopWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  showMoreText: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
  selectionBar: { position: "absolute", bottom: 0, left: 0, right: 0, borderTopWidth: 1, padding: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  selectionCopy: { flex: 1, minWidth: 0 },
  selectionTitle: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  selectionMeta: { fontFamily: "Inter_400Regular", fontSize: 9, marginTop: 3 },
});
