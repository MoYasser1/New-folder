import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './pool.js';

const migrationsDirectory = fileURLToPath(new URL('./migrations/', import.meta.url));
const lockId = 2_026_072_4;

try {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.query('SELECT pg_advisory_lock($1)', [lockId]);
  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => /^\d+_[a-z0-9_]+\.sql$/.test(filename))
    .sort();
  for (const filename of filenames) {
    const sql = await readFile(join(migrationsDirectory, filename), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const applied = await db.query<{ checksum: string }>(
      'SELECT checksum FROM schema_migrations WHERE filename=$1', [filename],
    );
    if (applied.rows[0]) {
      if (applied.rows[0].checksum !== checksum) {
        throw new Error(`Applied migration ${filename} has been modified.`);
      }
      continue;
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations(filename,checksum) VALUES($1,$2)', [filename, checksum],
      );
      await client.query('COMMIT');
      process.stdout.write(`Applied migration ${filename}.\n`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  process.stdout.write(`Database migrations are current (${filenames.length} files from ${dirname(migrationsDirectory)}).\n`);
} finally {
  await db.query('SELECT pg_advisory_unlock($1)', [lockId]).catch(() => undefined);
  await db.end();
}
