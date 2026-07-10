import { Button } from "@autopr/ui/components/button";
import { cn } from "@autopr/ui/lib/utils";
import { MessageScroller } from "@shadcn/react/message-scroller";
import type { UIMessage } from "ai";
import { ArrowDownIcon, DownloadIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useCallback } from "react";

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
        {icon && <div className="text-muted-foreground/50">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
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
        "absolute bottom-4 left-[50%] z-10 translate-x-[-50%] rounded-full transition data-[active=false]:pointer-events-none data-[active=false]:opacity-0",
        className
      )}
      {...props}
    >
      {children ?? <ArrowDownIcon className="size-4" />}
    </MessageScroller.Button>
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
