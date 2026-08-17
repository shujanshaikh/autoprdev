import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@autopr/ui/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@autopr/ui/components/popover";
import { cn } from "@autopr/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { CodexLogo } from "#/components/icons/codex-logo";
import { GrokLogo } from "#/components/icons/grok-logo";
import { AGENT_PROVIDERS, formatAgentModelLabel, getAgentContextLimit, type AgentModelOption, type AgentProvider } from "#/lib/agent-models";

const PROVIDER_DETAILS = {
  "openai-codex": {
    label: "ChatGPT / Codex",
    shortLabel: "Codex",
  },
  xai: {
    label: "SuperGrok",
    shortLabel: "Grok",
  },
} satisfies Record<AgentProvider, { label: string; shortLabel: string }>;

export function AgentModelPicker({
  models,
  value,
  onValueChange,
  disabled = false,
  compact = false,
  triggerClassName,
}: {
  models: readonly AgentModelOption[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
  triggerClassName?: string;
}) {
  const selectedModel = models.find((model) => model.key === value);
  const availableProviders = AGENT_PROVIDERS.filter((provider) =>
    models.some((model) => model.provider === provider));
  const [requestedProvider, setRequestedProvider] = useState<AgentProvider | undefined>(
    selectedModel?.provider,
  );
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const activeProvider = requestedProvider && availableProviders.includes(requestedProvider)
    ? requestedProvider
    : selectedModel?.provider ?? availableProviders[0];
  const activeModels = activeProvider
    ? models.filter((model) => model.provider === activeProvider)
    : [];
  const selectedLabel = formatAgentModelLabel(selectedModel);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    setSearch("");
    if (nextOpen && selectedModel) setRequestedProvider(selectedModel.provider);
  }

  function selectProvider(provider: AgentProvider) {
    setRequestedProvider(provider);
    setSearch("");
  }

  function selectModel(model: AgentModelOption) {
    onValueChange(model.key);
    setOpen(false);
    setSearch("");
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        type="button"
        disabled={disabled}
        aria-label={`Choose model, currently ${selectedLabel}`}
        className={cn(
          "group/model-trigger inline-flex min-w-0 shrink items-center gap-1.5 rounded-[10px] text-muted-foreground transition-colors outline-none hover:bg-muted/65 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/45 disabled:cursor-not-allowed disabled:opacity-45",
          compact ? "h-7 max-w-44 px-1.5 text-xs font-medium" : "h-8 max-w-52 px-2 text-sm font-semibold",
          triggerClassName,
        )}
      >
        <ProviderLogo provider={selectedModel?.provider} className="size-4 shrink-0" />
        <span className="min-w-0 truncate">{selectedLabel}</span>
        <ChevronDown
          className="size-3.5 shrink-0 opacity-60 transition-transform group-aria-expanded/model-trigger:rotate-180"
          aria-hidden="true"
        />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="h-80 w-[min(23rem,calc(100vw-1.5rem))] overflow-hidden rounded-[var(--radius-xl)] p-0 shadow-xl"
      >
        <div className="flex size-full min-h-0">
          <div className="w-16 shrink-0 border-r border-border/70 bg-muted/35 p-1.5">
            <div className="flex h-full flex-col gap-1" role="group" aria-label="Model providers">
              {availableProviders.map((provider) => {
                const details = PROVIDER_DETAILS[provider];
                const active = provider === activeProvider;
                const modelCount = models.filter((model) => model.provider === provider).length;
                return (
                  <button
                    key={provider}
                    type="button"
                    aria-pressed={active}
                    aria-label={`${details.label}, ${modelCount} models`}
                    onClick={() => selectProvider(provider)}
                    className={cn(
                      "relative flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] font-medium text-muted-foreground outline-none transition-colors hover:bg-background/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/45",
                      active && "bg-background text-foreground shadow-sm",
                    )}
                  >
                    {active ? (
                      <span
                        aria-hidden="true"
                        className="absolute -right-1.5 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-l-full bg-primary"
                      />
                    ) : null}
                    <ProviderLogo provider={provider} className="size-5" />
                    <span className="max-w-full truncate">{details.shortLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <Command className="min-w-0 flex-1 rounded-none bg-popover">
            <div className="p-2 pb-0">
              <CommandInput
                value={search}
                onValueChange={setSearch}
                placeholder={`Search ${activeProvider ? PROVIDER_DETAILS[activeProvider].shortLabel : ""} models…`}
                className="h-8 text-sm"
              />
            </div>
            <CommandList className="max-h-none min-h-0 flex-1 px-2 pb-2 pt-1.5">
              <CommandEmpty className="px-4 py-10 text-center text-sm text-muted-foreground">
                No matching models
              </CommandEmpty>
              <CommandGroup
                heading={activeProvider
                  ? `${PROVIDER_DETAILS[activeProvider].label} · ${activeModels.length} models`
                  : "Models"}
                className="**:[[cmdk-group-heading]]:px-1 **:[[cmdk-group-heading]]:pb-2 **:[[cmdk-group-heading]]:pt-1 **:[[cmdk-group-heading]]:text-[10px] **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:uppercase **:[[cmdk-group-heading]]:tracking-[0.12em]"
              >
                {activeModels.map((model) => {
                  const selected = model.key === value;
                  return (
                    <CommandItem
                      key={model.key}
                      value={model.key}
                      keywords={[model.label, model.modelId, PROVIDER_DETAILS[model.provider].label]}
                      data-checked={selected ? "true" : "false"}
                      onSelect={() => selectModel(model)}
                      className="mb-0.5 min-h-12 rounded-lg px-2.5 py-2 data-selected:bg-muted/80"
                    >
                      <div className="min-w-0 flex-1 text-left">
                        <div className="truncate text-xs font-semibold leading-snug text-foreground">
                          {model.label}
                        </div>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] leading-none text-muted-foreground/75">
                          <ProviderLogo provider={model.provider} className="size-3 shrink-0" />
                          <span className="truncate">{PROVIDER_DETAILS[model.provider].label}</span>
                        </div>
                      </div>
                      <span className="shrink-0 rounded-md border border-border/70 bg-background/60 px-1.5 py-1 font-mono text-[9px] leading-none text-muted-foreground">
                        {formatContextLimit(getAgentContextLimit(model))}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ProviderLogo({
  provider,
  className,
}: {
  provider?: AgentProvider;
  className?: string;
}) {
  if (provider === "xai") return <GrokLogo className={className} />;
  return <CodexLogo className={cn("text-muted-foreground", className)} />;
}

function formatContextLimit(limit: number) {
  return limit >= 1_000_000
    ? `${Math.round(limit / 100_000) / 10}M ctx`
    : `${Math.round(limit / 1000)}K ctx`;
}
