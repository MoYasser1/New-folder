// @vitest-environment node
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let database: PGlite;

beforeAll(async () => {
  database = new PGlite({ extensions: { pgcrypto } });
  const directory = new URL('./migrations/', import.meta.url);
  const migrations = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of migrations) {
    await database.exec(await readFile(new URL(name, directory), 'utf8'));
  }
}, 30_000);

afterAll(async () => {
  await database.close();
});

describe('PostgreSQL migration', () => {
  it('creates the complete required table set', async () => {
    const result = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' ORDER BY table_name`,
    );
    const tables = result.rows.map((row) => row.table_name);
    expect(tables).toEqual(expect.arrayContaining([
      'users', 'sessions', 'courses', 'modules', 'lessons', 'quizzes', 'quiz_questions',
      'orders', 'payments', 'refunds', 'enrollments', 'media_assets', 'project_submissions',
      'notifications', 'audit_logs', 'webhook_events',
    ]));
  });

  it('enforces case-insensitive active email uniqueness and media constraints', async () => {
    const first = await database.query<{ id: string }>(
      `INSERT INTO users(email,password_hash,full_name,role)
       VALUES('Schema@Test.Example','hash','Schema User','student') RETURNING id`,
    );
    await expect(database.exec(
      `INSERT INTO users(email,password_hash,full_name,role)
       VALUES('schema@test.example','hash','Duplicate','student')`,
    )).rejects.toThrow();
    await expect(database.exec(
      `INSERT INTO media_assets(owner_id,purpose,original_filename,mime_type,size_bytes,storage_key)
       VALUES('${first.rows[0]!.id}','executable','file.exe','application/octet-stream',10,'unsafe')`,
    )).rejects.toThrow();
  });

  it('applies follow-up migrations including complete audit request context', async () => {
    const columns = await database.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='audit_logs' ORDER BY ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toContain('user_agent');
  });
});
