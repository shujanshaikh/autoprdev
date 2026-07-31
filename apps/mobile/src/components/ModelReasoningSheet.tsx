import { Modal, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "../hooks/useAppTheme";
import { ModelPickerPanel, type ModelPickerProps } from "./ModelPickerPanel";

type Props = ModelPickerProps & {
  visible: boolean;
  onClose: () => void;
};

export function ModelReasoningSheet({ visible, onClose, ...picker }: Props) {
  const theme = useAppTheme();

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.modal}>
        <Pressable
          accessibilityLabel="Close model picker"
          onPress={onClose}
          style={styles.backdrop}
        />
        <SafeAreaView edges={["bottom"]} style={[styles.sheet, { backgroundColor: theme.surfaceRaised }]}>
          <ModelPickerPanel {...picker} onClose={onClose} />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.38)" },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26 },
});
