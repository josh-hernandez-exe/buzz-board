/**
 * POST /api/dev-login: development-only sign-in as a ready-made account.
 * The `.dev.ts` name means only `next dev` serves it (next.config.js);
 * production builds don't contain it. See devLoginGate.ts.
 */
import { NextResponse } from "next/server";

import {
  devLoginEnabled,
  isLoopbackHost,
  safeCallbackPath,
} from "@/server/auth/devLoginGate";

const notFound = () => new NextResponse("Not found", { status: 404 });

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return notFound();
  const host = request.headers.get("host");
  if (!devLoginEnabled() || !isLoopbackHost(host)) return notFound();

  // Only this site's own form may sign someone in.
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).host !== host) {
    return new NextResponse("Cross-site sign-in refused", { status: 403 });
  }

  const form = await request.formData();
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  const account = field("account");
  const callback = safeCallbackPath(field("callbackUrl"));

  const { startDevSession } = await import("@/server/auth/devLogin");
  const session = await startDevSession(account);
  if (session.isErr()) {
    return new NextResponse("Unknown dev account", { status: 400 });
  }

  // The cookie Auth.js reads for database sessions.
  const secure = new URL(request.url).protocol === "https:";
  const response = NextResponse.redirect(new URL(callback, origin), 303);
  response.cookies.set({
    name: `${secure ? "__Secure-" : ""}authjs.session-token`,
    value: session.value.sessionToken,
    expires: session.value.expires,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
  });
  return response;
}
