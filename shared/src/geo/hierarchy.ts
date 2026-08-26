import type { Dialect, Region, RegionLevel } from '../contract/geo';

/**
 * Hudud ierarxiyasi bo'yicha tanlov mantiqi.
 *
 * Ierarxiya:
 *
 *   respublika/davlat → viloyat → shahar/tuman → qishloq (oba, ovul,
 *   jamoa xo'jaligi) → mahalla
 *
 * Urug'/laqab va lahja alohida daraja EMAS: bitta qishloqda bir nechta
 * urug' va lahja yonma-yon yashaydi, shuning uchun ular so'zning o'z
 * maydonlari (`Word.clan`, `Word.dialectId`).
 *
 * Sof funksiyalar `packages/shared` da turadi: ular test bilan
 * qoplanadi va ilova ham, admin ham bir xil qoidaga bo'ysunadi.
 */

export interface RegionTree {
  /** Kamida bitta hissa ochiq viloyati bor respublikalar. */
  countries: Region[];
  /** Berilgan ota-hudud ostidagi, hissa ochiq bo'lgan farzandlar. */
  childrenOf: (parentId: string | null, level: RegionLevel) => Region[];
}

function byName(left: Region, right: Region): number {
  return left.nameUz.localeCompare(right.nameUz, 'uz');
}

export function buildRegionTree(regions: readonly Region[]): RegionTree {
  const openProvinces = regions.filter((region) => region.level === 'region' && region.isContributionAllowed);
  const openParentIds = new Set(openProvinces.map((region) => region.parentId).filter((id): id is string => Boolean(id)));

  // Respublikaning o'zi hech qachon "hissa ochiq" bo'lmaydi (u so'z
  // yuboriladigan daraja emas), shuning uchun mezon — ostida ochiq
  // viloyat borligi. Aks holda ro'yxat har doim bo'sh qolardi.
  const countries = regions
    .filter((region) => region.level === 'republic' && openParentIds.has(region.id))
    .sort(byName);

  const childrenOf = (parentId: string | null, level: RegionLevel): Region[] => {
    if (!parentId) return [];
    return regions
      .filter((region) => region.level === level && region.parentId === parentId && region.isContributionAllowed)
      .sort(byName);
  };

  return { countries, childrenOf };
}

/**
 * Tanlangan hududga tegishli lahjalar.
 *
 * Lahja hududga `dialect_regions` orqali bog'lanadi. Mos lahja
 * topilmasa barcha faol lahjalar qaytadi: ro'yxatni bo'sh qoldirish
 * foydalanuvchidan tanlovni umuman yashirardi.
 */
export function dialectsForRegion(
  dialects: readonly Dialect[],
  regionIds: readonly (string | null | undefined)[],
): Dialect[] {
  const active = dialects.filter((dialect) => dialect.isActive);
  const selected = new Set(regionIds.filter((id): id is string => Boolean(id)));
  const matching = active.filter((dialect) => dialect.regionIds.some((id) => selected.has(id)));
  return (matching.length ? matching : active).sort((left, right) => left.nameUz.localeCompare(right.nameUz, 'uz'));
}

/** Ro'yxatda ko'rsatiladigan nom — eski nom bo'lsa qavs ichida. */
export function regionOptionLabel(region: Region): string {
  return region.formerName ? `${region.nameUz} (${region.formerName})` : region.nameUz;
}
