import { Button } from "@autopr/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@autopr/ui/components/tooltip";
import { cn } from "@autopr/ui/lib/utils";
import { MessageScroller, useMessageScroller, useMessageScrollerVisibility } from "@shadcn/react/message-scroller";
import type { UIMessage } from "ai";
import { ArrowDownIcon, DownloadIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useMemo } from "react";

export type ConversationProps = ComponentProps<typeof MessageScroller.Root>;

export const Conversation = ({
  className,
  children,
  ...props
}: ConversationProps) => (
  <MessageScroller.Provider defaultScrollPosition="end">
    <MessageScroller.Root
      className={cn("relative flex w-full min-h-0 min-w-0 flex-1 overflow-hidden", className)}
      {...props}
    >
      {children}
    </MessageScroller.Root>
  </MessageScroller.Provider>
);

export type ConversationContentProps = ComponentProps<
  typeof MessageScroller.Content
>;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <MessageScroller.Viewport className="h-full w-full min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
    <MessageScroller.Content
      className={cn("flex min-h-full w-full min-w-0 max-w-full flex-col gap-0", className)}
      {...props}
    />
  </MessageScroller.Viewport>
);

export type ConversationMessageProps = ComponentProps<
  typeof MessageScroller.Item
>;

export const ConversationMessage = ({
  className,
  ...props
}: ConversationMessageProps) => (
  <MessageScroller.Item className={cn("w-full min-w-0 max-w-full", className)} {...props} />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground/45">{icon}</div>}
        <div className="space-y-1.5">
          <h3 className="text-sm font-medium text-foreground/90">{title}</h3>
          {description && (
            <p className="max-w-xs text-sm text-muted-foreground/80">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = Omit<
  ComponentProps<typeof MessageScroller.Button>,
  "children" | "direction" | "render"
> & {
  children?: ReactNode;
};

export const ConversationScrollButton = ({
  className,
  children,
  ...props
}: ConversationScrollButtonProps) => {
  return (
    <MessageScroller.Button
      behavior="smooth"
      direction="end"
      render={
        <Button
          aria-label="Scroll to latest message"
          size="icon"
          type="button"
          variant="outline"
        />
      }
      className={cn(
        "absolute bottom-4 left-[50%] z-10 size-9 translate-x-[-50%] rounded-full border-border/60 bg-background/90 shadow-sm backdrop-blur-sm transition data-[active=false]:pointer-events-none data-[active=false]:opacity-0",
        className
      )}
      {...props}
    >
      {children ?? <ArrowDownIcon className="size-4" />}
    </MessageScroller.Button>
  );
};

export type ConversationMessageNavigationProps = ComponentProps<"nav"> & {
  messages: Array<{ id: string; preview: string }>;
};

export const ConversationMessageNavigation = ({
  className,
  messages,
  ...props
}: ConversationMessageNavigationProps) => {
  const { scrollToMessage } = useMessageScroller();
  const { currentAnchorId, visibleMessageIds } = useMessageScrollerVisibility();
  const messageIds = useMemo(() => messages.map(({ id }) => id), [messages]);
  const visibleMessageIdSet = useMemo(() => new Set(visibleMessageIds), [visibleMessageIds]);
  const currentIndex = useMemo(() => {
    const anchorIndex = currentAnchorId ? messageIds.indexOf(currentAnchorId) : -1;
    if (anchorIndex >= 0) {
      return anchorIndex;
    }

    const firstVisibleIndex = messageIds.findIndex((id) => visibleMessageIdSet.has(id));
    return firstVisibleIndex >= 0 ? firstVisibleIndex : messageIds.length - 1;
  }, [currentAnchorId, messageIds, visibleMessageIdSet]);
  const goToMessage = useCallback(
    (index: number) => {
      const messageId = messageIds[index];
      if (messageId) {
        scrollToMessage(messageId, { align: "start", behavior: "smooth" });
      }
    },
    [messageIds, scrollToMessage],
  );

  if (messageIds.length < 2) {
    return null;
  }

  return (
    <nav
      aria-label="Navigate user messages"
      className={cn(
        "absolute left-1.5 top-1/2 z-10 flex max-h-1/2 -translate-y-1/2 flex-col items-start overflow-y-auto py-1 sm:left-2",
        className,
      )}
      {...props}
    >
      {messages.map(({ id: messageId, preview }, index) => {
        const isCurrent = index === currentIndex;

        return (
          <Tooltip key={messageId}>
            <TooltipTrigger
              render={
                <button
                  aria-current={isCurrent ? "step" : undefined}
                  aria-label={`Go to user message ${index + 1} of ${messageIds.length}: ${preview}`}
                  className="group flex h-3 w-8 items-center rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                  onClick={() => goToMessage(index)}
                  type="button"
                >
                  <span
                    className={cn(
                      "h-0.5 rounded-full bg-muted-foreground/35 transition-[width,background-color] duration-150 motion-reduce:transition-none group-hover:bg-muted-foreground/70",
                      isCurrent ? "w-6 bg-foreground/60" : "w-3.5",
                    )}
                  />
                </button>
              }
            />
            <TooltipContent
              align="center"
              className="max-w-72 rounded-[var(--radius-md)] px-2.5 py-2 text-[11px] leading-relaxed"
              side="right"
              sideOffset={7}
            >
              <span className="line-clamp-4 [overflow-wrap:anywhere]">{preview}</span>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
};

const getMessageText = (message: UIMessage): string =>
  message.parts.reduce(
    (text, part) => (part.type === "text" ? text + part.text : text),
    "",
  );

export type ConversationDownloadProps = Omit<
  ComponentProps<typeof Button>,
  "onClick"
> & {
  messages: UIMessage[];
  filename?: string;
  formatMessage?: (message: UIMessage, index: number) => string;
};

const defaultFormatMessage = (message: UIMessage): string => {
  const roleLabel =
    message.role.charAt(0).toUpperCase() + message.role.slice(1);
  return `**${roleLabel}:** ${getMessageText(message)}`;
};

const messagesToMarkdown = (
  messages: UIMessage[],
  formatMessage: (
    message: UIMessage,
    index: number
  ) => string = defaultFormatMessage
): string => messages.map((msg, i) => formatMessage(msg, i)).join("\n\n");

const ConversationDownload = ({
  messages,
  filename = "conversation.md",
  formatMessage = defaultFormatMessage,
  className,
  children,
  ...props
}: ConversationDownloadProps) => {
  const handleDownload = useCallback(() => {
    const markdown = messagesToMarkdown(messages, formatMessage);
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [messages, filename, formatMessage]);

  return (
    <Button
      className={cn("absolute top-4 right-4 rounded-full", className)}
      onClick={handleDownload}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <DownloadIcon className="size-4" />}
    </Button>
  );
};
