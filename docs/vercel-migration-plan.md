# Vercel update and fallback plan

Prepared on 2026-11-15 from repository inspection and current provider documentation. **This is a plan, not a deployment or a completed restore rehearsal.** Vercel settings, the live deployments, hosted migration history, and hosted backups have not been inspected.

## Recommended approach

For a deployment currently used mainly by its owner, use **a protected preview, a rehearsed database backup, and one controlled production cutover**. Allow a short period with no active games or other writes. Keep the current PostgreSQL and Redis providers; do not combine this release with a hosting move or another dependency upgrade.

There are two separate fallback paths:

1. **Application problem, compatible database:** Vercel Instant Rollback to the recorded working deployment. Aim to restore service within 5 minutes, subject to rehearsal.
2. **Damaged data, failed migration, or incompatible old application:** restore the pre-release backup into a **separate database**, then deploy the known-good application against it. Recovery time is whatever the hosted restore and application-build rehearsal measures, not an assumed instant rollback.

Prepare ahead of time; reserve roughly an hour for the cutover, extending it if the rehearsal takes longer. There is no need for percentage-based canaries or a permanent second production stack at this usage level.

## Release-specific findings

| Finding                                                                                                                                                                                                                    | Consequence                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote `production` and `development` both point to `ffa2cf130588176afb858af067d9cfc0dbc15bdd`. The proposed release is `feature/buzzer-queue-and-themes` at `9acb00c40c2967e7c06701e1636bb2bf1607746c`, 49 commits ahead. | Merging the existing `development` into `production` alone would not release the new work. Confirm the live SHA in Vercel; a Git branch is not proof of what is deployed.                                            |
| There are 13 [migration directories](../prisma/migrations): `0_init` and 12 subsequent migrations.                                                                                                                         | A legacy deployment may need baselining and all 12 upgrades. Determine the actual pending set before running anything.                                                                                               |
| Migrations add tables, columns, defaults, indexes, and backfill data. Existing games get `running`/`choose`; new games default to `lobby`/`auto`. Queue, captain, and chat migrations also backfill state.                 | No reviewed migration drops application tables or columns, but additive SQL does **not** prove old application behavior is compatible with new data. Ordinary index creation and table alterations can block writes. |
| [Migration tests](../tests/integration/migrations.test.ts) cover a populated legacy upgrade, preserved scores/history, fresh installs, and schema drift.                                                                   | Useful existing protection, but not a rehearsal with the actual production backup or the actual old application.                                                                                                     |
| [CI](../.github/workflows/ci.yml) runs on pull requests and pushes to `development`.                                                                                                                                       | A feature-branch push alone is not evidence of a green release check.                                                                                                                                                |
| [Current scripts](../package.json) use `migrate deploy` for `prod:db:migrate`; the old `production` commit uses `migrate dev` under that same script name.                                                                 | **Run migration commands only from the reviewed new release checkout. Never use the old branch's production migration helper.**                                                                                      |
| `vercel:env:pull` does not specify an environment. Vercel defaults to Development regardless of the output filename.                                                                                                       | Use an explicit `--environment=production`, not that helper by itself.                                                                                                                                               |

## 1. Record the recovery information

Keep this release record in private operator notes, not committed secrets. These unknowns must be filled in before touching production:

- [ ] Vercel team/project, production domain, tracked production branch, and actual current deployment URL/ID and Git SHA.
- [ ] Exact release SHA and successful CI run; record any subsequent merge SHA used to build.
- [ ] Vercel plan and confirmed rollback eligibility. On **Hobby**, only the immediately previous production deployment is eligible; do not publish intervening experiments.
- [ ] Previous deployment retained and accessible; its secrets/connections still valid. Preserve an annotated Git tag or other durable reference to its source.
- [ ] Database provider/project/database, PostgreSQL version, backup availability, restore instructions, retention, and the person/account able to restore.
- [ ] Backup ID and UTC restore point, plus measured restore/build/reconnection time from the rehearsal.
- [ ] Secure copy of the known-good environment configuration and Vercel build/runtime/region settings. Keep `AUTH_SECRET` and OAuth credentials unchanged for this release unless a separate reason requires rotation.
- [ ] Redis provider and confirmed compatibility with TCP/TLS connections, Pub/Sub, and the commands used by this app.
- [ ] Any external cleanup jobs, other deployments, local processes, or clients that can write to production, and how to pause them.

