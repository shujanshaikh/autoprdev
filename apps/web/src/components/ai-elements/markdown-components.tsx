import type { ComponentProps, ComponentType } from "react";

import { cn } from "@autopr/ui/lib/utils";

/**
 * Streamdown / react-markdown pass an extra `node` prop to component overrides.
 * It must be stripped before forwarding the rest to the underlying DOM element.
 */
type WithNode<P> = P & { node?: unknown };

const MarkdownTable = ({
  node: _node,
  className,
  children,
  ...props
}: WithNode<ComponentProps<"table">>) => (
  <div className="my-3 overflow-x-auto">
    <div className="overflow-x-auto">
      <table
        className={cn(
          "w-full border-collapse text-[13px] leading-6 tabular-nums",
          className,
        )}
        {...props}
      >
        {children}
      </table>
    </div>
  </div>
);

const MarkdownThead = ({
  node: _node,
  className,
  ...props
}: WithNode<ComponentProps<"thead">>) => (
  <thead
    className={cn("border-b border-border/50 text-muted-foreground", className)}
    {...props}
  />
);

const MarkdownTbody = ({
  node: _node,
  className,
  ...props
}: WithNode<ComponentProps<"tbody">>) => (
  <tbody
    className={cn(
      "divide-y divide-border/35",
      className,
    )}
    {...props}
  />
);

const MarkdownTr = ({
  node: _node,
  className,
  ...props
}: WithNode<ComponentProps<"tr">>) => (
  <tr className={className} {...props} />
);

const MarkdownTh = ({
  node: _node,
  className,
  ...props
}: WithNode<ComponentProps<"th">>) => (
  <th
    className={cn(
      "whitespace-nowrap px-2 py-1.5 text-left align-middle",
      "font-mono text-[11px] font-medium text-muted-foreground",
      className,
    )}
    {...props}
  />
);

const MarkdownTd = ({
  node: _node,
  className,
  ...props
}: WithNode<ComponentProps<"td">>) => (
  <td
    className={cn(
      "px-2 py-1.5 align-top text-[13px] text-foreground/85",
      "first:text-muted-foreground",
      "[&_code]:rounded-none [&_code]:bg-transparent [&_code]:px-0 [&_code]:py-0 [&_code]:font-mono",
      className,
    )}
    {...props}
  />
);

/**
 * Component overrides to pass to <Streamdown components={…} />. Keeps
 * generated markdown compact so chat output still feels like a coding harness.
 */
export const markdownComponents: Record<string, ComponentType<any>> = {
  table: MarkdownTable,
  thead: MarkdownThead,
  tbody: MarkdownTbody,
  tr: MarkdownTr,
  th: MarkdownTh,
  td: MarkdownTd,
};
