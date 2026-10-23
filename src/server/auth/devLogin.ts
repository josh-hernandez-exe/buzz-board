/**
 * Development-only sign-in: ready-made accounts for testing hosting, co-hosting
 * and moderating without Discord or Google. Only imported (dynamically) by the
 * `.dev` page and route, so it never reaches a production build. See
 * devLoginGate.ts for every safeguard.
 */
import { randomBytes } from "node:crypto";

import { err, ok, type Result } from "neverthrow";

import { db } from "@/server/db";

/** The email domain of dev accounts. `.invalid` can never receive mail. */
export const DEV_EMAIL_DOMAIN = "dev-login.buzz-board.invalid";

export const DEV_ACCOUNTS = [
  {
    key: "host",
    name: "Dev Host",
    note: "Creates and runs games.",
  },
  {
    key: "cohost",
    name: "Dev Co-host",
    note: "Invite it as a co-host from a game's Room tab.",
  },
  {
    key: "moderator",
    name: "Dev Moderator",
    note: "Invite it as a moderator from a game's Room tab.",
  },
  {
    key: "host2",
    name: "Dev Host 2",
    note: "A second host with games of its own.",
  },
] as const;

export type DevAccountKey = (typeof DEV_ACCOUNTS)[number]["key"];

const SESSION_HOURS = 12;

/**
 * Signs in as a dev account, creating it the first time: returns a new
 * database session, the same kind Discord or Google sign-in creates.
 */
export async function startDevSession(
  key: string,
): Promise<
  Result<{ sessionToken: string; expires: Date }, { kind: "unknownAccount" }>
> {
  const account = DEV_ACCOUNTS.find((a) => a.key === key);
  if (!account) return err({ kind: "unknownAccount" });
  const email = `${account.key}@${DEV_EMAIL_DOMAIN}`;
  const user = await db.user.upsert({
    where: { email },
    update: {},
    create: { email, name: account.name },
  });
  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  await db.session.create({
    data: { sessionToken, userId: user.id, expires },
  });
  return ok({ sessionToken, expires });
}
