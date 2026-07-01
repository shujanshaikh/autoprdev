import { cn } from "@autopr/ui/lib/utils";
import { FilePlus2, FileX2 } from "lucide-react";

import { FileTypeIcon } from "#/lib/file-type-icon";
import { type ThreadDiffEntry } from "./thread-diff-panel-utils";

export function ThreadDiffStatusIcon({ status, file }: { status: ThreadDiffEntry["status"]; file: string }) {
  const shared = "size-3.5 shrink-0";
  if (status === "added") {
    return <FilePlus2 className={cn(shared, "text-[color:var(--cohere-deep-green)] dark:text-[color:var(--cohere-pale-green)]")} aria-hidden="true" />;
  }
  if (status === "deleted") {
    return <FileX2 className={cn(shared, "text-[color:var(--cohere-coral)]")} aria-hidden="true" />;
  }
  return <FileTypeIcon file={file} className={shared} />;
}
