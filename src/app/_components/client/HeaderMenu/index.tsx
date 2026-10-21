"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "@/app/_components/ui/button";

/**
 * The site links on narrow screens: a Menu button with a drop-down panel
 * that closes on a choice, an outside tap or Escape.
 */
export function HeaderMenu({
  links,
  note,
}: {
  links: { href: string; label: string }[];
  note?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <X aria-hidden /> : <Menu aria-hidden />}
        Menu
      </Button>
      {open && (
        <nav
          id={panelId}
          aria-label="Site"
          className="bg-popover text-popover-foreground border-border absolute right-0 z-50 mt-2 flex w-60 flex-col gap-0.5 rounded-xl border p-2 shadow-lg"
        >
          {note && (
            <p className="text-muted-foreground border-border mb-1 border-b px-3 pt-1 pb-2 text-sm">
              {note}
            </p>
          )}
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="hover:bg-muted rounded-md px-3 py-2 font-semibold"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
