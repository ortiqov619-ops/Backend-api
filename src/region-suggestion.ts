export const PROPOSED_REGION_LEVELS = ['district', 'village', 'neighborhood'] as const;

export type ProposedRegionLevel = (typeof PROPOSED_REGION_LEVELS)[number];
export type CanonicalRegionLevel = 'republic' | 'region' | ProposedRegionLevel;

export interface NormalizedRegionSuggestion {
  nameUz: string;
  level: ProposedRegionLevel;
  parentRegionId: string;
}

export interface RegionPublicationResolution {
  districtId: string | null;
  villageId: string | null;
  neighborhoodId: string | null;
  neighborhood: string | null;
  matchedRegionId: string | null;
  resolution: 'canonical' | 'generalized';
}

export class RegionSuggestionValidationError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = 'RegionSuggestionValidationError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_REGION_NAME = /^[\p{L}\p{M}\p{N}\s'‘’ʻʼ`.-]+$/u;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Hudud nomini katalog bilan solishtirish va takroriy takliflarni topish uchun. */
export function normalizeRegionName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[‘’ʻʼ`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('uz')
    .replace(/\s+(viloyati|tumani|shahri|qishlog'i|mahallasi)$/u, '');
}

/**
 * Mobil ilovadan kelgan "Boshqa hudud" qiymatini qat'iy allow-list bo‘yicha
 * normallashtiradi. Bu qiymat rasmiy `regions` jadvaliga avtomatik yozilmaydi;
 * u so‘z taklifi bilan birga moderator ko‘rishi uchun saqlanadi.
 */
export function parseRegionSuggestion(
  input: unknown,
  fallbackParentRegionId: string,
): NormalizedRegionSuggestion | null {
  if (input == null) return null;
  const value = asRecord(input);
  if (!value) throw new RegionSuggestionValidationError('Boshqa hudud ma’lumoti noto‘g‘ri.', 'payload.proposedRegion');

  const rawName = typeof value.nameUz === 'string' ? value.nameUz : '';
  const nameUz = rawName.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (nameUz.length < 2 || nameUz.length > 80) {
    throw new RegionSuggestionValidationError('Hudud nomi 2–80 ta belgidan iborat bo‘lishi kerak.', 'payload.proposedRegion.nameUz');
  }
  if (!SAFE_REGION_NAME.test(nameUz) || /https?:|www\.|@/iu.test(nameUz)) {
    throw new RegionSuggestionValidationError('Hudud nomida ruxsat etilmagan belgi bor.', 'payload.proposedRegion.nameUz');
  }
  if (['boshqa', 'other', 'hudud'].includes(normalizeRegionName(nameUz))) {
    throw new RegionSuggestionValidationError('Hududning aniq nomini kiriting.', 'payload.proposedRegion.nameUz');
  }

  const rawLevel = typeof value.level === 'string' ? value.level : 'district';
  if (!PROPOSED_REGION_LEVELS.includes(rawLevel as ProposedRegionLevel)) {
    throw new RegionSuggestionValidationError('Taklif qilinayotgan hudud turi noto‘g‘ri.', 'payload.proposedRegion.level');
  }

  const parentRegionId = typeof value.parentRegionId === 'string' && value.parentRegionId.trim()
    ? value.parentRegionId.trim()
    : fallbackParentRegionId;
  if (!UUID_PATTERN.test(parentRegionId)) {
    throw new RegionSuggestionValidationError('Hududning yuqori bo‘g‘ini noto‘g‘ri.', 'payload.proposedRegion.parentRegionId');
  }

  return { nameUz, level: rawLevel as ProposedRegionLevel, parentRegionId };
}

/**
 * Foydalanuvchi kiritadigan erkin matnli hudud maydonlari — mahalla nomi
 * va urug'/laqab.
 *
 * Ular `regions` katalogiga bog'lanmaydi va so'z bilan birga payloadda
 * saqlanadi, shuning uchun uzunlik va belgi to'plami aynan hudud nomi
 * bilan bir xil qat'iylikda tekshiriladi: havola, teg yoki uzun matn
 * moderator ekraniga tushmasligi kerak.
 *
 * Bo'sh qiymat xato emas — bu maydonlar ixtiyoriy.
 */
export function parseLocalIdentifier(
  input: unknown,
  field: string,
  options: { maxLength?: number } = {},
): string | null {
  if (input == null) return null;
  if (typeof input !== 'string') {
    throw new RegionSuggestionValidationError('Qiymat matn bo‘lishi kerak.', field);
  }
  const value = input.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!value) return null;
  const maxLength = options.maxLength ?? 80;
  if (value.length < 2 || value.length > maxLength) {
    throw new RegionSuggestionValidationError(`Qiymat 2–${maxLength} ta belgidan iborat bo‘lishi kerak.`, field);
  }
  if (!SAFE_REGION_NAME.test(value) || /https?:|www\.|@/iu.test(value)) {
    throw new RegionSuggestionValidationError('Qiymatda ruxsat etilmagan belgi bor.', field);
  }
  return value;
}

