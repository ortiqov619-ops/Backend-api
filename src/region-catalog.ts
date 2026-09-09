import { regionCodeFromName } from './region-suggestion';

/**
 * Tasdiqlangan hudud taklifini rasmiy katalogga yozish.
 *
 * NEGA ALOHIDA MODUL: bu yerdagi SQL turlar deduksiyasiga bog'liq va
 * TypeScript uni ko'rmaydi — xato faqat haqiqiy PostgreSQL parseriga
 * yetganda chiqadi. Server ichida qolganda uni test bilan chaqirib
 * bo'lmasdi.
 */

/** Bazaga yozadigan minimal interfeys — `Pool` ham, `PoolClient` ham mos. */
export interface QueryExecutor {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

export interface RegionProposal {
  nameUz: string;
  level: string;
  /** Davlat taklifida `null`. */
  parentRegionId: string | null;
}

/** Kod band bo'lsa shuncha marta raqam qo'shib ko'riladi. */
export const REGION_CODE_ATTEMPTS = 20;

export class RegionCodeExhaustedError extends Error {
  constructor() {
    super('Hudud kodi band — nomni biroz o‘zgartirib qayta urinib ko‘ring.');
    this.name = 'RegionCodeExhaustedError';
  }
}

/**
 * Hududni yaratadi va uning identifikatorini qaytaradi.
 *
 * `is_contribution_allowed = true`: loyiha egasi bu nomni ataylab qabul
 * qildi va talab aynan shu — nom tanlovlar ro'yxatida paydo bo'lsin.
 * Ilova ro'yxatlari yopiq hududlarni ko'rsatmaydi, ya'ni yopiq
 * yaratilsa nom hech qachon ko'rinmasdi.
 *
 * `code` unikal, shuning uchun nomdan hosil qilingan kod band bo'lsa
 * oxiriga raqam qo'shiladi. Faqat `23505` (unique violation) qayta
 * urinishga sabab bo'ladi — qolgan xatolar yuqoriga uzatiladi.
 */
export async function createRegionFromProposal(
  executor: QueryExecutor,
  proposal: RegionProposal,
  moderatorId: string,
): Promise<string> {
  const base = regionCodeFromName(proposal.nameUz);
  for (let attempt = 0; attempt < REGION_CODE_ATTEMPTS; attempt += 1) {
    const code = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      const created = await executor.query(
        `INSERT INTO regions (code, name_uz, parent_id, level, is_contribution_allowed, sort_order, created_by, updated_by)
         VALUES ($1::text, $2::text, $3::uuid, $4::region_level, true,
                 COALESCE((SELECT max(sort_order) + 1 FROM regions), 1), $5::uuid, $5::uuid)
         RETURNING id`,
        [code, proposal.nameUz, proposal.parentRegionId, proposal.level, moderatorId],
      );
      return String(created.rows[0]!.id);
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') throw error;
    }
  }
  throw new RegionCodeExhaustedError();
}
