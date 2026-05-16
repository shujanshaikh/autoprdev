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
  <div className="my-4 overflow-hidden border border-border bg-card">
    <div className="overflow-x-auto">
      <table
        className={cn(
          "w-full border-collapse text-[14px] tabular-nums",
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
    className={cn("border-b border-border bg-muted/40", className)}
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
      "divide-y divide-border/70 [&>tr:hover]:bg-muted/30",
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
      "whitespace-nowrap border-r border-border/70 px-3.5 py-2 text-left align-middle",
      "font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground",
      "last:border-r-0",
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
      "border-r border-border/55 px-3.5 py-2.5 align-top text-[14px] leading-relaxed",
      "first:text-muted-foreground last:border-r-0",
      "[&_code]:rounded-none [&_code]:bg-transparent [&_code]:px-0 [&_code]:py-0 [&_code]:font-mono",
      className,
    )}
    {...props}
  />
);

/**
 * Component overrides to pass to <Streamdown components={…} />. Replaces
 * the library's default table rendering with a boxy, dashboard-themed table.
 */
export const markdownComponents: Record<string, ComponentType<any>> = {
  table: MarkdownTable,
  thead: MarkdownThead,
  tbody: MarkdownTbody,
  tr: MarkdownTr,
  th: MarkdownTh,
  td: MarkdownTd,
};
