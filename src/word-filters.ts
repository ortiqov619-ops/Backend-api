/**
 * `GET /v3/words` filtrini yig'ish.
 *
 * Alohida modulda, chunki aynan shu yerda ikkita nuqson bor edi va
 * ularni route ichida test qilib bo'lmasdi:
 *
 *   1. Tokensiz so'rovda `status` filtri jimgina `published` ga
 *      almashtirilardi. Admin ilovasi ro'yxatni AYNAN tokensiz olardi,
 *      shuning uchun «Qoralama» va «Arxivlangan» filtrlari nashr
 *      etilgan so'zlarni ko'rsatardi — moderator buni «filtr
 *      ishlamayapti» deb ko'rdi.
 *
 *   2. `status` qiymati tekshirilmasdan to'g'ridan-to'g'ri `word_status`
 *      enumiga solishtirilardi: noto'g'ri qiymat 500 qaytarardi.
 *
 * Ochiq ro'yxat xavfsizligi shu yerda kafolatlanadi: `isAdmin` false
 * bo'lsa `status = 'published'` sharti HAR DOIM qo'shiladi va uni
 * so'rov parametri bilan bekor qilib bo'lmaydi.
 */

export const WORD_STATUSES = ['draft', 'published', 'archived'] as const;
export type WordStatusFilter = (typeof WORD_STATUSES)[number];

export class WordFilterValidationError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = 'WordFilterValidationError';
  }
}

export interface WordFilterInput {
  status?: unknown;
  search?: unknown;
  regionId?: unknown;
  dialectId?: unknown;
  category?: unknown;
  hasAudio?: unknown;
}

export interface WordFilterResult {
  /** `WHERE` bandi (bo'sh bo'lsa `''`). */
  clause: string;
  params: unknown[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function boolFilter(value: unknown, field: string): boolean | null {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).toLowerCase();
  if (text === 'true') return true;
  if (text === 'false') return false;
  throw new WordFilterValidationError(`${field} true yoki false bo‘lishi kerak.`, field);
}

/**
 * @param hasAudioSql `EXISTS(...)` ko'rinishidagi shart — u `words w`
 * aliasiga tayanadi va route bilan bir xil bo'lishi uchun tashqaridan
 * beriladi.
 */
export function buildWordListFilters(
  query: WordFilterInput,
  options: { isAdmin: boolean; hasAudioSql: string },
): WordFilterResult {
  const params: unknown[] = [];
  const where: string[] = [];

  const requestedStatus = trimmed(query.status);
  if (!options.isAdmin) {
    // Ochiq lug'at: faqat nashr etilgan so'zlar. So'rovdagi `status`
    // e'tiborga olinmaydi — bu qasddan, chunki tokensiz so'rov bilan
    // qoralamani ko'rsatib bo'lmasligi kerak.
    where.push(`w.status = 'published'`);
  } else if (requestedStatus && requestedStatus !== 'all') {
    if (!WORD_STATUSES.includes(requestedStatus as WordStatusFilter)) {
      throw new WordFilterValidationError('So‘z holati noto‘g‘ri.', 'status');
    }
    params.push(requestedStatus);
    where.push(`w.status = $${params.length}::word_status`);
  }
  // Admin + `status` yo'q yoki `all` — holat bo'yicha filtr qo'yilmaydi.

  const search = trimmed(query.search);
  if (search) {
    params.push(`%${search}%`);
    where.push(`(w.word ILIKE $${params.length} OR w.meaning ILIKE $${params.length} OR COALESCE(w.literary_form, '') ILIKE $${params.length})`);
  }

  const regionId = trimmed(query.regionId);
  if (regionId) {
    if (!UUID_PATTERN.test(regionId)) throw new WordFilterValidationError('Hudud identifikatori noto‘g‘ri.', 'regionId');
    params.push(regionId);
    // Hudud bo'yicha qidiruv ierarxiyaning to'rt pog'onasini ham qamraydi:
    // viloyat tanlansa uning tumanidagi so'zlar ham chiqishi kerak.
    where.push(`(w.region_id = $${params.length} OR w.district_id = $${params.length} OR w.village_id = $${params.length} OR w.neighborhood_id = $${params.length})`);
  }

  const dialectId = trimmed(query.dialectId);
  if (dialectId) {
    if (!UUID_PATTERN.test(dialectId)) throw new WordFilterValidationError('Lahja identifikatori noto‘g‘ri.', 'dialectId');
    params.push(dialectId);
    where.push(`w.dialect_id = $${params.length}`);
  }

  const category = trimmed(query.category);
  if (category) {
    params.push(category);
    where.push(`w.category = $${params.length}`);
  }

  const hasAudio = boolFilter(query.hasAudio, 'hasAudio');
  if (hasAudio !== null) {
    where.push(`${hasAudio ? '' : 'NOT '}${options.hasAudioSql}`);
  }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}
