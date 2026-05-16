import { cn } from "@autopr/ui/lib/utils";
import { FileIcon, FolderIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import type { FileSuggestion } from "#/lib/file-suggestions";

interface FileSuggestionsDropdownProps {
  suggestions: FileSuggestion[];
  selectedIndex: number;
  onSelect: (suggestion: FileSuggestion) => void;
  isLoading?: boolean;
  isOpen?: boolean;
}

const MAX_VISIBLE_ITEMS = 10;

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
      <div className="absolute bottom-full left-0 right-0 z-50 mb-2 min-w-[320px] border border-border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-lg">
        Loading repository files…
      </div>
    );
  }

  if (suggestions.length === 0) {
    if (!isOpen) return null;

    return (
      <div className="absolute bottom-full left-0 right-0 z-50 mb-2 min-w-[320px] border border-border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-lg">
        No matching files found.
      </div>
    );
  }

  return (
    <div className="absolute bottom-full left-0 right-0 z-50 mb-2 min-w-[320px] overflow-hidden border border-border bg-popover shadow-lg">
      <div
        ref={listRef}
        className="overflow-y-auto py-1"
        style={{ maxHeight: `${MAX_VISIBLE_ITEMS * 34}px` }}
      >
        {suggestions.map((suggestion, index) => {
          const normalizedPath = suggestion.isDirectory
            ? suggestion.display.replace(/\/$/, "")
            : suggestion.display;
          const fileName = normalizedPath.split("/").pop() ?? normalizedPath;
          const dirPath = normalizedPath.slice(0, normalizedPath.length - fileName.length);

          return (
            <button
              key={suggestion.value}
              ref={index === selectedIndex ? selectedRef : null}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(suggestion)}
              className={cn(
                "flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm transition-colors",
                index === selectedIndex
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              )}
            >
              {suggestion.isDirectory ? (
                <FolderIcon className="size-4 shrink-0 text-amber-500" />
              ) : (
                <FileIcon className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                <span className="text-foreground">{fileName}</span>
                {dirPath ? <span className="ml-1 text-muted-foreground">{dirPath}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="whitespace-nowrap border-t border-border bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
        Tab/Enter to select · Esc to dismiss
      </div>
    </div>
  );
}
