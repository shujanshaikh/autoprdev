import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@autopr/ui/components/collapsible";
import { cn } from "@autopr/ui/lib/utils";
import { ChevronDown, FileCheck2 } from "lucide-react";

import { FileTypeIcon, pathParts } from "#/lib/file-type-icon";
import type { ThreadChangedFile } from "./thread-diff-panel-utils";

function ChangeCount({ additions, deletions }: Pick<ThreadChangedFile, "additions" | "deletions">) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[11px] tabular-nums">
      {additions > 0 ? (
        <span className="text-[color:var(--cohere-deep-green)] dark:text-[color:var(--cohere-pale-green)]">
          +{additions}
        </span>
      ) : null}
      {deletions > 0 ? (
        <span className="text-[color:var(--cohere-coral)]">−{deletions}</span>
      ) : null}
    </span>
  );
}

export function ThreadChangedFiles({
  files,
  onSelect,
}: {
  files: ThreadChangedFile[];
  onSelect: (file: ThreadChangedFile) => void;
}) {
  if (files.length === 0) return null;

  const label = `${files.length} ${files.length === 1 ? "file" : "files"} changed`;

  return (
    <Collapsible
      className="group/changed-files mt-4 overflow-hidden rounded-sm border border-border bg-card"
      defaultOpen
    >
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-3 text-left outline-none transition-colors hover:bg-[color:var(--project-panel-soft)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[color:var(--cohere-form-focus)]">
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]/changed-files:-rotate-90 motion-reduce:transition-none"
        />
        <FileCheck2 aria-hidden="true" className="size-4 shrink-0 text-[color:var(--project-selected-strong)]" />
        <span className="text-[13px] font-medium text-foreground/90">{label}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-1 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1 motion-reduce:animate-none">
        <div className="border-t border-border/70 px-1.5 py-1.5">
          {files.map((file) => {
            const { name, dir } = pathParts(file.entry.file);

            return (
              <button
                key={file.entry.file}
                type="button"
                title={`Open ${file.entry.file} in changes panel`}
                onClick={() => onSelect(file)}
                className={cn(
                  "group/file flex w-full min-w-0 items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-left",
                  "transition-colors hover:bg-[color:var(--project-panel-soft)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--cohere-form-focus)]",
                )}
              >
                <FileTypeIcon
                  file={file.entry.file}
                  className="size-4 shrink-0 text-muted-foreground/80 transition-colors group-hover/file:text-foreground"
                />
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5 font-mono text-[11px] leading-tight">
                  <span className="shrink-0 font-medium text-foreground/90">{name}</span>
                  {dir ? (
                    <span className="truncate text-[10px] text-muted-foreground/55">{dir}/</span>
                  ) : null}
                </span>
                <ChangeCount additions={file.additions} deletions={file.deletions} />
              </button>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
