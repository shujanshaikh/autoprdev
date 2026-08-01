import { useMemo } from "react";

import {
  describeReasoningEffort,
  formatCodexContextLimit,
  formatCodexModelLabel,
  formatReasoningEffort,
  type CodexReasoningEffort,
} from "../lib/codexModels";
import { MenuSheet, type MenuOption } from "./MenuSheet";

/**
 * The composer's two control pills each open their own menu, as they do in
 * T3 Code — one list of models, one list of reasoning levels — rather than a
 * single panel trying to present both at once.
 */

export function ModelMenu({
  visible,
  models,
  selectedModel,
  onSelectModel,
  onClose,
}: {
  visible: boolean;
  models: readonly string[];
  selectedModel: string | undefined;
  onSelectModel: (model: string) => void;
  onClose: () => void;
}) {
  const options = useMemo<MenuOption[]>(() => {
    if (models.length === 0) {
      return [{
        id: "auto",
        label: "Auto model",
        description: "Codex will choose an available model.",
        selected: true,
      }];
    }
    return models.map((model) => ({
      id: model,
      label: formatCodexModelLabel(model),
      trailing: formatCodexContextLimit(model),
      selected: model === selectedModel,
    }));
  }, [models, selectedModel]);

  return (
    <MenuSheet
      onClose={onClose}
      onSelect={onSelectModel}
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
  onSelectEffort,
  onClose,
}: {
  visible: boolean;
  efforts: readonly CodexReasoningEffort[];
  selectedEffort: CodexReasoningEffort;
  onSelectEffort: (effort: CodexReasoningEffort) => void;
  onClose: () => void;
}) {
  const options = useMemo<MenuOption[]>(
    () => efforts.map((effort) => ({
      id: effort,
      label: formatReasoningEffort(effort),
      description: describeReasoningEffort(effort),
      selected: effort === selectedEffort,
    })),
    [efforts, selectedEffort],
  );

  return (
    <MenuSheet
      onClose={onClose}
      onSelect={(id) => onSelectEffort(id as CodexReasoningEffort)}
      options={options}
      title="Reasoning effort"
      visible={visible}
    />
  );
}
