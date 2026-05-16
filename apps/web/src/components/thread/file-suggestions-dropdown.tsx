import { cn } from "@autopr/ui/lib/utils";
import { FolderIcon, Loader2, SearchX } from "lucide-react";
import { useEffect, useRef } from "react";

import type { FileSuggestion } from "#/lib/file-suggestions";
import { FileTypeIcon, pathParts } from "#/lib/file-type-icon";

interface FileSuggestionsDropdownProps {
  suggestions: FileSuggestion[];
  selectedIndex: number;
  onSelect: (suggestion: FileSuggestion) => void;
  isLoading?: boolean;
  isOpen?: boolean;
}

const MAX_VISIBLE_ITEMS = 10;
const ITEM_HEIGHT = 30;

const SHELL_CLASS =
  "absolute bottom-full left-0 right-0 z-50 mb-2 min-w-[340px] overflow-hidden border border-border/70 bg-popover/95 shadow-[0_12px_30px_-16px_rgba(0,0,0,0.55)] backdrop-blur-md";

function DropdownStatusFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className={SHELL_CLASS}>
      <div className="flex h-7 items-center justify-between border-b border-border/55 bg-muted/35 px-2.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/85">
        <span>files</span>
        <span aria-hidden="true" className="size-1 bg-muted-foreground/40" />
      </div>
      <div className="flex items-center gap-2 px-3 py-3 font-mono text-[11px] text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

export function FileSuggestionsDropdown({
  suggestions,
  selectedIndex,
  onSelect,
  isLoading,
  isOpen,
}: FileSuggestionsDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (isLoading) {
    return (
      <DropdownStatusFrame>
        <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground/70" aria-hidden="true" />
        <span>Indexing repository…</span>
      </DropdownStatusFrame>
    );
  }

  if (suggestions.length === 0) {
    if (!isOpen) return null;

    return (
      <DropdownStatusFrame>
        <SearchX className="size-3 shrink-0 text-muted-foreground/70" aria-hidden="true" />
        <span>No matching files.</span>
      </DropdownStatusFrame>
    );
  }

  const total = suggestions.length;

  return (
    <div className={SHELL_CLASS}>
      <div className="flex h-7 items-center justify-between border-b border-border/55 bg-muted/35 px-2.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/85">
        <span>files</span>
        <span className="tabular-nums text-muted-foreground/70">
          {String(total).padStart(2, "0")}
        </span>
      </div>

      <div
        ref={listRef}
        className="minimal-scrollbar overflow-y-auto py-0.5"
        style={{ maxHeight: `${MAX_VISIBLE_ITEMS * ITEM_HEIGHT}px` }}
      >
        {suggestions.map((suggestion, index) => {
          const { name, dir } = pathParts(suggestion.display);
          const selected = index === selectedIndex;

          return (
            <button
              key={suggestion.value}
              ref={selected ? selectedRef : null}
              type="button"
              role="option"
              aria-selected={selected}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(suggestion)}
              className={cn(
                "group/item relative flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-[12px] transition-colors",
                selected
                  ? "bg-foreground/[0.06] text-foreground"
                  : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-y-1 left-0 w-0.5 transition-colors",
                  selected ? "bg-primary" : "bg-transparent group-hover/item:bg-border/60",
                )}
              />

              <span className="flex size-3.5 shrink-0 items-center justify-center">
                {suggestion.isDirectory ? (
                  <FolderIcon className="size-3.5 text-amber-500/85" aria-hidden="true" />
                ) : (
                  <FileTypeIcon file={name} className="size-3.5" />
                )}
              </span>

              <span
                className={cn(
                  "truncate",
                  selected ? "text-foreground" : "text-foreground/85",
                )}
              >
                {name}
                {suggestion.isDirectory ? <span className="text-muted-foreground/55">/</span> : null}
              </span>

              {dir ? (
                <span className="ml-auto truncate pl-3 text-[11px] text-muted-foreground/55">
                  {dir}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 whitespace-nowrap border-t border-border/55 bg-muted/30 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/75">
        <span className="flex items-center gap-1.5">
          <kbd className="border border-border/60 bg-background/70 px-1 leading-none">↑</kbd>
          <kbd className="border border-border/60 bg-background/70 px-1 leading-none">↓</kbd>
          <span className="text-muted-foreground/65">navigate</span>
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="border border-border/60 bg-background/70 px-1 leading-none">tab</kbd>
          <kbd className="border border-border/60 bg-background/70 px-1 leading-none">↵</kbd>
          <span className="text-muted-foreground/65">select</span>
          <span aria-hidden="true" className="text-muted-foreground/40">·</span>
          <kbd className="border border-border/60 bg-background/70 px-1 leading-none">esc</kbd>
          <span className="text-muted-foreground/65">dismiss</span>
        </span>
      </div>
    </div>
  );
}
