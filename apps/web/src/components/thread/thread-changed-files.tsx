import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@autopr/ui/components/collapsible";
import { cn } from "@autopr/ui/lib/utils";
import { ChevronRight } from "lucide-react";

import { FileTypeIcon, pathParts } from "#/lib/file-type-icon";
import type {
  ThreadChangedFile,
  ThreadChangedFileSummary,
} from "./thread-diff-panel-utils";

function ChangeCount({
  additions,
  deletions,
  className,
}: Pick<ThreadChangedFileSummary, "additions" | "deletions"> & { className?: string }) {
  if (additions === 0 && deletions === 0) return null;

  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 font-mono text-[10px] tabular-nums leading-none",
        className,
      )}
    >
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

/** Keep long absolute paths readable: last 2 segments only. */
function shortDir(dir: string) {
  if (!dir) return "";
  const parts = dir.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return parts.join("/");
  return parts.slice(-2).join("/");
}

export function ThreadChangedFiles({
  files,
  onSelect,
}: {
  files: ThreadChangedFileSummary[];
  onSelect: (file: ThreadChangedFile) => void;
}) {
  if (files.length === 0) return null;

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
  const label = `${files.length} ${files.length === 1 ? "file" : "files"} changed`;

  return (
    <Collapsible className="group/changed-files mt-3" defaultOpen>
      <CollapsibleTrigger
        className={cn(
          "flex w-full cursor-pointer items-center gap-1.5 rounded-sm py-1 text-left outline-none",
          "text-muted-foreground transition-colors hover:text-foreground/85",
          "focus-visible:ring-1 focus-visible:ring-[color:var(--cohere-form-focus)]",
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className="size-3 shrink-0 opacity-50 transition-transform duration-200 group-data-open/changed-files:rotate-90 motion-reduce:transition-none"
        />
        <span className="text-[12px] font-medium tracking-tight">{label}</span>
        <ChangeCount
          additions={totalAdditions}
          deletions={totalDeletions}
          className="ml-0.5 opacity-80"
        />
      </CollapsibleTrigger>

      <CollapsibleContent
        className={cn(
          "overflow-hidden outline-none",
          "data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-top-1",
          "data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-top-1",
          "motion-reduce:animate-none",
        )}
      >
        <ul className="mt-1 flex flex-col gap-px border-l border-border/40 py-0.5 pl-2.5 ml-[5px]">
          {files.map((file) => {
            const { name, dir } = pathParts(file.file);
            const displayDir = shortDir(dir);
            const selectableFile = file.changedFile;
            const content = (
              <>
                <FileTypeIcon
                  file={file.file}
                  className="size-3.5 shrink-0 opacity-70 transition-opacity group-hover/file:opacity-100"
                />
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5 font-mono text-[11px] leading-none tracking-tight">
                  <span className="shrink-0 text-foreground/90">{name}</span>
                  {displayDir ? (
                    <span className="truncate text-[10px] text-muted-foreground/50">
                      {displayDir}
                    </span>
                  ) : null}
                </span>
                <ChangeCount
                  additions={file.additions}
                  deletions={file.deletions}
                />
              </>
            );

            return (
              <li key={file.file}>
                {selectableFile ? (
                  <button
                    type="button"
                    title={`Open ${file.file} in changes panel`}
                    onClick={() => onSelect(selectableFile)}
                    className={cn(
                      "group/file flex w-full min-w-0 items-center gap-2 rounded-sm px-1.5 py-1 text-left",
                      "transition-colors hover:bg-[color:var(--project-panel-soft)]",
                      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--cohere-form-focus)]",
                    )}
                  >
                    {content}
                  </button>
                ) : (
                  <div
                    title={file.file}
                    className="group/file flex w-full min-w-0 items-center gap-2 rounded-sm px-1.5 py-1 text-left"
                  >
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
