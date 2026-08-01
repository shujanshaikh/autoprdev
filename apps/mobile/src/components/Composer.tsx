import { ArrowUp, CircleStop, Plus, SlidersHorizontal } from "lucide-react-native";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { useAppTheme } from "../hooks/useAppTheme";
import {
  ComposerToolbarButton,
  ComposerToolbarRow,
  ComposerToolbarScroller,
} from "./ComposerToolbar";
import { GlassSurface } from "./GlassSurface";
import type { MenuAnchor } from "./MenuSheet";
import { OpenAIIcon } from "./OpenAIIcon";

const COLLAPSED_RADIUS = 26;
const EXPANDED_RADIUS = 28;
const LINE_HEIGHT = 22;

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
  /** Receives where the pill sits, so its menu can open anchored to it. */
  onPressModel: (anchor: MenuAnchor) => void;
  onPressReasoning: (anchor: MenuAnchor) => void;
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
 * Collapsed and expanded render one tree with different styles rather than two
 * different trees. Branching on the shape would put the text field at a
 * different position on each side, so React would unmount it the instant focus
 * expanded the composer — costing the tap that opened the keyboard.
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
  const modelPillRef = useRef<View>(null);
  const reasoningPillRef = useRef<View>(null);
  const [focused, setFocused] = useState(false);
  const expanded = alwaysExpanded || focused || value.length > 0 || hasAttachments;

  const focusInput = useCallback(() => {
    if (editable) inputRef.current?.focus();
  }, [editable]);

  const send = useCallback(() => {
    onSend();
    inputRef.current?.blur();
  }, [onSend]);

  const openAnchoredMenu = useCallback((
    pill: View | null,
    open: (anchor: MenuAnchor) => void,
  ) => {
    pill?.measureInWindow((x, y, width, height) => open({ x, y, width, height }));
  }, []);

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

  return (
    <View>
      <GlassSurface
        interactive
        radius={expanded ? EXPANDED_RADIUS : COLLAPSED_RADIUS}
        style={[
          styles.surface,
          expanded ? styles.surfaceExpanded : styles.surfaceCollapsed,
          { borderColor: theme.line },
        ]}
      >
        {attachments}
        {/* Tapping the padding around the field should also start typing. */}
        <Pressable
          accessible={false}
          onPress={focusInput}
          style={expanded ? styles.inputAreaExpanded : styles.inputAreaCollapsed}
        >
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
          {expanded ? null : sendControl}
        </Pressable>
      </GlassSurface>

      {expanded ? (
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
            <View collapsable={false} ref={modelPillRef}>
              <ComposerToolbarButton
                accessibilityLabel="Select model"
                chevron
                iconNode={<OpenAIIcon size={16} />}
                label={modelLabel}
                onPress={() => openAnchoredMenu(modelPillRef.current, onPressModel)}
              />
            </View>
            <View collapsable={false} ref={reasoningPillRef}>
              <ComposerToolbarButton
                accessibilityLabel="Select reasoning effort"
                chevron
                icon={SlidersHorizontal}
                label={reasoningLabel}
                onPress={() => openAnchoredMenu(reasoningPillRef.current, onPressReasoning)}
              />
            </View>
          </ComposerToolbarScroller>
          {sendControl}
        </ComposerToolbarRow>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { borderWidth: 1 },
  surfaceCollapsed: { minHeight: 54, paddingLeft: 18, paddingRight: 5, paddingVertical: 5 },
  surfaceExpanded: { paddingHorizontal: 18, paddingVertical: 14 },
  inputAreaCollapsed: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
  inputAreaExpanded: { minWidth: 0 },
  input: { minWidth: 0, fontFamily: "DMSans_400Regular", fontSize: 16, lineHeight: LINE_HEIGHT },
  // A multiline field lays its text out from the top on iOS, where
  // textAlignVertical does nothing. Sizing the collapsed field to exactly one
  // line lets the surrounding row do the centring instead.
  inputCollapsed: { flex: 1, height: LINE_HEIGHT, paddingTop: 0, paddingBottom: 0 },
  inputExpanded: { minHeight: 84, maxHeight: 168, paddingTop: 0, paddingBottom: 0 },
});
