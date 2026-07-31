import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
} from "react-native";

import { useAppTheme } from "../hooks/useAppTheme";

export function PrimaryButton({
  label,
  icon: Icon,
  loading = false,
  compact = false,
  disabled,
  style,
  ...props
}: PressableProps & {
  label: string;
  icon?: LucideIcon;
  loading?: boolean;
  compact?: boolean;
}) {
  const theme = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: theme.accent, opacity: disabled ? 0.45 : pressed ? 0.78 : 1 },
        typeof style === "function" ? style({ pressed }) : style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={theme.accentInk} size="small" />
      ) : (
        <>
          {Icon ? <Icon color={theme.accentInk} size={17} strokeWidth={2.2} /> : null}
          <Text style={[styles.buttonText, { color: theme.accentInk }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  icon: Icon,
  destructive = false,
  compact = false,
  style,
  ...props
}: PressableProps & {
  label: string;
  icon?: LucideIcon;
  destructive?: boolean;
  compact?: boolean;
}) {
  const theme = useAppTheme();
  const color = destructive ? theme.danger : theme.ink;
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.secondaryButton,
        compact && styles.buttonCompact,
        {
          backgroundColor: pressed ? theme.surfaceSoft : theme.surface,
          borderColor: theme.line,
        },
        typeof style === "function" ? style({ pressed }) : style,
      ]}
      {...props}
    >
      {Icon ? <Icon color={color} size={17} strokeWidth={2} /> : null}
      <Text style={[styles.secondaryButtonText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  const theme = useAppTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.surfaceSoft }]}>
        <Icon color={theme.muted} size={23} />
      </View>
      <Text style={[styles.emptyTitle, { color: theme.ink }]}>{title}</Text>
      <Text style={[styles.emptyBody, { color: theme.muted }]}>{body}</Text>
      {action}
    </View>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  const theme = useAppTheme();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={theme.accentOn} />
      <Text style={[styles.loadingText, { color: theme.muted }]}>{label}</Text>
    </View>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  const theme = useAppTheme();
  return (
    <View style={[styles.notice, { backgroundColor: theme.dangerSoft, borderColor: theme.danger }]}>
      <Text style={[styles.noticeText, { color: theme.danger }]}>{message}</Text>
    </View>
  );
}

export function SectionLabel({ children }: { children: string }) {
  const theme = useAppTheme();
  return <Text style={[styles.sectionLabel, { color: theme.muted }]}>{children}</Text>;
}

export function StatusPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
}) {
  const theme = useAppTheme();
  const tones = {
    neutral: [theme.surfaceSoft, theme.muted],
    success: [theme.successSoft, theme.success],
    warning: [theme.warningSoft, theme.warning],
    danger: [theme.dangerSoft, theme.danger],
    accent: [theme.accentSoft, theme.ink],
  } as const;
  const [backgroundColor, color] = tones[tone];
  return (
    <View style={[styles.pill, { backgroundColor }]}>
      <Text numberOfLines={1} style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: 8,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 9,
  },
  buttonCompact: { minHeight: 38, borderRadius: 7, paddingHorizontal: 13 },
  buttonText: { fontFamily: "DMSans_700Bold", fontSize: 14 },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 9,
  },
  secondaryButtonText: { fontFamily: "DMSans_500Medium", fontSize: 14 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 5,
  },
  emptyTitle: { fontFamily: "DMSans_700Bold", fontSize: 18, textAlign: "center" },
  emptyBody: {
    maxWidth: 310,
    fontFamily: "DMSans_400Regular",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 10,
  },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  loadingText: { fontFamily: "DMSans_500Medium", fontSize: 13 },
  notice: { borderWidth: 1, borderRadius: 8, padding: 12 },
  noticeText: { fontFamily: "DMSans_500Medium", fontSize: 13, lineHeight: 18 },
  sectionLabel: {
    fontFamily: "DMSans_700Bold",
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 9,
  },
  pill: { maxWidth: 150, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 5 },
  pillText: { fontFamily: "DMSans_700Bold", fontSize: 10, letterSpacing: 0.2 },
});