**Data-loss objective:** preserve everything committed before the final backup. If writes are truly paused from that backup until acceptance, a restore should lose only explicitly disposable smoke-test activity. Any other writes after the restore point can be lost; obtain an explicit decision before discarding them.

## Development deployment gate

The Git target is **`development`**. That branch name does not identify a Vercel environment: it may deploy to Preview or a custom environment, depending on project settings. Vercel's **Development** environment is for local development; do not select it just because the branch has the same name.

**There is no automatic hosted migration in this repository.** [CI](../.github/workflows/ci.yml) resets and migrates disposable test databases only. `postinstall` generates Prisma Client; `build` compiles the application and checks that development login is excluded. Neither applies hosted migrations. A green CI/build or successful merge therefore does not prove the development database is ready.

For this first release, use an operator-controlled migration gate, not a migration in every preview build:

1. **Before opening the PR or pushing release commits**, check whether Vercel automatically builds feature-branch previews. Ensure they have isolated database/Redis settings and cannot serve the candidate against an unmigrated shared database. Before merging, also pause the `development` branch's automatic deployment/alias update using the project's deployment controls. If the PR is already open, inspect any deployment it triggered and keep it out of use until this gate passes. Do not assume production-domain controls also pause Preview aliases.
2. Record the actual Vercel project, environment, branch-specific overrides, development URL, current deployment SHA, and database identity privately. Confirm development and feature previews cannot write to production. If development shares production data, **stop** and use the production cutover procedure instead.
3. Require green PR checks for the exact release SHA. On a private trusted machine or protected runner, prepare a clean checkout of that SHA and the verified hosted-development configuration in a fresh private `.env.development-release.local` file (ignored by Git). Keep credentials out of this shared workspace and Git. Do not use `vercel:env:pull` without an explicit environment or `prod:db:migrate` for development. Ensure no inherited `DATABASE_URL` overrides the intended target.
4. Pause development writers and take a verified recovery backup. Inspect the database's migration history and schema. Use the same empty/legacy/already-migrated/drift decision table in [the rehearsal](#3-rehearse-on-a-restored-copy). The committed chain contains `0_init` plus 12 upgrades; the actual pending set depends on that database.
5. Inspect status from the release checkout:

   ```bash
   bun --env-file=.env.development-release.local run db:migrate:status
   ```

   Pending migrations can exit nonzero; inspect the result rather than treating every error as expected. **Only** for a populated legacy database verified to match `0_init`, run `bun --env-file=.env.development-release.local run db:baseline`. Never baseline an empty database or blindly resolve failed migrations.

6. Apply and verify before serving the candidate:

   ```bash
   bun --env-file=.env.development-release.local run db:migrate:deploy
   bun --env-file=.env.development-release.local run db:migrate:status
   ```

   Both must succeed, with status reporting **Database schema is up to date**. Verify expected schema/backfills and existing scores/history too; status alone does not detect drift. On failure, keep the candidate disabled and use the rehearsed recovery path, never `migrate reset`, `migrate dev`, or `db push`.
7. Merge the reviewed PR, confirm the resulting `development` checkout has exactly the reviewed schema/migrations, then explicitly deploy that SHA with the verified development settings. Re-run the gate if release code changed. Complete the acceptance checklist against the development URL before resuming writers and automatic deployments.

Record the operator, release and deployment SHAs, backup reference, migration output and final status, and smoke-test result on the PR without credentials. **Until those hosted checks are recorded, development deployment remains blocked even if local migration tests and CI pass.** This gate is procedural, not an enforced GitHub/Vercel environment protection.

## 2. Verify the candidate and environment

### Code and build gates