export function canBeChildOf(child: ProposedRegionLevel, parent: string): boolean {
  return canCreateRegionUnder(child, parent);
}

/** Rasmiy katalogga hudud qo‘shishdagi yagona parent/child qoidasi. */
export function canCreateRegionUnder(child: Exclude<CanonicalRegionLevel, 'republic'>, parent: string): boolean {
  if (child === 'region') return parent === 'republic';
  if (child === 'district') return parent === 'region';
  if (child === 'village') return parent === 'district';
  return parent === 'district' || parent === 'village';
}

/** Qishloq tanlangan tumaning bevosita farzandi bo‘lishi shart. */
export function isDirectVillageChild(
  village: { level: string; parentId: string | null } | null,
  districtId: string | null,
): boolean {
  return Boolean(village && districtId && village.level === 'village' && village.parentId === districtId);
}

/** Mahalla tanlangan qishloqning, u bo'lmasa tumanning bevosita farzandi bo'lishi shart. */
export function isDirectNeighborhoodChild(
  neighborhood: { level: string; parentId: string | null } | null,
  parentId: string | null,
): boolean {
  return Boolean(neighborhood && parentId && neighborhood.level === 'neighborhood' && neighborhood.parentId === parentId);
}

/** Eski mobil versiyalardagi `dialectId: "Og‘uz"` matnini canonical UUIDga moslash uchun. */
export function normalizeDialectLabel(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[‘’ʻʼ`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('uz');
}

export function uniqueDialectIdByLabel(
  input: string,
  dialects: readonly { id: string; code: string; nameUz: string }[],
): string | null {
  const normalized = normalizeDialectLabel(input);
  if (!normalized) return null;
  const matches = dialects.filter((dialect) =>
    normalizeDialectLabel(dialect.code) === normalized
    || normalizeDialectLabel(dialect.nameUz) === normalized,
  );
  return matches.length === 1 ? matches[0]!.id : null;
}

/**
 * Moderator tasdiqlaganda taklif nomi katalogda paydo bo‘lgan bo‘lsa aniq
 * UUIDga bog‘laydi; aks holda eng yaqin tasdiqlangan ota-hududgacha
 * umumlashtiradi. Hech qachon foydalanuvchi matnini FK o‘rnida ishlatmaydi.
 */
export function resolveRegionForPublication(
  suggestion: NormalizedRegionSuggestion,
  explicitSelection: {
    districtId?: string | null;
    villageId?: string | null;
    neighborhoodId?: string | null;
    neighborhood?: string | null;
  },
): RegionPublicationResolution {
  const districtId = explicitSelection.districtId ?? null;
  const villageId = explicitSelection.villageId ?? null;
  const neighborhoodId = explicitSelection.neighborhoodId ?? null;
  const neighborhood = explicitSelection.neighborhood?.trim() || null;
  const exactId = suggestion.level === 'district'
    ? districtId
    : suggestion.level === 'village'
      ? villageId
      : neighborhoodId;
  const canonical = Boolean(exactId);

  return {
    districtId,
    villageId,
    neighborhoodId,
    neighborhood,
    matchedRegionId: exactId,
    resolution: canonical ? 'canonical' : 'generalized',
  };
}
