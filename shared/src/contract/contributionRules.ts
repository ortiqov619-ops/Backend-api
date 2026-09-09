import type { IsoDateTime } from './common';
import type { ContributionPayload } from './contributions';

/**
 * Hissa qo'shish formasida qaysi maydonlar majburiy.
 *
 * NEGA SOZLANADI: lug'atni to'ldirish bosqichiga qarab talab
 * o'zgaradi. Boshida ko'p maydon so'ralsa odam so'z qo'shmay ketadi;
 * keyinroq esa sifatni oshirish uchun, masalan, adabiy shakl yoki
 * talaffuz majburiy qilinishi mumkin. Buni har safar yangi reliz
 * chiqarmasdan loyiha egasi hal qiladi.
 *
 * `word`, `meaning` va hudud bu ro'yxatda YO'Q va ataylab: ularsiz
 * yozuvning o'zi ma'nosiz bo'lib qoladi, shuning uchun ular har doim
 * majburiy va ularni o'chirib bo'lmaydi.
 */
/**
 * Ro'yxat hissa qo'shish FORMASIDA haqiqatan bor maydonlardan iborat.
 *
 * Formada yo'q maydonni majburiy qilib bo'lmaydi: foydalanuvchi uni
 * to'ldira olmasdi va yuborish butunlay to'xtab qolardi. Shu sabab bu
 * yerda faqat ekranda ko'rinadigan uchta ixtiyoriy maydon turibdi.
 */
export const CONTRIBUTION_RULE_FIELDS = [
  'clan',
  'dialectId',
  'audio',
] as const;

export type ContributionRuleField = (typeof CONTRIBUTION_RULE_FIELDS)[number];

export const CONTRIBUTION_RULE_LABELS: Record<ContributionRuleField, string> = {
  clan: 'Urug‘ (yoki qabila)',
  dialectId: 'Sheva (lahja)',
  audio: 'Talaffuz yozuvi',
};

/** `true` — maydon majburiy. */
export type ContributionFieldRules = Record<ContributionRuleField, boolean>;

/**
 * Serverda tekshirib bo'ladigan maydonlar.
 *
 * `audio` bu ro'yxatda YO'Q va buni yashirmaslik kerak: talaffuz so'z
 * yozuvi yaratilgandan KEYIN, alohida so'rovda yuklanadi. Ya'ni so'z
 * qabul qilinayotgan paytda audio hali yo'q va uni o'sha yerda talab
 * qilish so'zning o'zini rad etishga olib kelardi. Shuning uchun
 * `audio` faqat FORMA talabi: ilova yozuvsiz yuborishga qo'ymaydi.
 */
export const SERVER_ENFORCED_CONTRIBUTION_FIELDS = CONTRIBUTION_RULE_FIELDS
  .filter((field): field is Exclude<ContributionRuleField, 'audio'> => field !== 'audio');

/**
 * Sukut bo'yicha hech biri majburiy emas.
 *
 * Server javob bermaganda ham shu qiymat ishlatiladi: noma'lum
 * sababga ko'ra formani bloklab qo'yishdan ko'ra, uni ochiq qoldirish
 * kamroq zarar qiladi — moderator baribir ko'radi.
 */
export const DEFAULT_CONTRIBUTION_FIELD_RULES: ContributionFieldRules = {
  clan: false,
  dialectId: false,
  audio: false,
};

/** Noma'lum kalitlarni tashlab, faqat ro'yxatdagi maydonlarni oladi. */
export function parseContributionFieldRules(input: unknown): ContributionFieldRules {
  const source = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
  const rules = { ...DEFAULT_CONTRIBUTION_FIELD_RULES };
  for (const field of CONTRIBUTION_RULE_FIELDS) {
    if (typeof source[field] === 'boolean') rules[field] = source[field];
  }
  return rules;
}

/**
 * Majburiy, lekin to'ldirilmagan maydonlar.
 *
 * `audio` payloadda emas — u alohida fayl sifatida keladi, shuning
 * uchun uning bor-yo'qligi chaqiruvchidan so'raladi.
 */
export function missingRequiredContributionFields(
  rules: ContributionFieldRules,
  payload: Pick<ContributionPayload, 'clan' | 'dialectId'>,
  options: { hasAudio?: boolean } = {},
): ContributionRuleField[] {
  const filled: Record<ContributionRuleField, boolean> = {
    clan: Boolean(payload.clan?.trim()),
    dialectId: Boolean(payload.dialectId?.trim()),
    audio: Boolean(options.hasAudio),
  };
  return CONTRIBUTION_RULE_FIELDS.filter((field) => rules[field] && !filled[field]);
}

/** GET /app/contribution-rules (ochiq) va GET /admin/contribution-rules */
export interface ContributionFieldRulesResponse {
  rules: ContributionFieldRules;
  updatedAt: IsoDateTime | null;
}

/** PUT /admin/contribution-rules */
export interface UpdateContributionFieldRulesRequest {
  rules: Partial<ContributionFieldRules>;
}
