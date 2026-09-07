import { createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

/**
 * Reliz APK'lari qayerda saqlanadi.
 *
 * Bitta joyda jamlangan, chunki saqlash joyi o'zgarishi mumkin va
 * chaqiruvchi kod bundan xabardor bo'lmasligi kerak. Hozirgi amaliyot —
 * PostgreSQL: bu xizmat Render'ning bepul tarifida ishlaydi va u yerda
 * doimiy disk yo'q, ya'ni konteyner fayl tizimi har redeployda
 * tozalanadi.
 *
 * ESKI YOZUVLAR: `app_releases.storage_key` orqali diskka yozilgan
 * relizlar hali bo'lishi mumkin. O'qish yo'li avval bazaga, so'ng
 * diskka qaraydi — shuning uchun migratsiyadan oldin nashr qilingan
 * reliz ham konteyner qayta ishga tushmagunicha ishlashda davom etadi.
 *
 * KELAJAKDA: doimiy disk yoki obyekt xotirasi (R2/S3) paydo bo'lsa,
 * faqat shu modulning ichi almashtiriladi.
 */

/** Bazaga yozadigan minimal interfeys — `Pool` ham, `PoolClient` ham mos. */
export interface QueryExecutor {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

export function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Artefaktni saqlaydi va DARHOL qayta o'qib tekshiradi.
 *
 * Yozilgan bayt massivi kutilgan checksumga mos kelmasa xato tashlanadi
 * va chaqiruvchi tranzaksiyani bekor qiladi — buzilgan artefaktli reliz
 * hech qachon faol bo'lmaydi.
 */
export async function putReleaseArtifact(
  executor: QueryExecutor,
  releaseId: string,
  bytes: Buffer,
  expectedSha256: string,
): Promise<void> {
  const actual = sha256Of(bytes);
  if (actual !== expectedSha256) {
    throw new Error('Artefakt checksumi kutilgan qiymatga mos kelmadi.');
  }
  await executor.query(
    `INSERT INTO app_release_artifacts (release_id, bytes, sha256, size_bytes)
     VALUES ($1::uuid, $2::bytea, $3::text, $4::integer)
     ON CONFLICT (release_id) DO UPDATE
       SET bytes = EXCLUDED.bytes,
           sha256 = EXCLUDED.sha256,
           size_bytes = EXCLUDED.size_bytes,
           created_at = now()`,
    [releaseId, bytes, expectedSha256, bytes.length],
  );

  // Qayta o'qish: `bytea` uzatishda buzilgan bo'lsa, buni nashrdan
  // OLDIN bilish kerak. Faqat checksum va hajm o'qiladi.
  const stored = await executor.query(
    'SELECT sha256, size_bytes FROM app_release_artifacts WHERE release_id = $1::uuid',
    [releaseId],
  );
  const row = stored.rows[0];
  if (!row || String(row.sha256) !== expectedSha256 || Number(row.size_bytes) !== bytes.length) {
    throw new Error('Artefakt saqlangandan keyin tekshiruvdan o‘tmadi.');
  }
}

/** Artefakt baytlari. Topilmasa `null`. */
export async function getReleaseArtifact(
  executor: QueryExecutor,
  releaseId: string,
  legacy: { apkDir: string; storageKey: string | null },
): Promise<Buffer | null> {
  const found = await executor.query(
    'SELECT bytes FROM app_release_artifacts WHERE release_id = $1::uuid',
    [releaseId],
  );
  const bytes = found.rows[0]?.bytes;
  if (Buffer.isBuffer(bytes)) return bytes;
  return readLegacyArtifact(legacy.apkDir, legacy.storageKey);
}

/** Baytlarni o'qimasdan mavjudligini tekshiradi. */
export async function releaseArtifactExists(
  executor: QueryExecutor,
  releaseId: string,
): Promise<boolean> {
  const found = await executor.query(
    'SELECT 1 FROM app_release_artifacts WHERE release_id = $1::uuid',
    [releaseId],
  );
  return Boolean(found.rows[0]);
}

export async function deleteReleaseArtifact(
  executor: QueryExecutor,
  releaseId: string,
): Promise<void> {
  await executor.query('DELETE FROM app_release_artifacts WHERE release_id = $1::uuid', [releaseId]);
}

/**
 * Eski, diskka yozilgan artefakt.
 *
 * Yo'l saqlash katalogidan tashqariga chiqsa o'qilmaydi: kalit bazadan
 * kelsa ham unga ishonib bo'lmaydi.
 */
export function safeLegacyPath(apkDir: string, storageKey: string | null): string | null {
  if (!storageKey) return null;
  const root = resolve(apkDir);
  const target = resolve(root, storageKey);
  return target !== root && target.startsWith(`${root}${sep}`) ? target : null;
}

async function readLegacyArtifact(apkDir: string, storageKey: string | null): Promise<Buffer | null> {
  const path = safeLegacyPath(apkDir, storageKey);
  if (!path) return null;
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

export async function deleteLegacyArtifact(apkDir: string, storageKey: string | null): Promise<void> {
  const path = safeLegacyPath(apkDir, storageKey);
  if (!path) return;
  await unlink(path).catch(() => undefined);
}