1. Open a release PR from the feature branch into `development`, following the repository's branch workflow. Require successful lint/typecheck, unit/component, integration, browser, and build checks for the exact code to be released.
2. Verify that Vercel uses `bun install --frozen-lockfile` and `bun run build`. The latter includes the production development-login exclusion check; plain `next build` bypasses that extra check. Installation generates Prisma Client but does not apply migrations.
3. Record the supported Node.js runtime and Bun version used by the successful build; align Vercel with the tested settings. Keep the lockfile unchanged and use a server-capable Next.js deployment, not a static export.
4. Keep database migrations out of Vercel install/build hooks for this release. One operator-controlled migration step is easier to order, observe, and recover than parallel preview builds modifying a database.

The focused migration test is:

```bash
bunx vitest run --project integration tests/integration/migrations.test.ts
```

Run it with the disposable services described in [tests/README.md](../tests/README.md), never with production credentials. Integration and browser tests reset test databases. Run the full existing CI gates as well for this unusually large release; historical test results alone are not approval.

### Environment checklist

Use [environment validation](../src/env.js) as the source of truth:

| Setting                                                                                                      | Required check                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                               | Correct database and TLS settings; provider-supported pooling/connection budget for Vercel. The [schema](../prisma/schema.prisma) consumes only this variable, not a separate `DIRECT_URL`.                                                                    |
| `KV_URL`                                                                                                     | Redis `redis://` or `rediss://` connection compatible with [Pub/Sub](../src/server/live/gameChangeBus.ts) and [rate limits](../src/server/utils/rateLimit.ts); an HTTP REST endpoint is not a substitute. Use a separate Redis instance for preview isolation. |
| `AUTH_SECRET`, `NEXTAUTH_URL`                                                                                | Existing secret preserved; canonical HTTPS URL for the relevant environment.                                                                                                                                                                                   |
| `AUTH_DISCORD_CLIENT_ID`, `AUTH_DISCORD_CLIENT_SECRET`, `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET` | Production validation currently requires both provider pairs. Complete real login checks; do not fill missing settings with fake values or bypass validation.                                                                                                  |
| `NEXT_PUBLIC_QRCODE_BASE_URL`                                                                                | Correct public join origin. It is baked into the client build, so changing project settings alone does not update an existing deployment.                                                                                                                      |
| `DEV_LOGIN`                                                                                                  | **Unset**, including the string `0`: production builds reject any nonempty value.                                                                                                                                                                              |
| `SKIP_ENV_VALIDATION`                                                                                        | Unset for release validation.                                                                                                                                                                                                                                  |
| `NEXT_PUBLIC_SHOW_DEBUG_INFO`, `LOG_LEVEL`                                                                   | No public debug display; use normal production logging.                                                                                                                                                                                                        |

Register the exact `/api/auth/callback/google` and `/api/auth/callback/discord` URLs for production and a stable protected preview origin. Preview must use its own database, Redis, and appropriate auth settings; do not copy the tagged local environment into production or let previews share production resources.

## 3. Rehearse on a restored copy

1. Briefly stop all production writers and take a provider snapshot/backup. If the plan has no usable backup feature, create a full logical PostgreSQL backup using a compatible `pg_dump` and store it securely outside the application workspace. A game-content export alone is not a database backup.
2. Restore into a **new, isolated database**. Keep an untouched recovery copy or the original backup; use a separate working copy for migrations and smoke tests.
3. Before changing the copy, verify it against the still-idle source:

   ```bash
   bun run ops:verify-restore -- --source "$SOURCE_DATABASE_URL" --restored "$RESTORED_DATABASE_URL"
   ```

   Supply these URLs securely on a private operator machine or protected runner. The command is read-only and must exit successfully with no table/count/content differences. It compares tables individually, so keep writers paused throughout. Do not publish its connection metadata.

   If production has resumed writing, compare with an unchanged copy from the same restore point instead; differences from later writes do not prove a bad backup. Resume normal production use after this backup-verification pause while the isolated rehearsal continues.

