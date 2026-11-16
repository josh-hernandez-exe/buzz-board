/**
 * Table-by-table comparison of two databases: row counts and a fingerprint
 * of every row's contents. Read-only. Used by ops:verify-restore and
 * ops:backup-rehearsal.
 */
import { PrismaClient } from "@prisma/client";

export type TableFingerprint = { table: string; rows: number; hash: string };

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

/**
 * Names a database in a report without credentials: scheme, host and
 * database only. Query parameters are dropped because they can carry
 * secrets too (`password`, `sslpassword`, `api_key`).
 */
export function describeDatabase(url: string): string {
  try {
    const { protocol, host, pathname } = new URL(url);
    return `${protocol}//${host}${pathname}`;
  } catch {
    return "(unparseable URL)";
  }
}

export async function fingerprint(url: string): Promise<TableFingerprint[]> {
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    // Every schema, not just `public` (a `?schema=` URL keeps the app's tables
    // elsewhere). pg_catalog, unlike information_schema, also lists tables
    // this role can't read, so reading them fails loudly instead of skipping.
    const tables = await db.$queryRaw<{ schema: string; name: string }[]>`
      SELECT n.nspname::text AS schema, c.relname::text AS name
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname <> 'information_schema'
        AND NOT starts_with(n.nspname, 'pg_')
      ORDER BY n.nspname, c.relname`;
    const out: TableFingerprint[] = [];
    for (const { schema, name } of tables) {
      const [row] = await db.$queryRawUnsafe<{ rows: bigint; hash: string }[]>(
        `SELECT count(*) AS rows,
                md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS hash
         FROM ${quote(schema)}.${quote(name)} t`,
      );
      out.push({
        table: `${schema}.${name}`,
        rows: Number(row!.rows),
        hash: row!.hash,
      });
    }
    return out;
  } finally {
    await db.$disconnect();
  }
}

export function compareFingerprints(
  source: TableFingerprint[],
  restored: TableFingerprint[],
) {
  const byName = new Map(restored.map((t) => [t.table, t]));
  const differences: string[] = [];
  if (source.length === 0) {
    differences.push(
      "the source database has no tables, so nothing was checked (wrong URL?)",
    );
  }
  for (const s of source) {
    const r = byName.get(s.table);
    if (!r) differences.push(`${s.table}: missing from the restored database`);
    else if (r.rows !== s.rows) {
      differences.push(`${s.table}: ${s.rows} rows, restored has ${r.rows}`);
    } else if (r.hash !== s.hash) {
      differences.push(`${s.table}: same row count, different contents`);
    }
    byName.delete(s.table);
  }
  for (const extra of byName.keys()) {
    differences.push(`${extra}: only in the restored database`);
  }
  return differences;
}
