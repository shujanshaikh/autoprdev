import { useMemo } from "react";

import { DEFAULT_CODEX_REASONING_EFFORT, formatCodexModelLabel, formatReasoningEffort, type CodexReasoningEffort } from "../lib/codexModels";
import { MenuSheet, type MenuAnchor, type MenuOption } from "./MenuSheet";

const AUTO_MODEL_ID = "auto";

/**
 * The composer's two control pills each open their own menu, as they do in
 * T3 Code — one list of models, one list of reasoning levels — rather than a
 * single panel trying to present both at once.
 */

export function ModelMenu({
  visible,
  models,
  selectedModel,
  anchor,
  onSelectModel,
  onClose,
}: {
  visible: boolean;
  models: readonly string[];
  selectedModel: string | undefined;
  anchor?: MenuAnchor | null;
  onSelectModel: (model: string) => void;
  onClose: () => void;
}) {
  const options = useMemo<MenuOption[]>(() => {
    if (models.length === 0) {
      return [{ id: AUTO_MODEL_ID, label: "Auto model", selected: true }];
    }
    return models.map((model) => ({
      id: model,
      label: formatCodexModelLabel(model),
      selected: model === selectedModel,
    }));
  }, [models, selectedModel]);

  return (
    <MenuSheet
      anchor={anchor}
      onClose={onClose}
      onSelect={(id) => {
        if (id === AUTO_MODEL_ID && models.length === 0) return;
        onSelectModel(id);
      }}
      options={options}
      title="Model"
      visible={visible}
    />
  );
}

export function ReasoningMenu({
  visible,
  efforts,
  selectedEffort,
  anchor,
  onSelectEffort,
  onClose,
}: {
  visible: boolean;
  efforts: readonly CodexReasoningEffort[];
  selectedEffort: CodexReasoningEffort;
  anchor?: MenuAnchor | null;
  onSelectEffort: (effort: CodexReasoningEffort) => void;
  onClose: () => void;
}) {
  const options = useMemo<MenuOption[]>(
    () => efforts.map((effort) => ({
      id: effort,
      label: effort === DEFAULT_CODEX_REASONING_EFFORT
        ? `${formatReasoningEffort(effort)} (default)`
        : formatReasoningEffort(effort),
      selected: effort === selectedEffort,
    })),
    [efforts, selectedEffort],
  );

  return (
    <MenuSheet
      anchor={anchor}
      onClose={onClose}
      onSelect={(id) => onSelectEffort(/* SAFETY: Menu options are built exclusively from Codex reasoning effort identifiers. */ id as CodexReasoningEffort)}
      options={options}
      title="Reasoning"
      visible={visible}
    />
  );
}
