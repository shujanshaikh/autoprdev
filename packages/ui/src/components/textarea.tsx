import * as React from "react"

import { cn } from "@autopr/ui/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-[var(--radius-md)] border border-input bg-secondary px-3 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-[var(--cohere-form-focus)] focus-visible:ring-1 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:bg-muted/60 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 md:text-sm dark:bg-secondary dark:disabled:bg-muted/60 dark:aria-invalid:border-destructive/70 dark:aria-invalid:ring-destructive/30",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
