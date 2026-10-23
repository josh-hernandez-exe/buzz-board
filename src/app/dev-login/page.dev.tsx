/**
 * /dev-login: development-only "Sign in as…" page. The `.dev.tsx` name means
 * only `next dev` serves it (next.config.js). See devLoginGate.ts.
 */
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { AppHeader } from "@/app/_components/server/AppHeader";
import { Button } from "@/app/_components/ui/button";
import {
  Notice,
  PageHeading,
  PageShell,
  Panel,
} from "@/app/_components/ui/page";
import {
  devLoginEnabled,
  isLoopbackHost,
  safeCallbackPath,
} from "@/server/auth/devLoginGate";

export default async function DevLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  if (!devLoginEnabled() || !isLoopbackHost((await headers()).get("host"))) {
    notFound();
  }
  const { DEV_ACCOUNTS } = await import("@/server/auth/devLogin");
  const callbackUrl = safeCallbackPath((await searchParams).callbackUrl);

  return (
    <PageShell header={<AppHeader />}>
      <PageHeading
        title="Development sign-in"
        description="Sign in as a ready-made test account. This page exists only on a local development server."
      />
      <Notice tone="warning" role="status">
        <strong>Development only.</strong> Turned on by <code>DEV_LOGIN=1</code>{" "}
        in <code>.env.development.local</code>. It never exists in a production
        build.
      </Notice>
      <Panel title="Test accounts">
        <ul className="flex flex-col gap-2">
          {DEV_ACCOUNTS.map((account) => (
            <li key={account.key}>
              <form
                method="post"
                action="/api/dev-login"
                className="border-border flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2"
              >
                <input type="hidden" name="account" value={account.key} />
                <input type="hidden" name="callbackUrl" value={callbackUrl} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">{account.name}</span>
                  <span className="text-muted-foreground text-sm">
                    {account.note}
                  </span>
                </span>
                <Button type="submit">Sign in as {account.name}</Button>
              </form>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground mt-3 text-sm">
          Use a separate browser profile or a private window for each account to
          be signed in as several at once. Players don&apos;t need accounts:
          they join with a code.{" "}
          <a
            className="underline"
            href={`/api/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`}
          >
            Use real sign-in (Discord or Google)
          </a>
        </p>
      </Panel>
    </PageShell>
  );
}
