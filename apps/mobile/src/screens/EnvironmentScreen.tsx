import { api } from "@autopr/backend/convex/_generated/api";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAction, useQuery } from "convex/react";
import { ClipboardPaste, Eye, EyeOff, KeyRound, Pencil, Plus, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { EmptyState, ErrorNotice, PrimaryButton, SectionLabel } from "../components/ui";
import { useAppTheme } from "../hooks/useAppTheme";
import { parseEnvFile } from "../lib/envFile";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Environment">;

export function EnvironmentScreen({ route }: Props) {
  const { projectId } = route.params;
  const theme = useAppTheme();
  const project = useQuery(api.projects.get, { projectId });
  const importVariables = useAction(api.projectActions.importSandboxEnvironmentVariables);
  const removeVariable = useAction(api.projectActions.removeSandboxEnvironmentVariable);
  const [envName, setEnvName] = useState("");
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [envFile, setEnvFile] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const variables = [
    ...(project?.sandboxEnvironmentVariables ?? []),
    ...(project?.sandboxSecrets ?? []).filter((secret) =>
      !(project?.sandboxEnvironmentVariables ?? []).some((variable) => variable.envName === secret.envName)),
  ];

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await importVariables({ projectId, entries: [{ envName: envName.trim(), value }] });
      setEnvName("");
      setValue("");
      setNotice(`${envName.trim()} was saved. Start a new process to read the updated value.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the variable.");
    } finally {
      setSaving(false);
    }
  };

  const importEnvFile = async () => {
    const parsed = parseEnvFile(envFile);
    if (parsed.errors.length > 0) {
      setError(parsed.errors.slice(0, 4).join(" "));
      return;
    }
    if (parsed.entries.length === 0) {
      setError("No environment variables were found. Paste NAME=value lines first.");
      return;
    }
    if (parsed.entries.length > 50) {
      setError("Import at most 50 variables at a time.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await importVariables({ projectId, entries: parsed.entries });
      setEnvFile("");
      setNotice(
        `${result.importedCount} ${result.importedCount === 1 ? "variable" : "variables"} saved`
        + `${parsed.duplicateNames.length > 0 ? "; the last duplicate value was kept" : ""}.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import the environment file.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { backgroundColor: theme.screen }]}>
      <View style={[styles.notice, { backgroundColor: theme.accentSoft }]}>
        <KeyRound color={theme.accentOn} size={18} />
        <Text style={[styles.noticeText, { color: theme.muted }]}>
          Values are stored in the Daytona sandbox environment, not the AutoPR database.
        </Text>
      </View>
      <SectionLabel>Paste a .env file</SectionLabel>
      <View style={[styles.form, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <View style={styles.pasteHeading}>
          <ClipboardPaste color={theme.muted} size={17} />
          <Text style={[styles.pasteText, { color: theme.muted }]}>
            Paste multiple NAME=value lines. Quoted and exported values are supported.
          </Text>
        </View>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          numberOfLines={6}
          onChangeText={setEnvFile}
          placeholder={"API_KEY=…\nDATABASE_URL=…"}
          placeholderTextColor={theme.faint}
          textAlignVertical="top"
          value={envFile}
          style={[styles.envFileInput, { color: theme.ink, backgroundColor: theme.code, borderColor: theme.codeLine }]}
        />
        <PrimaryButton
          icon={ClipboardPaste}
          label="Import variables"
          loading={saving}
          disabled={!envFile.trim()}
          onPress={() => void importEnvFile()}
        />
      </View>
      <SectionLabel>Add or rotate a variable</SectionLabel>
      <View style={[styles.form, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <TextInput
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="VARIABLE_NAME"
          placeholderTextColor={theme.faint}
          value={envName}
          onChangeText={setEnvName}
          style={[styles.input, { color: theme.ink, borderColor: theme.line }]}
        />
        <View style={[styles.valueRow, { borderColor: theme.line }]}>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Value"
            placeholderTextColor={theme.faint}
            secureTextEntry={!visible}
            value={value}
            onChangeText={setValue}
            style={[styles.valueInput, { color: theme.ink }]}
          />
          <Pressable accessibilityLabel={visible ? "Hide value" : "Show value"} onPress={() => setVisible((current) => !current)} style={styles.eye}>
            {visible ? <EyeOff color={theme.muted} size={18} /> : <Eye color={theme.muted} size={18} />}
          </Pressable>
        </View>
        {error ? <ErrorNotice message={error} /> : null}
        {notice ? (
          <View style={[styles.savedNotice, { backgroundColor: theme.successSoft }]}>
            <Text style={[styles.savedNoticeText, { color: theme.success }]}>{notice}</Text>
          </View>
        ) : null}
        <PrimaryButton
          icon={Plus}
          label="Save variable"
          loading={saving}
          disabled={!envName.trim() || !value}
          onPress={() => void save()}
        />
      </View>

      <SectionLabel>Mounted variables</SectionLabel>
      {variables.length === 0 ? (
        <View style={styles.empty}>
          <EmptyState icon={KeyRound} title="No variables mounted" body="Add a value above for new sandbox processes." />
        </View>
      ) : (
        <View style={[styles.list, { backgroundColor: theme.surface, borderColor: theme.line }]}>
          {variables.map((variable, index) => (
            <View
              key={variable.envName}
              style={[
                styles.row,
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
              ]}
            >
              <View style={styles.rowCopy}>
                <Text style={[styles.name, { color: theme.ink }]}>{variable.envName}</Text>
                <Text style={[styles.hidden, { color: theme.faint }]}>•••••••• · available to new processes</Text>
              </View>
              <Pressable
                accessibilityLabel={`Rotate ${variable.envName}`}
                onPress={() => {
                  setEnvName(variable.envName);
                  setValue("");
                  setVisible(false);
                  setNotice(`Enter a new value for ${variable.envName}.`);
                }}
                style={styles.trash}
              >
                <Pencil color={theme.muted} size={16} />
              </Pressable>
              <Pressable
                accessibilityLabel={`Delete ${variable.envName}`}
                onPress={() => Alert.alert(
                  `Delete ${variable.envName}?`,
                  "The variable will be removed from Daytona.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () => void removeVariable({ projectId, envName: variable.envName }),
                    },
                  ],
                )}
                style={styles.trash}
              >
                <Trash2 color={theme.danger} size={17} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: 16, paddingBottom: 36, gap: 12 },
  notice: { borderRadius: 8, padding: 13, flexDirection: "row", alignItems: "flex-start", gap: 9, marginBottom: 7 },
  noticeText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  form: { borderWidth: 1, borderRadius: 10, padding: 13, gap: 10, marginBottom: 12 },
  pasteHeading: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  pasteText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 17 },
  envFileInput: { minHeight: 126, maxHeight: 220, borderWidth: 1, borderRadius: 10, padding: 11, fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 11, lineHeight: 17 },
  savedNotice: { borderRadius: 9, padding: 10 },
  savedNoticeText: { fontFamily: "Inter_500Medium", fontSize: 11, lineHeight: 16 },
  input: { height: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 12 },
  valueRow: { height: 46, borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center" },
  valueInput: { flex: 1, paddingHorizontal: 12, fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 12 },
  eye: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  empty: { minHeight: 250 },
  list: { borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  row: { minHeight: 66, padding: 12, flexDirection: "row", alignItems: "center", gap: 9 },
  rowCopy: { flex: 1 },
  name: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 12, fontWeight: "600" },
  hidden: { fontFamily: "Inter_400Regular", fontSize: 10, marginTop: 5 },
  trash: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
});
