import { type ReactNode } from "react";

import { PageShell, SiteHeader } from "@/app/_components/ui/page";

/**
 * Public Help layout. It must not read the session, a game or the database,
 * so Help works before signing in or joining and is generated at build time.
 */
export default function HelpLayout({ children }: { children: ReactNode }) {
  return (
    <PageShell
      header={
        <SiteHeader
          links={[
            { href: "/help", label: "Help" },
            { href: "/join", label: "Join a game" },
            { href: "/dashboard", label: "My games" },
          ]}
        />
      }
      className="help-content"
    >
      {children}
    </PageShell>
  );
}