4. Inspect migration history and compare the restored schema with the expected schema at that history point. For a legacy database without migration history, verify its tables, columns, defaults, constraints, and indexes against [0_init](../prisma/migrations/0_init/migration.sql) using a read-only schema comparison.
5. Follow this decision table on the **working copy**:

   | Database state                                                         | Action                                                                                                                                        |
   | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
   | Empty database                                                         | Apply all committed migrations, including `0_init`. Do not mark the baseline as already applied.                                              |
   | Populated legacy database matching `0_init`, without migration history | Mark **only** `0_init` applied, then apply subsequent migrations. Baselining records history; it does not check or change application tables. |
   | Known, successful migration history and matching schema                | Apply only pending committed migrations.                                                                                                      |
   | Drift, failed/partial migrations, or unexplained newer tables          | Stop and reconcile on the copy. Do not reset or blindly mark migrations applied.                                                              |

6. Apply the upgrade with the reviewed release checkout and clone-specific credentials. Record elapsed time and warnings. `migrate status` must finish up to date, but it is not proof of absence of schema drift.
7. Deploy the release as a protected Vercel Preview connected only to the migrated working copy. Protect cloned accounts, sessions, and chat as production data. Run the acceptance checklist below.
8. Rehearse **both** the known-good application against the upgraded working copy and a clean build of its recorded source against the untouched restored schema. For the upgraded-copy test, exercise legacy games after candidate writes, score changes/undo, refreshes, and a switch back to the candidate. Do not run the old branch's migration script.
9. Record whether application-only rollback is actually safe and for which data/workflows. Old code does not understand all new lifecycle, role, removal, queue, captain, or game-mode state. If uncertain, make backup restore the planned fallback rather than promising compatibility.

