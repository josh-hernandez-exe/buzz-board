/**
 * Checks that a restored database matches the original: every table's row
 * count and a fingerprint of its full contents. Read-only on both. Works
 * however the backup was made (pg_dump, your host's point-in-time restore).
 *
 *   bun run ops:verify-restore -- --source "$DATABASE_URL" --restored "$RESTORED_URL"
 *
 * Compare while the source is idle (or against a copy taken at backup
 * time): rows written after the backup will show as differences.
 */
import { parseArgs } from "node:util";

import { compareFingerprints, fingerprint } from "./restoreCheck";

const redact = (url: string) => url.replace(/\/\/[^@/]*@/, "//***@");

const { values } = parseArgs({
  options: {
    source: { type: "string" },
    restored: { type: "string" },
  },
});
if (!values.source || !values.restored) {
  console.error("Usage: --source <database URL> --restored <database URL>");
  process.exit(2);
}
const [source, restored] = await Promise.all([
  fingerprint(values.source),
  fingerprint(values.restored),
]);
const differences = compareFingerprints(source, restored);
console.log(
  JSON.stringify(
    {
      ok: differences.length === 0,
      source: redact(values.source),
      restored: redact(values.restored),
      tables: source.length,
      rows: source.reduce((s, t) => s + t.rows, 0),
      differences,
    },
    null,
    2,
  ),
);
process.exit(differences.length === 0 ? 0 : 1);
