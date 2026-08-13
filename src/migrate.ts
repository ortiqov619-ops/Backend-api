import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config({ path: process.env.API_ENV_FILE ?? '.env' });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL muhit o‘zgaruvchisi kiritilmagan.');

/**
 * Migratsiyalar papkadan o'qiladi va nom bo'yicha tartiblanadi.
 *
 * Ilgari ro'yxat qo'lda yozilardi: yangi fayl qo'shilib, ro'yxatga
 * kiritilmasa, u jimgina o'tkazib yuborilardi va nosozlik faqat productionda
 * ko'rinardi.
 */
async function migrationFiles(root: string): Promise<string[]> {
  const entries = await readdir(root);
  return entries
    .filter((name) => name.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right, 'en'));
}

const db = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

async function runMigrations() {
try {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const root = resolve(process.cwd(), 'db/migrations');
  const migrations = await migrationFiles(root);
  if (!migrations.length) throw new Error('Migratsiya fayllari topilmadi.');
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
}

void runMigrations().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
