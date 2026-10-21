import type { ReactNode } from "react";

import { Panel } from "@/app/_components/ui/page";

/** Older call sites' card; renders as a Panel so every screen matches. */
export function GenericCard({
  title,
  description,
  content,
  footer,
  className,
}: {
  title?: ReactNode;
  description?: string;
  content?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Panel title={title} description={description} className={className}>
      {content}
      {footer && (
        <div className="border-border flex flex-wrap gap-2 border-t pt-3">
          {footer}
        </div>
      )}
    </Panel>
  );
}
