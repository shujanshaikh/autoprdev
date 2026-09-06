import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@autopr/ui/components/select";
import { Brain } from "lucide-react";

import {
  getCodexReasoningEffortLabel,
  type CodexReasoningEffort,
} from "#/lib/codex-models";

export function AgentReasoningPicker({
  efforts,
  value,
  onValueChange,
  disabled = false,
}: {
  efforts: readonly CodexReasoningEffort[];
  value: CodexReasoningEffort | undefined;
  onValueChange: (value: CodexReasoningEffort) => void;
  disabled?: boolean;
}) {
  if (efforts.length === 0) return null;

  const label = value ? getCodexReasoningEffortLabel(value) : "Default";

  return (
    <Select
      value={value}
      onValueChange={(nextValue) => {
        const effort = efforts.find((option) => option === nextValue);
        if (effort) onValueChange(effort);
      }}
    >
      <SelectTrigger
        size="sm"
        disabled={disabled}
        aria-label={`Reasoning effort, currently ${label}`}
        className="shrink-0 gap-1.5 border-0 bg-transparent px-1.5 text-xs font-medium text-muted-foreground shadow-none hover:bg-white/5 hover:text-white focus-visible:ring-1 focus-visible:ring-white/30 data-[size=sm]:h-7 dark:bg-transparent dark:hover:bg-white/5 [&_svg]:size-3.5"
      >
        <Brain aria-hidden="true" />
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent
        align="start"
        alignItemWithTrigger={false}
        side="top"
        sideOffset={8}
        className="w-44 rounded-xl border-white/10 bg-black p-1 text-white"
      >
        <div className="px-2 py-1.5 text-xs text-muted-foreground">Reasoning effort</div>
        {efforts.map((effort) => (
          <SelectItem key={effort} value={effort} className="rounded-md py-2 pl-2 pr-7 text-xs">
            {getCodexReasoningEffortLabel(effort)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
