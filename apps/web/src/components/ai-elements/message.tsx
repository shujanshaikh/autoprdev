import { Button } from "@autopr/ui/components/button";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@autopr/ui/components/tooltip";
import { cn } from "@autopr/ui/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import type { UIMessage } from "ai";
import type { ComponentProps } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";

import { markdownComponents } from "./markdown-components";

export type MessageGroupProps = ComponentProps<"div">;

export const MessageGroup = ({
  className,
  ...props
}: MessageGroupProps) => (
  <div
    data-slot="message-group"
    className={cn("flex min-w-0 flex-col gap-2", className)}
    {...props}
  />
);

export type MessageProps = ComponentProps<"div"> & {
  align?: "start" | "end";
  from?: UIMessage["role"];
};

export const Message = ({
  align,
  className,
  from = "assistant",
  ...props
}: MessageProps) => (
  <div
    data-slot="message"
    data-align={align ?? (from === "user" ? "end" : "start")}
    data-role={from}
    className={cn(
      "group/message relative flex w-full min-w-0 gap-2 text-sm data-[align=end]:flex-row-reverse data-[align=end]:justify-start",
      from === "user" ? "message-enter-user" : "message-enter",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = ComponentProps<"div">;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => {
  return (
    <div
      data-slot="message-content"
      className={cn(
        "flex min-w-0 max-w-full flex-col gap-2 overflow-visible wrap-break-word",
        "group-data-[align=end]/message:ml-auto group-data-[align=end]/message:items-end",
        "group-data-[align=start]/message:mr-auto group-data-[align=start]/message:items-start",
        "group-data-[align=end]/message:w-fit group-data-[align=end]/message:max-w-[min(100%,36rem)]",
        "group-data-[align=start]/message:w-full",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export type MessageHeaderProps = ComponentProps<"div">;

export const MessageHeader = ({
  className,
  ...props
}: MessageHeaderProps) => (
  <div
    data-slot="message-header"
    className={cn(
      "flex max-w-full min-w-0 items-center text-xs font-medium text-muted-foreground",
      className
    )}
    {...props}
  />
);

export type MessageFooterProps = ComponentProps<"div">;

export const MessageFooter = ({
  className,
  ...props
}: MessageFooterProps) => (
  <div
    data-slot="message-footer"
    className={cn(
      "flex max-w-full min-w-0 items-center text-xs font-medium text-muted-foreground group-data-[align=end]/message:justify-end",
      className
    )}
    {...props}
  />
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({
  className,
  children,
  ...props
}: MessageActionsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = "ghost",
  size = "icon-sm",
  className,
  ...props
}: MessageActionProps) => {
  const button = (
    <Button
      size={size}
      type="button"
      variant={variant}
      className={cn(
        "size-7 rounded-full text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger render={button} />
          <TooltipContent className="rounded-[var(--radius-md)]">
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return button;
};

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { cjk, code, math };
const minimalHarnessControls = {
  code: false,
  mermaid: false,
  table: false,
} as const;
const streamingTextAnimation = {
  animation: "fadeIn",
  duration: 120,
  easing: "ease-out",
  sep: "word",
  stagger: 0,
} as const;

function normalizeHarnessMarkdown(content: MessageResponseProps["children"]) {
  if (typeof content !== "string") {
    return content;
  }

  return content.replace(/```mermaid\b/gi, "```text");
}

export const MessageResponse = memo(
  ({ className, children, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn(
        "sd-render w-full min-w-0 text-foreground !text-[14px] !leading-[1.7] [&>*+*]:!mt-3 [&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0",
        "[&_p]:!my-0 [&_p]:!text-[14px] [&_p]:!leading-[1.7] [&_p+p]:!mt-2.5 [&_li]:!my-1 [&_ul]:!my-2 [&_ol]:!my-2",
        "[&_code]:!rounded-[var(--radius-sm)] [&_code]:!bg-muted/60 [&_code]:!px-1.5 [&_code]:!py-0.5 [&_code]:!text-[0.86em]",
        "[&_[data-streamdown=inline-code]]:!text-[0.86em]",
        "[&_[data-streamdown=code-block]]:!my-3 [&_[data-streamdown=code-block]]:!gap-0 [&_[data-streamdown=code-block]]:!overflow-hidden",
        "[&_[data-streamdown=code-block]]:!rounded-[var(--radius-lg)] [&_[data-streamdown=code-block]]:!border [&_[data-streamdown=code-block]]:!border-border/50 [&_[data-streamdown=code-block]]:!bg-muted/20 [&_[data-streamdown=code-block]]:!p-0",
        "[&_[data-streamdown=code-block-header]]:hidden [&_[data-streamdown=code-block-actions]]:hidden",
        "[&_[data-streamdown=code-block-body]]:!rounded-[var(--radius-lg)] [&_[data-streamdown=code-block-body]]:!border-0",
        "[&_[data-streamdown=code-block-body]]:!bg-transparent [&_[data-streamdown=code-block-body]]:!p-0 [&_[data-streamdown=code-block-body]]:!text-[12px] sm:[&_[data-streamdown=code-block-body]]:!text-[13px]",
        "[&_[data-streamdown=code-block-body]_pre]:!m-0 [&_[data-streamdown=code-block-body]_pre]:!rounded-[var(--radius-lg)]",
        "[&_[data-streamdown=code-block-body]_pre]:!border-0 [&_[data-streamdown=code-block-body]_pre]:!bg-transparent [&_[data-streamdown=code-block-body]_pre]:!p-3.5",
        "[&_[data-streamdown=code-block-body]_code]:!text-[inherit] [&_[data-streamdown=code-block-body]_code]:!leading-[1.55]",
        className
      )}
      components={markdownComponents}
      controls={minimalHarnessControls}
      animated={streamingTextAnimation}
      lineNumbers={false}
      plugins={streamdownPlugins}
      {...props}
    >
      {normalizeHarnessMarkdown(children)}
    </Streamdown>
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating
);

MessageResponse.displayName = "MessageResponse";
