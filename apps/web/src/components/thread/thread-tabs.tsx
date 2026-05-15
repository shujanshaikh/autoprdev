import { Plus, X } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@autopr/ui/components/tooltip";
import { cn } from "@autopr/ui/lib/utils";

export interface ThreadTab {
  threadId: string;
  title?: string | null;
  isLive?: boolean;
}

export interface ThreadTabsProps {
  tabs: ThreadTab[];
  activeThreadId?: string;
  resolveFallbackTitle?: (tab: ThreadTab) => string | undefined;
  onSelectTab: (threadId: string) => void;
  onCloseTab?: (threadId: string) => void;

  canCloseTab?: (tab: ThreadTab) => boolean;
  onNewTab?: () => void;
  newTabActive?: boolean;
  newTabLabel?: string;
  className?: string;
}

const DEFAULT_TAB_TITLE = "New thread";
const DEFAULT_NEW_TAB_LABEL = "Open project threads";

export function ThreadTabs({
  tabs,
  activeThreadId,
  resolveFallbackTitle,
  onSelectTab,
  onCloseTab,
  canCloseTab,
  onNewTab,
  newTabActive = false,
  newTabLabel = DEFAULT_NEW_TAB_LABEL,
  className,
}: ThreadTabsProps) {
  const showNewTab = Boolean(onNewTab) || newTabActive;
  const newTabInteractive = Boolean(onNewTab);

  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-1 items-stretch overflow-x-auto [overflow-anchor:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {tabs.map((tab, index) => {
        const active = tab.threadId === activeThreadId;
        const tabIndex = String(index + 1).padStart(2, "0");
        const title = tab.title ?? resolveFallbackTitle?.(tab) ?? DEFAULT_TAB_TITLE;
        const closeable = Boolean(onCloseTab) && (canCloseTab?.(tab) ?? true);

        return (
          <button
            key={tab.threadId}
            type="button"
            aria-current={active ? "page" : undefined}
            onMouseDown={(event) => {
              // Keep the tab strip visually anchored while switching tabs with a pointer.
              // Without this, the browser may scroll the focused tab into view and shift the strip.
              event.preventDefault();
            }}
            onClick={() => onSelectTab(tab.threadId)}
            className={cn(
              "group/tab relative flex h-full w-[220px] shrink-0 items-center gap-2.5 border-r border-border px-3 text-left",
              active
                ? "bg-card text-foreground"
                : "bg-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground",
            )}
          >
            {active ? (
              <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[2px] bg-primary" />
            ) : null}

            <span
              className={cn(
                "shrink-0 font-mono text-[10px] uppercase tabular-nums tracking-[0.18em]",
                active ? "text-primary" : "text-muted-foreground/55",
              )}
            >
              {tabIndex}
            </span>

            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 shrink-0",
                tab.isLive
                  ? "bg-emerald-500"
                  : active
                    ? "bg-primary"
                    : "bg-muted-foreground/40",
              )}
            />

            <span className="min-w-0 flex-1 truncate text-[12px] font-medium tracking-tight">
              {title}
            </span>

            <span
              role={closeable ? "button" : undefined}
              tabIndex={closeable ? 0 : undefined}
              aria-hidden={closeable ? undefined : true}
              aria-label={closeable ? `Close ${tab.title ?? "thread"} tab` : undefined}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (closeable) {
                  onCloseTab?.(tab.threadId);
                }
              }}
              onKeyDown={(event) => {
                if (closeable && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  event.stopPropagation();
                  onCloseTab?.(tab.threadId);
                }
              }}
              className={cn(
                "-mr-1 inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground/40",
                closeable
                  ? "hover:bg-foreground/10 hover:text-foreground"
                  : "pointer-events-none invisible",
              )}
            >
              <X className="size-3" aria-hidden="true" />
            </span>
          </button>
        );
      })}

      {showNewTab ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={newTabLabel}
                aria-current={newTabActive ? "page" : undefined}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={newTabInteractive ? onNewTab : undefined}
                className={cn(
                  "relative flex h-full w-10 shrink-0 items-center justify-center border-r border-border",
                  newTabActive
                    ? "cursor-default bg-card text-foreground"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
              >
                {newTabActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 top-0 h-[2px] bg-primary"
                  />
                ) : null}
                <Plus className="size-4" aria-hidden="true" />
              </button>
            }
          />
          <TooltipContent side="bottom" sideOffset={8}>
            {newTabLabel}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
