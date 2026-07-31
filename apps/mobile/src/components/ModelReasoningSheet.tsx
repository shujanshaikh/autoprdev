import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ModelPickerPanel, type ModelPickerProps } from "./ModelPickerPanel";

type Props = ModelPickerProps & {
  visible: boolean;
  onClose: () => void;
};

/** Floating above-composer menu for screens that do not already own an overlay. */
export function ModelReasoningSheet({ visible, onClose, ...picker }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View
        style={[
          styles.modal,
          { paddingBottom: Math.max(insets.bottom, 10) + 64 },
        ]}
      >
        <Pressable
          accessibilityLabel="Close model picker"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View style={styles.popover}>
          <ModelPickerPanel {...picker} onClose={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  backdrop: { position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.22)" },
  popover: { width: "100%", maxWidth: 390 },
});
