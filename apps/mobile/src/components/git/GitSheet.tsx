import type { LucideIcon } from "lucide-react-native";
import { ChevronRight } from "lucide-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "../../hooks/useAppTheme";

/**
 * Sheet primitives for the Git surfaces, following the T3 Code mobile layout:
 * one rounded card holding icon rows, meta cards for read-only facts, and a
 * pair of wide uppercase action buttons at the foot of a form.
 */

export function GitCard({ children }: { children: ReactNode }) {
  const theme = useAppTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.line }]}>
      {children}
    </View>
  );
}

export function GitRow({
  icon: Icon,
  title,
  subtitle,
  disabled = false,
  first = false,
  onPress,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  disabled?: boolean;
  first?: boolean;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  return (
    <View>
      {first ? null : <View style={[styles.rowDivider, { backgroundColor: theme.line }]} />}
      <Pressable
        accessibilityHint={disabled ? subtitle : undefined}
        accessibilityLabel={title}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: pressed ? theme.surfaceSoft : "transparent", opacity: disabled ? 0.45 : 1 },
        ]}
      >
        <View style={[styles.rowIcon, { backgroundColor: theme.surfaceSoft }]}>
          <Icon color={theme.ink} size={16} />
        </View>
        <View style={styles.rowCopy}>
          <Text style={[styles.rowTitle, { color: theme.ink }]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.rowSubtitle, { color: theme.muted }]}>{subtitle}</Text>
          ) : null}
        </View>
        <ChevronRight color={theme.faint} size={15} />
      </Pressable>
    </View>
  );
}

export function GitMetaCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warning";
}) {
  const theme = useAppTheme();
  return (
    <View style={[styles.metaCard, { backgroundColor: theme.surface, borderColor: theme.line }]}>
      <Text style={[styles.metaLabel, { color: theme.muted }]}>{label}</Text>
      <Text
        numberOfLines={1}
        selectable
        style={[styles.metaValue, { color: tone === "warning" ? theme.warning : theme.ink }]}
      >
        {value}
      </Text>
    </View>
  );
}

/** A label/value pair on one line, for facts that read better inline. */
export function GitInlineMeta({ label, value }: { label: string; value: string }) {
  const theme = useAppTheme();
  return (
    <View style={[styles.inlineMeta, { backgroundColor: theme.surface, borderColor: theme.line }]}>
      <Text style={[styles.inlineMetaLabel, { color: theme.muted }]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.inlineMetaValue, { color: theme.ink }]}>{value}</Text>
    </View>
  );
}

export function GitActionButton({
  icon: Icon,
  label,
  tone = "secondary",
  disabled = false,
  loading = false,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  tone?: "primary" | "secondary";
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  const isPrimary = tone === "primary";
  const color = isPrimary ? theme.accentInk : theme.ink;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: isPrimary ? theme.accent : theme.surface,
          borderColor: isPrimary ? theme.accent : theme.line,
          opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
        },
      ]}
    >
      {loading
        ? <ActivityIndicator color={color} size="small" />
        : <Icon color={color} size={15} strokeWidth={2.2} />}
      <Text style={[styles.actionButtonText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function GitSectionTitle({ children }: { children: string }) {
  const theme = useAppTheme();
  return <Text style={[styles.sectionTitle, { color: theme.muted }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, overflow: "hidden" },
  rowDivider: { height: StyleSheet.hairlineWidth, marginLeft: 48 },
  row: { minHeight: 62, paddingVertical: 11, flexDirection: "row", alignItems: "center", gap: 12 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontFamily: "DMSans_700Bold", fontSize: 16, letterSpacing: -0.3 },
  rowSubtitle: { fontFamily: "DMSans_400Regular", fontSize: 12, lineHeight: 17 },
  metaCard: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 12, gap: 3 },
  metaLabel: { fontFamily: "DMSans_700Bold", fontSize: 10, letterSpacing: 0.9, textTransform: "uppercase" },
  metaValue: { fontFamily: "DMSans_500Medium", fontSize: 13 },
  inlineMeta: {
    minHeight: 52,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  inlineMetaLabel: { fontFamily: "DMSans_400Regular", fontSize: 13 },
  inlineMetaValue: { flexShrink: 1, fontFamily: "DMSans_700Bold", fontSize: 15, letterSpacing: -0.3 },
  actionButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  actionButtonText: {
    flexShrink: 1,
    fontFamily: "DMSans_700Bold",
    fontSize: 12,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  sectionTitle: {
    paddingHorizontal: 4,
    fontFamily: "DMSans_700Bold",
    fontSize: 10,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
});
