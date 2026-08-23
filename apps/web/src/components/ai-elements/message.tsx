import { hasStringType } from "@autopr/config/runtime-type";

import { Button } from "@autopr/ui/components/button";
import { ButtonGroup, ButtonGroupText } from "@autopr/ui/components/button-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@autopr/ui/components/tooltip";
import { cn } from "@autopr/ui/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import type { UIMessage } from "ai";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactElement } from "react";
import { createContext, memo, use, useCallback, useEffect, useMemo, useState } from "react";
import { Streamdown } from "streamdown";

import { markdownComponents } from "./markdown-components";

const MessageRoleContext = createContext<UIMessage["role"]>("assistant");

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
  <MessageRoleContext.Provider value={from}>
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
  </MessageRoleContext.Provider>
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

interface MessageBranchContextType {
  currentBranch: number;
  totalBranches: number;
  goToPrevious: () => void;
  goToNext: () => void;
  branches: ReactElement[];
  setBranches: (branches: ReactElement[]) => void;
}

const MessageBranchContext = createContext<MessageBranchContextType | null>(
  null
);

const useMessageBranch = () => {
  const context = use(MessageBranchContext);

  if (!context) {
    throw new Error(
      "MessageBranch components must be used within MessageBranch"
    );
  }

  return context;
};

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number;
  onBranchChange?: (branchIndex: number) => void;
};

const MessageBranch = ({
  defaultBranch = 0,
  onBranchChange,
  className,
  ...props
}: MessageBranchProps) => {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch);
  const [branches, setBranches] = useState<ReactElement[]>([]);

  const handleBranchChange = useCallback(
    (newBranch: number) => {
      setCurrentBranch(newBranch);
      onBranchChange?.(newBranch);
    },
    [onBranchChange]
  );

  const goToPrevious = useCallback(() => {
    const newBranch =
      currentBranch > 0 ? currentBranch - 1 : branches.length - 1;
    handleBranchChange(newBranch);
  }, [currentBranch, branches.length, handleBranchChange]);

  const goToNext = useCallback(() => {
    const newBranch =
      currentBranch < branches.length - 1 ? currentBranch + 1 : 0;
    handleBranchChange(newBranch);
  }, [currentBranch, branches.length, handleBranchChange]);

  const contextValue = useMemo<MessageBranchContextType>(
    () => ({
      branches,
      currentBranch,
      goToNext,
      goToPrevious,
      setBranches,
      totalBranches: branches.length,
    }),
    [branches, currentBranch, goToNext, goToPrevious]
  );

  return (
    <MessageBranchContext.Provider value={contextValue}>
      <div
        className={cn("grid w-full gap-2 [&>div]:pb-0", className)}
        {...props}
      />
    </MessageBranchContext.Provider>
  );
};

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>;

const MessageBranchContent = ({
  children,
  ...props
}: MessageBranchContentProps) => {
  const { currentBranch, setBranches, branches } = useMessageBranch();
  const childrenArray = useMemo(
    () => (Array.isArray(children) ? children : [children]),
    [children]
  );

  useEffect(() => {
    if (branches.length !== childrenArray.length) {
      setBranches(childrenArray);
    }
  }, [childrenArray, branches, setBranches]);

  return childrenArray.map((branch, index) => (
    <div
      className={cn(
        "grid gap-2 overflow-hidden [&>div]:pb-0",
        index === currentBranch ? "block" : "hidden"
      )}
      key={branch.key}
      {...props}
    >
      {branch}
    </div>
  ));
};

export type MessageBranchSelectorProps = ComponentProps<typeof ButtonGroup>;

const MessageBranchSelector = ({
  className,
  ...props
}: MessageBranchSelectorProps) => {
  const { totalBranches } = useMessageBranch();

  if (totalBranches <= 1) {
    return null;
  }

  return (
    <ButtonGroup
      className={cn(
        "[&>*:not(:first-child)]:rounded-l-md [&>*:not(:last-child)]:rounded-r-md",
        className
      )}
      orientation="horizontal"
      {...props}
    />
  );
};

export type MessageBranchPreviousProps = ComponentProps<typeof Button>;

const MessageBranchPrevious = ({
  children,
  ...props
}: MessageBranchPreviousProps) => {
  const { goToPrevious, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Previous branch"
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronLeftIcon size={14} />}
    </Button>
  );
};

export type MessageBranchNextProps = ComponentProps<typeof Button>;

const MessageBranchNext = ({
  children,
  ...props
}: MessageBranchNextProps) => {
  const { goToNext, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Next branch"
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronRightIcon size={14} />}
    </Button>
  );
};

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>;

const MessageBranchPage = ({
  className,
  ...props
}: MessageBranchPageProps) => {
  const { currentBranch, totalBranches } = useMessageBranch();

  return (
    <ButtonGroupText
      className={cn(
        "border-none bg-transparent text-muted-foreground shadow-none",
        className
      )}
      {...props}
    >
      {currentBranch + 1} of {totalBranches}
    </ButtonGroupText>
  );
};

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { cjk, code, math };
const minimalHarnessControls = {
  code: false,
  mermaid: false,
  table: false,
} as const;

function normalizeHarnessMarkdown(content: MessageResponseProps["children"]) {
  if (!hasStringType(content)) {
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

export type MessageToolbarProps = ComponentProps<"div">;

const MessageToolbar = ({
  className,
  children,
  ...props
}: MessageToolbarProps) => (
  <div
    className={cn(
      "mt-2 flex w-full items-center justify-between gap-4",
      className
    )}
    {...props}
  >
    {children}
  </div>
);
