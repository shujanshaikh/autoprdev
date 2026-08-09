import {
  SelectGroup,
  SelectItem,
  SelectLabel,
} from "@autopr/ui/components/select";

import { CodexLogo } from "#/components/icons/codex-logo";
import { GrokLogo } from "#/components/icons/grok-logo";
import type { AgentModelOption, AgentProvider } from "#/lib/agent-models";

const PROVIDERS: readonly AgentProvider[] = ["openai-codex", "xai"];

export function AgentModelSelectItems({
  models,
  compact = false,
}: {
  models: readonly AgentModelOption[];
  compact?: boolean;
}) {
  return PROVIDERS.map((provider) => {
    const providerModels = models.filter((model) => model.provider === provider);
    if (providerModels.length === 0) return null;

    return (
      <SelectGroup key={provider}>
        <SelectLabel>{provider === "xai" ? "SuperGrok" : "ChatGPT / Codex"}</SelectLabel>
        {providerModels.map((model) => (
          <SelectItem
            key={model.key}
            value={model.key}
            className={compact
              ? "rounded-[var(--radius-md)] py-1.5 pr-7 pl-2 text-xs"
              : "rounded-[var(--radius-lg)] py-2.5 pr-8 pl-2.5 text-sm"}
          >
            {model.provider === "xai"
              ? <GrokLogo className="size-4 shrink-0" />
              : <CodexLogo className="size-4 text-muted-foreground" />}
            <span className="min-w-0 truncate font-medium text-foreground/90">{model.label}</span>
          </SelectItem>
        ))}
      </SelectGroup>
    );
  });
}
