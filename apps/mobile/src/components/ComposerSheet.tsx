import { ArrowUp, ChevronDown, ImagePlus } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppTheme } from "../hooks/useAppTheme";
import { formatCodexModelLabel, formatReasoningEffort } from "../lib/codexModels";
import { ModelPickerPanel, type ModelPickerProps } from "./ModelPickerPanel";
import { OpenAIIcon } from "./OpenAIIcon";

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  placeholder: string;
  value: string;
  editable?: boolean;
  canSend: boolean;
  sending?: boolean;
  picker: ModelPickerProps;
  attachments?: ReactNode;
  onChangeText: (value: string) => void;
  onAddImage?: () => void;
  onClose: () => void;
  onSend: () => void;
};

/**
 * Full-screen writing surface. The inline composers are only a preview: tapping
 * one opens this sheet so the keyboard never squeezes the typing area, and
 * "Done" hands the draft back to the screen underneath.
 */
export function ComposerSheet({
  visible,
  title,
  subtitle,
  placeholder,
  value,
  editable = true,
  canSend,
  sending = false,
  picker,
  attachments,
  onChangeText,
  onAddImage,
  onClose,
  onSend,
}: Props) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerAnimationRef = useRef<Animated.Value | null>(null);
  if (pickerAnimationRef.current === null) {
    pickerAnimationRef.current = new Animated.Value(0);
  }
  const pickerAnimation = pickerAnimationRef.current;

  useEffect(() => {
    if (!pickerOpen) {
      pickerAnimation.setValue(0);
      return;
    }
    const animation = Animated.timing(pickerAnimation, {
      toValue: 1,
      duration: 190,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [pickerAnimation, pickerOpen]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const shown = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hidden = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  const focusInput = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), Platform.OS === "ios" ? 90 : 40);
  }, []);

  const close = useCallback(() => {
    Keyboard.dismiss();
    setPickerOpen(false);
    onClose();
  }, [onClose]);

  const send = useCallback(() => {
    Keyboard.dismiss();
    setPickerOpen(false);
    onClose();
    onSend();
  }, [onClose, onSend]);

  const openPicker = useCallback(() => {
    Keyboard.dismiss();
    setPickerOpen(true);
  }, []);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    focusInput();
  }, [focusInput]);

  return (
    <Modal
      animationType="slide"
      onRequestClose={close}
      onShow={focusInput}
      presentationStyle="fullScreen"
      visible={visible}
    >
      <View style={[styles.screen, { backgroundColor: theme.screen }]}>
        <View style={[styles.header, { borderBottomColor: theme.line, paddingTop: insets.top }]}>
          <View style={styles.headerCopy}>
            <Text numberOfLines={1} style={[styles.title, { color: theme.ink }]}>{title}</Text>
            {subtitle ? (
              <Text numberOfLines={1} style={[styles.subtitle, { color: theme.muted }]}>{subtitle}</Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done typing"
            onPress={close}
            style={({ pressed }) => [
              styles.done,
              { backgroundColor: theme.surfaceSoft, borderColor: theme.line, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={[styles.doneText, { color: theme.ink }]}>Done</Text>
          </Pressable>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={0}
          style={styles.body}
        >
          <TextInput
            ref={inputRef}
            accessibilityLabel={title}
            editable={editable}
            multiline
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={theme.faint}
            scrollEnabled
            style={[styles.input, { color: theme.ink }]}
            textAlignVertical="top"
            value={value}
          />

          {attachments}

          <View
            style={[
              styles.toolbar,
              {
                borderTopColor: theme.line,
                paddingBottom: keyboardVisible ? 10 : 10 + insets.bottom,
              },
            ]}
          >
            {onAddImage ? (
              <Pressable
                accessibilityLabel="Add photos"
                disabled={!editable}
                onPress={onAddImage}
                style={({ pressed }) => [
                  styles.toolButton,
                  { backgroundColor: theme.surfaceSoft, opacity: pressed || !editable ? 0.6 : 1 },
                ]}
              >
                <ImagePlus color={theme.muted} size={18} />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel="Select model and reasoning effort"
              accessibilityRole="button"
              onPress={openPicker}
              style={({ pressed }) => [
                styles.modelChip,
                { backgroundColor: pressed ? theme.surface : theme.surfaceSoft, borderColor: theme.line },
              ]}
            >
              <OpenAIIcon size={14} />
              <Text numberOfLines={1} style={[styles.modelChipText, { color: theme.muted }]}>
                {formatCodexModelLabel(picker.selectedModel)}
                {" · "}
                {formatReasoningEffort(picker.selectedReasoningEffort)}
              </Text>
              <ChevronDown color={theme.faint} size={13} />
            </Pressable>
            <Pressable
              accessibilityLabel="Send prompt"
              disabled={!canSend || sending}
              onPress={send}
              style={[
                styles.send,
                { backgroundColor: theme.accent, opacity: !canSend || sending ? 0.35 : 1 },
              ]}
            >
              {sending
                ? <ActivityIndicator color={theme.accentInk} size="small" />
                : <ArrowUp color={theme.accentInk} size={19} strokeWidth={2.6} />}
            </Pressable>
          </View>
        </KeyboardAvoidingView>

        {pickerOpen ? (
          <View style={styles.pickerOverlay}>
            <Animated.View style={[styles.pickerBackdrop, { opacity: pickerAnimation }]}>
              <Pressable
                accessibilityLabel="Close model picker"
                onPress={closePicker}
                style={styles.pickerBackdropFill}
              />
            </Animated.View>
            <Animated.View
              style={[
                styles.pickerCard,
                {
                  marginBottom: Math.max(insets.bottom, 10) + 58,
                  opacity: pickerAnimation,
                  transform: [
                    {
                      translateY: pickerAnimation.interpolate({
                        inputRange: [0, 1],
                        outputRange: [12, 0],
                      }),
                    },
                    {
                      scale: pickerAnimation.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.98, 1],
                      }),
                    },
                  ],
                },
              ]}
            >
              <ModelPickerPanel {...picker} onClose={closePicker} />
            </Animated.View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    minHeight: 56,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontFamily: "DMSans_700Bold", fontSize: 17, letterSpacing: -0.4 },
  subtitle: { fontFamily: "DMSans_400Regular", fontSize: 11, marginTop: 2 },
  done: {
    minHeight: 34,
    borderRadius: 17,
    borderWidth: 1,
    paddingHorizontal: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  doneText: { fontFamily: "DMSans_500Medium", fontSize: 13 },
  body: { flex: 1 },
  input: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    fontFamily: "DMSans_400Regular",
    fontSize: 17,
    lineHeight: 25,
  },
  toolbar: {
    minHeight: 56,
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  toolButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  modelChip: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  modelChipText: { flex: 1, minWidth: 0, fontFamily: "DMSans_500Medium", fontSize: 11 },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  pickerOverlay: {
    position: "absolute",
    inset: 0,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  pickerBackdrop: { position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.22)" },
  pickerBackdropFill: { flex: 1 },
  pickerCard: { width: "100%", maxWidth: 390 },
});
