import { ArrowUp, CircleStop, Plus, SlidersHorizontal } from "lucide-react-native";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { useAppTheme } from "../hooks/useAppTheme";
import {
  ComposerToolbarButton,
  ComposerToolbarRow,
  ComposerToolbarScroller,
} from "./ComposerToolbar";
import { GlassSurface } from "./GlassSurface";
import { OpenAIIcon } from "./OpenAIIcon";

const COLLAPSED_RADIUS = 26;
const EXPANDED_RADIUS = 28;

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  editable?: boolean;
  /** Attachment strip, rendered inside the card above the text. */
  attachments?: ReactNode;
  hasAttachments?: boolean;
  modelLabel: string;
  reasoningLabel: string;
  onPressModel: () => void;
  onPressReasoning: () => void;
  onAddImage?: () => void;
  canSend: boolean;
  sending?: boolean;
  onSend: () => void;
  showStop?: boolean;
  stopping?: boolean;
  onStop?: () => void;
  /** Keeps the card and toolbar open even when the composer is empty. */
  alwaysExpanded?: boolean;
  autoFocus?: boolean;
};

/**
 * The thread composer: a text card that grows into a full editing surface with
 * its own control toolbar underneath, following the T3 Code mobile layout.
 *
 * Typing happens in place — an earlier version opened a full-screen sheet,
 * which put a modal between the user and a one-line follow-up.
 */
export function Composer({
  value,
  onChangeText,
  placeholder,
  editable = true,
  attachments,
  hasAttachments = false,
  modelLabel,
  reasoningLabel,
  onPressModel,
  onPressReasoning,
  onAddImage,
  canSend,
  sending = false,
  onSend,
  showStop = false,
  stopping = false,
  onStop,
  alwaysExpanded = false,
  autoFocus = false,
}: Props) {
  const theme = useAppTheme();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const expanded = alwaysExpanded || focused || value.length > 0 || hasAttachments;

  const send = useCallback(() => {
    onSend();
    inputRef.current?.blur();
  }, [onSend]);

  const sendControl = showStop ? (
    <ComposerToolbarButton
      accessibilityLabel="Stop agent"
      icon={CircleStop}
      loading={stopping}
      onPress={() => onStop?.()}
      variant="danger"
    />
  ) : (
    <ComposerToolbarButton
      accessibilityLabel="Send message"
      disabled={!canSend}
      icon={ArrowUp}
      loading={sending}
      onPress={send}
      variant="primary"
    />
  );

  const input = (
    <TextInput
      accessibilityLabel={placeholder}
      autoFocus={autoFocus}
      editable={editable}
      multiline
      onBlur={() => setFocused(false)}
      onChangeText={onChangeText}
      onFocus={() => setFocused(true)}
      placeholder={placeholder}
      placeholderTextColor={theme.faint}
      ref={inputRef}
      scrollEnabled={expanded}
      style={[
        styles.input,
        expanded ? styles.inputExpanded : styles.inputCollapsed,
        { color: theme.ink },
      ]}
      textAlignVertical={expanded ? "top" : "center"}
      value={value}
    />
  );

  if (!expanded) {
    return (
      <GlassSurface
        interactive
        radius={COLLAPSED_RADIUS}
        style={[styles.collapsedSurface, { borderColor: theme.line }]}
      >
        <View style={styles.collapsedInput}>{input}</View>
        {sendControl}
      </GlassSurface>
    );
  }

  return (
    <View>
      <GlassSurface
        interactive
        radius={EXPANDED_RADIUS}
        style={[styles.expandedSurface, { borderColor: theme.line }]}
      >
        {attachments}
        {input}
      </GlassSurface>

      <ComposerToolbarRow>
        <ComposerToolbarScroller fadeColor={theme.screen}>
          {onAddImage ? (
            <ComposerToolbarButton
              accessibilityLabel="Add photos"
              disabled={!editable}
              icon={Plus}
              onPress={onAddImage}
            />
          ) : null}
          <ComposerToolbarButton
            accessibilityLabel="Select model"
            chevron
            iconNode={<OpenAIIcon size={16} />}
            label={modelLabel}
            onPress={onPressModel}
          />
          <ComposerToolbarButton
            accessibilityLabel="Select reasoning effort"
            chevron
            icon={SlidersHorizontal}
            label={reasoningLabel}
            onPress={onPressReasoning}
          />
        </ComposerToolbarScroller>
        {sendControl}
      </ComposerToolbarRow>
    </View>
  );
}

const styles = StyleSheet.create({
  collapsedSurface: {
    minHeight: 52,
    borderWidth: 1,
    paddingLeft: 18,
    paddingRight: 5,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  collapsedInput: { flex: 1, minWidth: 0 },
  expandedSurface: { borderWidth: 1, paddingHorizontal: 18, paddingVertical: 14 },
  input: { fontFamily: "DMSans_400Regular", fontSize: 16, lineHeight: 22 },
  inputCollapsed: { height: 38, paddingVertical: 0 },
  inputExpanded: { minHeight: 84, maxHeight: 168, paddingVertical: 0 },
});
