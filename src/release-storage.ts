import { createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

/**
 * Reliz APK'lari qayerda saqlanadi.
 *
 * Bitta joyda jamlangan, chunki saqlash joyi o'zgarishi mumkin va
 * chaqiruvchi kod bundan xabardor bo'lmasligi kerak. Hozirgi amaliyot —
 * PostgreSQL: bu xizmat Render'ning bepul tarifida ishlaydi va u yerda
 * doimiy disk yo'q, ya'ni konteyner fayl tizimi har redeployda
 * tozalanadi.
 *
 * NEGA BO'LAKLAB: `node-postgres` `bytea` parametrini o'n oltilik MATN
 * sifatida uzatadi — 37 MB lik APK simda ~74 MB ga aylanadi. Bitta
 * so'rovda yuborilganda 512 MB lik instansiya o'lardi va nashr 502
 * qaytarardi. Har bir bo'lak alohida yoziladi, o'qishda esa oqim
 * ishlatiladi: to'liq fayl hech qachon xotiraga yig'ilmaydi.
 *
 * ESKI YOZUVLAR: `app_releases.storage_key` orqali diskka yozilgan
 * relizlar hali bo'lishi mumkin. O'qish yo'li avval bazaga, so'ng
 * diskka qaraydi.
 *
 * KELAJAKDA: obyekt xotirasi (R2/S3) paydo bo'lsa, faqat shu modul
 * almashtiriladi.
 */

/** Bazaga yozadigan minimal interfeys — `Pool` ham, `PoolClient` ham mos. */
export interface QueryExecutor {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

/**
 * Bo'lak hajmi.
 *
 * 4 MB — hex ko'rinishida ~8 MB, ya'ni bitta yozuv o'nlab megabayt
 * xotira bilan cheklanadi. Kichikroq bo'lak so'rovlar sonini keraksiz
 * oshirardi.
 */
export const ARTIFACT_CHUNK_BYTES = 4 * 1024 * 1024;

export function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface ArtifactMeta {
  sha256: string;
  sizeBytes: number;
}

/**
 * Artefaktni bo'laklab saqlaydi va saqlanganini tekshiradi.
 *
 * Tekshiruv baytlarni qayta o'qimaydi (bu yana xotirani to'ldirardi):
 * bo'laklar soni va ularning umumiy uzunligi bazada hisoblanadi.
 * Mos kelmasa xato tashlanadi va chaqiruvchi tranzaksiyani bekor
 * qiladi — buzilgan artefaktli reliz hech qachon faol bo'lmaydi.
 */
export async function putReleaseArtifact(
  executor: QueryExecutor,
  releaseId: string,
  bytes: Buffer,
  expectedSha256: string,
): Promise<void> {
  if (sha256Of(bytes) !== expectedSha256) {
    throw new Error('Artefakt checksumi kutilgan qiymatga mos kelmadi.');
  }

  await executor.query(
    `INSERT INTO app_release_artifacts (release_id, sha256, size_bytes)
     VALUES ($1::uuid, $2::text, $3::integer)
     ON CONFLICT (release_id) DO UPDATE
       SET sha256 = EXCLUDED.sha256, size_bytes = EXCLUDED.size_bytes, created_at = now()`,
    [releaseId, expectedSha256, bytes.length],
  );
  // Qayta yuklashda eski bo'laklar qolib ketmasligi kerak: yangi fayl
  // kichikroq bo'lsa, ortiqcha bo'laklar faylni buzardi.
  await executor.query('DELETE FROM app_release_artifact_chunks WHERE release_id = $1::uuid', [releaseId]);

  let index = 0;
  for (let offset = 0; offset < bytes.length; offset += ARTIFACT_CHUNK_BYTES) {
    // `subarray` nusxa olmaydi — faqat oyna. Nusxa xotirani ikkilantirardi.
    const chunk = bytes.subarray(offset, Math.min(offset + ARTIFACT_CHUNK_BYTES, bytes.length));
    await executor.query(
      'INSERT INTO app_release_artifact_chunks (release_id, chunk_index, bytes) VALUES ($1::uuid, $2::integer, $3::bytea)',
      [releaseId, index, chunk],
    );
    index += 1;
  }

  const stored = await executor.query(
    `SELECT count(*)::int AS chunks, COALESCE(sum(octet_length(bytes)), 0)::bigint AS total
       FROM app_release_artifact_chunks WHERE release_id = $1::uuid`,
    [releaseId],
  );
  const row = stored.rows[0];
  if (!row || Number(row.chunks) !== index || Number(row.total) !== bytes.length) {
    throw new Error('Artefakt saqlangandan keyin tekshiruvdan o‘tmadi.');
  }
}

export async function getReleaseArtifactMeta(
  executor: QueryExecutor,
  releaseId: string,
): Promise<ArtifactMeta | null> {
  const found = await executor.query(
    'SELECT sha256, size_bytes FROM app_release_artifacts WHERE release_id = $1::uuid',
    [releaseId],
  );
  const row = found.rows[0];
  return row ? { sha256: String(row.sha256), sizeBytes: Number(row.size_bytes) } : null;
}

export async function releaseArtifactExists(
  executor: QueryExecutor,
  releaseId: string,
): Promise<boolean> {
  return (await getReleaseArtifactMeta(executor, releaseId)) !== null;
}

/**
 * Artefaktni bo'lak-bo'lak uzatadigan oqim.
 *
 * Har bir bo'lak alohida so'raladi, shuning uchun javob yuborilayotgan
 * paytda xotirada bir vaqtning o'zida faqat bitta bo'lak turadi.
 */
export function streamReleaseArtifact(executor: QueryExecutor, releaseId: string): Readable {
  let index = 0;
  return new Readable({
    read() {
      void (async () => {
        try {
          const found = await executor.query(
            'SELECT bytes FROM app_release_artifact_chunks WHERE release_id = $1::uuid AND chunk_index = $2::integer',
            [releaseId, index],
          );
          const bytes = found.rows[0]?.bytes;
          if (!Buffer.isBuffer(bytes)) {
            this.push(null);
            return;
          }
          index += 1;
          this.push(bytes);
        } catch (error) {
          this.destroy(error instanceof Error ? error : new Error('Artefakt o‘qilmadi.'));
        }
      })();
    },
  });
}

export async function deleteReleaseArtifact(
  executor: QueryExecutor,
  releaseId: string,
): Promise<void> {
  // Bo'laklar CASCADE bilan ketadi.
  await executor.query('DELETE FROM app_release_artifacts WHERE release_id = $1::uuid', [releaseId]);
}

/**
 * Eski, diskka yozilgan artefakt yo'li.
 *
 * Yo'l saqlash katalogidan tashqariga chiqsa `null`: kalit bazadan
 * kelsa ham unga ishonib bo'lmaydi.
 */
export function safeLegacyPath(apkDir: string, storageKey: string | null): string | null {
  if (!storageKey) return null;
  const root = resolve(apkDir);
  const target = resolve(root, storageKey);
  return target !== root && target.startsWith(`${root}${sep}`) ? target : null;
}

export async function readLegacyArtifact(apkDir: string, storageKey: string | null): Promise<Buffer | null> {
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
