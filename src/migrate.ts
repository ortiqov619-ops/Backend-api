import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config({ path: process.env.API_ENV_FILE ?? '.env' });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL muhit o‘zgaruvchisi kiritilmagan.');

const migrations = [
  '0001_core_schema.sql',
  '0002_seed_reference_data.sql',
  '0004_app_open_events.sql',
  '0005_community_interactions.sql',
];

const db = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

try {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const root = resolve(process.cwd(), 'db/migrations');
  for (const name of migrations) {
    const alreadyApplied = await db.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
    if (alreadyApplied.rowCount) {
      console.log(`O‘tkazib yuborildi: ${name}`);
      continue;
    }

    const sql = await readFile(resolve(root, name), 'utf8');
    await db.query(sql);
    await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    console.log(`Bajarildi: ${name}`);
  }
} finally {
  await db.end();
}