The [existing restore runbook](./operations.md#backups-and-restore) contains the helper details. Its recorded local rehearsal is not proof that the hosted provider can restore production.

## 4. Cut over production

### Before the window

- [ ] Complete the rehearsal, green CI, environment review, and protected preview checks.
- [ ] In Vercel, disable **Auto-assign Custom Production Domains** before advancing the tracked production branch. This prevents an automatic cutover before the migration is ready. Confirm the old deployment is still Current.
- [ ] Merge the reviewed feature work into `development`. Reconfirm the release code/SHA and prepare its promotion into `production`. If Vercel tracks a different branch, use that recorded branch for the production release; do not assume the branch named `production` controls traffic.
- [ ] Prepare a clean release checkout and authenticated, correctly linked Vercel CLI on a **private, trusted machine or protected runner**, not a shared development workspace. Do not inherit development `.env` files or exported database variables.
- [ ] Pull Production configuration explicitly into a new private file:

  ```bash
  umask 077
  bunx vercel env pull .env.production --environment=production
  ```

  Vercel can preserve local-only entries when pulling into an existing file; use a fresh file and check for unavailable/placeholder secret values. Confirm the target database privately, without printing its URL. If the provider requires a direct connection for migrations, set `DATABASE_URL` to that provider-approved connection **on the migration runner only**, verifying it targets the same database. Keep Vercel's runtime pooling configuration unchanged.

### During the window

1. **Freeze writes.** Stop games, close host/player/display tabs, pause cleanup and other writers, and stop unrelated deploys. This plan does not add an application maintenance switch. If you cannot establish that writers are paused, postpone or arrange a tested access restriction first.
2. **Take the final recovery backup.** Record its exact ID/time and verify that it is restorable using the rehearsed procedure. Preserve a pre-change data reference, including known games, players, scores, and history. Keep writes paused until acceptance.
3. **Inspect status from the new release checkout:**

   ```bash
   bun --env-file=.env.production run db:migrate:status
   ```

   Pending migrations can produce a nonzero exit here. Check that the result matches the rehearsed pending set; authentication errors, drift, or failed migrations are not an expected pending status.

4. **Only for the verified populated legacy case**, record the existing baseline:

   ```bash
   bun --env-file=.env.production run db:baseline
   ```

   Skip this for an empty or already-baselined database.

5. **Apply and verify:**

   ```bash
   bun --env-file=.env.production run db:migrate:deploy
   bun --env-file=.env.production run db:migrate:status
   ```

   Both must succeed, with no migrations left pending. Compare the resulting schema and expected backfills to the rehearsal, and confirm legacy records/scores/history remain intact. Do not compare full pre/post-migration table fingerprints expecting equality: added columns, tables, and deliberate backfills change them.

6. **Build a staged Production deployment** of the exact approved release using Production settings. With domain auto-assignment disabled, advancing `production` can create this through the Git integration. Alternatively, from the exact clean release checkout:

   ```bash
   bunx vercel deploy --prod --skip-domain
   ```

   Choose one route, not both. If Git already built the correct staged deployment successfully, reuse it. Confirm build success, SHA, environment, and unchanged Current production domain. Staged deployments still have URLs and can write to production; keep access controlled.

7. **Check the staged deployment**, then promote it using the dashboard or the following command, replacing the placeholder:

   ```bash
   bunx vercel promote <staged-deployment-url-or-id>
   ```

   A staged **Production** build avoids preview-database and build-time-URL confusion. A Preview-to-Production promotion may rebuild with Production settings; it is not the same as moving an already-tested artifact unchanged.

8. **Run acceptance checks on the canonical production domain.** OAuth callbacks and QR links may intentionally leave the staged URL, so staged testing is not a substitute for this step. Keep real work paused and use disposable test games.
9. If all checks pass, record acceptance, resume normal use and cleanup, and observe the first hour and next day. Resume jobs only against the accepted database. Do not ship a second production release during the observation window.

## Acceptance checklist and stop conditions

Use a laptop host plus a phone/private-browser player and audience display. Record each pass/failure, not just that the homepage loaded.

- [ ] Homepage and Help load; `/dev-login` and its API route are unavailable in the production build.
- [ ] Complete a real Google sign-in and a real Discord sign-in through to the host dashboard. Automated browser tests seed sessions and do not prove OAuth works.
- [ ] Existing games, memberships, scores, and undo/redo history remain correct after refresh.
- [ ] Create a disposable game, join by code and QR link, buzz, change a score, undo/redo, and confirm the same result on host/player/display.
- [ ] Exercise queue buzzing, a saved game-mode setup, and its scoring; complete a short round of each mode you intend to use. Broader mode/role testing belongs in preview.
- [ ] Enable chat in the test game and verify delivery and team privacy. A working buzzer alone does not prove Redis works: chat sends fail closed when Redis is unavailable.
- [ ] Finish/reopen the test game, reconnect a player, and refresh the display. State must recover correctly, with reconnect targeting five seconds.
- [ ] Keep live screens open for at least 10-15 minutes **and long enough to cross the configured Vercel Function duration limit**. Verify streams reconnect after that boundary and continue receiving score/chat changes.
- [ ] No unexpected failed requests, missing acknowledged writes, score mismatches, cross-team leaks, or persistent database/Redis connection errors.

Inspect Vercel request/runtime logs and browser network/UI errors together. The [tRPC handler](../src/app/api/trpc/[trpc]/route.ts) suppresses its detailed `onError` logging outside development; quiet logs are not sufficient evidence of success.

**Stop immediately** for missing/corrupt data, privacy failures, migration errors, or an unverified backup. For a reproducible login/join/buzz/score/chat/reconnect failure, keep writes paused and choose a fallback within five minutes rather than debugging indefinitely in production. Do not run the load runner against production as part of this low-risk release.

## 5. Fallback procedures

### A. Build or preview fails before production migration

Leave the old deployment Current. Fix and retest the candidate; no production database recovery is needed. Do not promote just because a deployment URL exists.

If a production build fails **after** migrations were applied, the database has changed: leave the old deployment Current only if its compatibility was rehearsed and verified, otherwise use path C.

### B. New application fails; upgraded database is healthy and rollback was rehearsed

1. Pause writes and jobs; capture the failed deployment ID and error without delaying recovery.
2. Use Vercel **Instant Rollback** to the recorded eligible deployment, or:

   ```bash
   bunx vercel rollback <previous-production-deployment-url-or-id>
   bunx vercel rollback status
   ```

3. Leave the upgraded database in place. Do **not** delete new tables, reverse SQL by hand, or reset it.
4. Verify real sign-in, a known legacy game, its scores, and live updates on the canonical domain. Close/reload all clients; changing routing does not make existing browser code or open streams instantly match.
5. Resume only the workflows proven compatible in rehearsal. Do not continue new-mode, queue, role/moderation, or captain-dependent games under old code. If data semantics are uncertain or checks fail, use path C.

Instant Rollback reuses the old deployment and its original configuration; it does not revert database contents, pick up newly edited environment variables, or revert Git. External credentials must still work. On Hobby, preserve the immediately previous deployment as the fallback.

### C. Migration fails, data is wrong, or application-only rollback is unsafe

1. Keep all writers and cleanup stopped. Preserve the failed database and migration output for diagnosis; take a separate incident snapshot if available.
2. Restore the **final pre-release backup** into a new database using the rehearsed provider procedure. Never overwrite the only live/failed database.
3. Verify against the preserved pre-change reference or an untouched copy from that same backup, **not** the failed/migrated database. Check account access, games, members, scores, and history. Explicitly assess any writes that occurred after the restore point before accepting their loss.
4. Deploy a **fresh build of the recorded known-good source** using its known-good configuration but pointing `DATABASE_URL` at the restored database. Use the rehearsed old-source build procedure and ensure no automatic migration step runs. Retain a suitable Redis connection; this release keeps durable state in PostgreSQL, so a Redis restore is not required. Never flush a shared Redis instance.
5. Build it staged, verify it, then promote and run the legacy acceptance checks. Update every writer/job to the restored database before resuming it, and ensure no old clients/deployments continue writing to the abandoned database.

**Changing `DATABASE_URL` in project settings and pressing Instant Rollback is insufficient:** the old deployment retains its original connection configuration. A fresh deployment with the restored connection is required unless a separately rehearsed provider mechanism preserves the original endpoint.

Do not run `migrate reset`, `migrate dev`, `db push`, or automatic down migrations against production. Migration batches can be partially applied; a failed command does not guarantee nothing changed. `migrate resolve` records history, not recovery. Apart from the verified baseline step, use it only after an explicitly reviewed repair proves the SQL state.

### After either rollback

Keep the bad release from being automatically promoted again. Vercel currently disables production-domain auto-assignment after Instant Rollback; verify that state. Git still contains the new code, so repair/revert through normal review without rewriting history, and require a new preview and explicit promotion. Check auto-assignment again when promoting the fix, because undoing a rollback can re-enable it.

The old dependency set is a short-term recovery measure, not a reason to abandon the updated release. Prefer a tested forward fix when it can preserve correct new data.

## 6. Close out

- Record release/rollback deployment IDs, SHA, migration results, backup/restore point, timings, and acceptance results.
- Confirm the first scheduled cleanup succeeds; retain the [existing cleanup alerts](./operations.md#scheduled-cleanup).
- Retain the known-good deployment and pre-release backup through at least the next successful real session. Record an explicit expiry consistent with backup/chat retention policy; do not retain sensitive backup copies indefinitely.
- Remove only the identified rehearsal databases, disposable test games, and temporary credential files after acceptance and the agreed recovery window. Keep secrets out of Git, terminal logs, shared workspaces, and the release record.

## References

- [Vercel: Instant Rollback, eligibility, environment behavior, and auto-assignment](https://vercel.com/docs/instant-rollback)
- [Vercel: staged production deployments and promotion](https://vercel.com/docs/deployments/promoting-a-deployment)
- [Vercel: staged deployment CLI commands](https://vercel.com/docs/cli/deploying-from-cli#deploying-a-staged-production-build)
- [Vercel: environment export defaults and merge behavior](https://vercel.com/docs/cli/env)
- [Vercel: Function limits](https://vercel.com/docs/functions/limitations)
- [Prisma 6: baselining an existing database](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/baselining)
- [Prisma 6: development versus production migration behavior](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/development-and-production)
