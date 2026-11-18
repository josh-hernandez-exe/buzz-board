/**
 * Checks that a restored database matches the original: every table's row
 * count and a fingerprint of its full contents. Read-only on both. Works
 * however the backup was made (pg_dump, your host's point-in-time restore).
 *
 *   SOURCE_DATABASE_URL="$DATABASE_URL" RESTORED_DATABASE_URL="$RESTORED_URL" \
 *     bun run ops:verify-restore
 *
 * The URLs come from the environment, not arguments: `bun run` echoes its
 * command line and arguments show in process listings, which would expose
 * the passwords. The report names each database without credentials.
 *
 * Compare while the source is idle (or against a copy taken at backup
 * time): rows written after the backup will show as differences.
 */
import {
  compareFingerprints,
  describeDatabase,
  fingerprint,
} from "./restoreCheck";

const sourceUrl = process.env.SOURCE_DATABASE_URL;
const restoredUrl = process.env.RESTORED_DATABASE_URL;
if (!sourceUrl || !restoredUrl) {
  console.error(
    "Set SOURCE_DATABASE_URL and RESTORED_DATABASE_URL to the two database URLs.",
  );
  process.exit(2);
}
const [source, restored] = await Promise.all([
  fingerprint(sourceUrl),
  fingerprint(restoredUrl),
]);
const differences = compareFingerprints(source, restored);
console.log(
  JSON.stringify(
    {
      ok: differences.length === 0,
      source: describeDatabase(sourceUrl),
      restored: describeDatabase(restoredUrl),
      tables: source.length,
      rows: source.reduce((s, t) => s + t.rows, 0),
      differences,
    },
    null,
    2,
  ),
);
process.exit(differences.length === 0 ? 0 : 1);
