import Link from "next/link";
import { type ReactNode } from "react";

import { cn } from "@/app/_lib/utils";
import { buttonVariants } from "@/app/_components/ui/button";
import { HeaderMenu } from "@/app/_components/client/HeaderMenu";
import { ThemeToggle } from "@/app/_components/client/ThemeToggle";

/**
 * Page-level building blocks. Pages compose these instead of repeating
 * layout and colour classes, so the look lives in one place (with the
 * tokens in src/styles/globals.css). See docs/design-system.md.
 */

const WIDTH = {
  narrow: "max-w-md",
  normal: "max-w-3xl",
  wide: "max-w-5xl",
  /** Projected or screen-shared views, such as the audience display. */
  full: "max-w-7xl",
} as const;

/** The brand wordmark: a buzzer dot and the name. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-display inline-flex items-center gap-2 font-extrabold tracking-tight",
        className,
      )}
    >
      <span
        aria-hidden
        className="bg-primary ring-primary/30 inline-block size-[0.8em] rounded-full ring-4"
      />
      Buzz Board
    </span>
  );
}

export type NavLink = { href: string; label: string };

/**
 * The bar at the top of every page. `links` are page-specific; the brand
 * always links home.
 */
export function SiteHeader({
  links = [],
  note,
}: {
  links?: NavLink[];
  /** For example "Signed in as Kim". */
  note?: ReactNode;
}) {
  return (
    <header className="border-border bg-surface/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-2.5">
        <Link href="/" aria-label="Buzz Board home" className="text-lg">
          <Wordmark />
        </Link>
        <div className="ml-auto flex items-center gap-1">
          {note && (
            <span className="text-muted-foreground mr-2 hidden text-sm lg:inline">
              {note}
            </span>
          )}
          <ThemeToggle />
          {links.length > 0 && (
            <>
              <nav
                aria-label="Site"
                className="hidden items-center gap-1 lg:flex"
              >
                {links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
              <div className="lg:hidden">
                <HeaderMenu links={links} note={note} />
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * A whole page: header, then a centred column. `stage` gives the dark
 * game-show theme (audience display).
 */
export function PageShell({
  children,
  header,
  width = "normal",
  stage = false,
  center = false,
  className,
}: {
  children: ReactNode;
  header?: ReactNode;
  width?: keyof typeof WIDTH;
  stage?: boolean;
  /** Vertically centre short pages (sign-in style). */
  center?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-background text-foreground flex min-h-screen flex-col",
        stage && "stage",
      )}
    >
      {header}
      <main
        className={cn(
          "mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-6",
          WIDTH[width],
          center && "justify-center",
          className,
        )}
      >
        {children}
      </main>
    </div>
  );
}

/** A page's title, with optional supporting text and actions. */
export function PageHeading({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-3xl font-extrabold break-words">{title}</h1>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** A raised section of a page. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  as: Tag = "section",
  ...rest
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  as?: "section" | "div" | "aside";
  "aria-label"?: string;
  "data-testid"?: string;
}) {
  return (
    <Tag
      className={cn(
        "bg-surface text-surface-foreground border-border flex flex-col gap-3 rounded-xl border p-4 shadow-sm",
        className,
      )}
      {...rest}
    >
      {(title ?? description ?? actions) && (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            {title && <h2 className="text-lg font-bold">{title}</h2>}
            {description && (
              <p className="text-muted-foreground text-sm">{description}</p>
            )}
          </div>
          {actions}
        </div>
      )}
      {children}
    </Tag>
  );
}

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const PILL: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning text-warning-foreground",
  danger: "bg-destructive-soft text-destructive",
  info: "bg-accent text-accent-foreground",
};

/** A small rounded label, such as a game's status or a role. */
export function StatusPill({
  tone = "neutral",
  children,
  className,
  ...rest
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap",
        PILL[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

const NOTICE: Record<Tone, string> = {
  neutral: "bg-muted text-foreground",
  success: "bg-success-soft text-foreground border-success/40",
  warning: "bg-warning-soft text-foreground border-warning",
  danger: "bg-destructive-soft text-foreground border-destructive/40",
  info: "bg-accent-soft text-foreground border-accent",
};

/** A block of explanatory or status text. */
export function Notice({
  tone = "neutral",
  children,
  className,
  role,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  role?: "status" | "alert";
}) {
  return (
    <div
      role={role}
      className={cn(
        "rounded-lg border border-transparent px-3 py-2 text-sm",
        NOTICE[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A full-page message, such as "Game not found". */
export function MessagePage({
  title,
  children,
  header,
}: {
  title: ReactNode;
  children?: ReactNode;
  header?: ReactNode;
}) {
  return (
    <PageShell header={header ?? <SiteHeader />} width="narrow" center>
      <Panel className="items-center p-8 text-center">
        <h1 className="text-2xl font-extrabold">{title}</h1>
        {children}
      </Panel>
    </PageShell>
  );
}

/** A Link styled as a button. */
export function LinkButton({
  href,
  children,
  variant = "default",
  size = "default",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: "default" | "secondary" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(buttonVariants({ variant, size }), className)}
    >
      {children}
    </Link>
  );
}
