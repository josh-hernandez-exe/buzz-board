import Link from "next/link";
import { type ReactNode } from "react";

/**
 * Public Help layout. It must not read the session, a game or the database,
 * so Help works before signing in or joining and is generated at build time.
 */
export default function HelpLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="bg-gradient-to-b from-[#2e026d] to-[#15162c] px-4 py-3 text-white">
        <nav
          aria-label="Help"
          className="mx-auto flex max-w-3xl flex-wrap items-center gap-4"
        >
          <Link href="/" className="font-bold">
            Buzz-Board
          </Link>
          <Link href="/help" className="underline-offset-4 hover:underline">
            Help
          </Link>
          <Link href="/join" className="underline-offset-4 hover:underline">
            Join a game
          </Link>
        </nav>
      </header>
      <main className="help-content mx-auto max-w-3xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}
