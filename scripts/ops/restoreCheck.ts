/**
 * Table-by-table comparison of two databases: row counts and a fingerprint
 * of every row's contents. Read-only. Used by ops:verify-restore and
 * ops:backup-rehearsal.
 */
import { PrismaClient } from "@prisma/client";

export type TableFingerprint = { table: string; rows: number; hash: string };

export async function fingerprint(url: string): Promise<TableFingerprint[]> {
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const tables = await db.$queryRaw<{ name: string }[]>`
      SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`;
    const out: TableFingerprint[] = [];
    for (const { name } of tables) {
      const quoted = `"${name.replaceAll('"', '""')}"`;
      const [row] = await db.$queryRawUnsafe<{ rows: bigint; hash: string }[]>(
        `SELECT count(*) AS rows,
                md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS hash
         FROM ${quoted} t`,
      );
      out.push({ table: name, rows: Number(row!.rows), hash: row!.hash });
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
