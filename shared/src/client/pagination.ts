/**
 * Serverdagi barcha sahifalarni yig'ish.
 *
 * Admin ro'yxatlari qidiruv va filtrni serverda bajaradi, lekin ekran
 * yakuniy ro'yxatni to'liq ko'rsatishi kerak — faqat birinchi sahifani
 * olish yozuvlarni jimgina yashirardi.
 *
 * Uch xavf ataylab yopilgan:
 *
 *   1. CHEKSIZ SIKL — `page` har iteratsiyada oshadi va yuqori chegara
 *      qat'iy. Server buzilgan `totalPages` qaytarsa ham sikl tugaydi.
 *   2. DUBLIKAT — sahifalar ketma-ket olinadi va oralarida yangi yozuv
 *      qo'shilishi mumkin; u holda ro'yxat suriladi va bitta element
 *      ikki sahifada uchraydi. React `keyExtractor` dublikat kalitda
 *      ro'yxatni noto'g'ri chizadi, shuning uchun kalit bo'yicha
 *      filtrlanadi.
 *   3. HADDAN TASHQARI SO'ROV — `maxPages` chegarasi.
 */

export interface PageEnvelope<T> {
  items: T[];
  meta: { totalPages: number };
}

export interface CollectPagesOptions<T> {
  /** Element identifikatori. `null` qaytsa element filtrlanmaydi. */
  keyOf?: (item: T) => string | null;
  /** Eng ko'p nechta sahifa olinadi. */
  maxPages?: number;
}

export const DEFAULT_MAX_PAGES = 250;

export function defaultPageKey(item: unknown): string | null {
  const id = (item as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : null;
}

export async function collectPages<T>(
  load: (page: number) => Promise<PageEnvelope<T>>,
  options: CollectPagesOptions<T> = {},
): Promise<T[]> {
  const keyOf = options.keyOf ?? defaultPageKey;
  const maxPages = Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES);
  const items: T[] = [];
  const seen = new Set<string>();
  let page = 1;
  let totalPages = 1;

  do {
    const response = await load(page);
    for (const item of response.items ?? []) {
      const key = keyOf(item);
      if (key !== null) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      items.push(item);
    }
    // Buzilgan meta (NaN, manfiy, cheksiz) bitta sahifaga tushiriladi.
    const reported = Number(response.meta?.totalPages);
    totalPages = Number.isFinite(reported) ? Math.max(1, Math.min(reported, maxPages)) : 1;
    page += 1;
  } while (page <= totalPages);

  return items;
}
