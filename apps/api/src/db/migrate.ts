import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

const DEFAULT_DATABASE_URL =
  'postgres://overflowgo:overflowgo_dev@localhost:5433/overflowgo';

function migrationsDirectory(): string {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    resolve(process.cwd(), 'migrations'),
    resolve(process.cwd(), 'apps/api/migrations'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Migrations directory not found. Tried:\n${candidates.join('\n')}`);
  }
  return found;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(
  connectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
): Promise<MigrationResult> {
  const client = new Client({ connectionString });
  await client.connect();

  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const directory = migrationsDirectory();
    const files = (await readdir(directory))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const existing = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations',
    );
    const alreadyApplied = new Set(existing.rows.map((row) => row.version));

    for (const file of files) {
      if (alreadyApplied.has(file)) {
        skipped.push(file);
        continue;
      }

      const sql = await readFile(resolve(directory, file), 'utf8');
      console.log(`[db] applying ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    await client.end();
  }

  return { applied, skipped };
}

const isCli = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isCli) {
  runMigrations()
    .then(({ applied, skipped }) => {
      console.log(
        `[db] done. applied=${applied.length}, skipped=${skipped.length}` +
          (applied.length ? ` (${applied.join(', ')})` : ''),
      );
    })
    .catch((error) => {
      console.error('[db] migration failed:', error);
      process.exitCode = 1;
    });
}
