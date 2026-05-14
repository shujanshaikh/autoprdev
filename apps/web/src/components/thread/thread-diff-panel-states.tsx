import { FileDiff } from "lucide-react";

export function ThreadDiffEmptyState() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="relative inline-flex size-14 items-center justify-center">
        <span aria-hidden="true" className="absolute inset-0 border border-dashed border-border/50 opacity-70" />
        <span aria-hidden="true" className="absolute inset-1 border border-dashed border-border/30 opacity-40" />
        <FileDiff className="size-5 text-muted-foreground/50" aria-hidden="true" />
      </div>
      <div className="space-y-1.5">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-muted-foreground/70">Awaiting changes</p>
        <p className="max-w-[240px] font-mono text-[11px] leading-relaxed text-muted-foreground/50">File edits from the agent will surface here as they happen.</p>
      </div>
    </div>
  );
}

export function ThreadDiffSkeletonRow({ delay }: { delay: number }) {
  return (
    <li className="flex items-center gap-2.5 px-2 py-2.5" style={{ animationDelay: `${delay}ms` }}>
      <span className="size-4 shrink-0 animate-pulse rounded-[2px] bg-muted/80" />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="h-2.5 animate-pulse rounded-sm bg-muted" style={{ width: `${55 + ((delay * 7) % 30)}%` }} />
        <span className="h-2 animate-pulse rounded-sm bg-muted/60" style={{ width: `${30 + ((delay * 5) % 25)}%` }} />
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {Array.from({ length: 5 }).map((_, i) => <span key={i} className="size-1.5 animate-pulse rounded-[1px] bg-muted/60" style={{ animationDelay: `${i * 60}ms` }} />)}
      </span>
    </li>
  );
}

export function ThreadDiffLoadingDiff() {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-border/40 px-3 pb-2.5 pt-2.5">
        <div className="flex items-center gap-2">
          <span className="size-3.5 animate-pulse rounded-[2px] bg-muted" />
          <span className="h-3.5 w-16 animate-pulse rounded-sm bg-muted" />
          <span className="ml-auto h-2.5 w-14 animate-pulse rounded-sm bg-muted" />
        </div>
        <div className="mt-2 space-y-1.5">
          <span className="block h-2 w-2/3 animate-pulse rounded-sm bg-muted/60" />
          <span className="block h-2.5 w-4/5 animate-pulse rounded-sm bg-muted" />
        </div>
      </div>
      <div className="space-y-1.5 p-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <span key={i} className="block h-2.5 animate-pulse rounded-sm bg-muted/70" style={{ width: `${[92, 78, 60, 84, 45, 70, 88, 52, 66][i]}%`, animationDelay: `${i * 70}ms` }} />
        ))}
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 border-t border-border/40 bg-background/90 px-3 py-2.5 backdrop-blur-sm">
        <span className="relative inline-flex size-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground/30" />
          <span className="relative inline-flex size-1.5 rounded-full bg-foreground/70" />
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">Computing diff</span>
      </div>
    </div>
  );
}

export function ThreadDiffLoadingList() {
  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(120px,min(240px,38%))_minmax(0,1fr)] overflow-hidden">
      <div className="minimal-scrollbar min-h-0 overflow-hidden border-b border-border/40 p-2">
        <ul className="space-y-px">
          {Array.from({ length: 4 }).map((_, i) => <ThreadDiffSkeletonRow key={i} delay={i * 80} />)}
        </ul>
      </div>
      <ThreadDiffLoadingDiff />
    </div>
  );
}
