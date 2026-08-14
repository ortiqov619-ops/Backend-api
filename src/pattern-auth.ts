/**
 * Grafik (naqsh) parol — 3×3 to'rdagi nuqtalar ketma-ketligi.
 *
 * Nuqtalar 0..8 raqamlari bilan belgilanadi:
 *
 *     0 1 2
 *     3 4 5
 *     6 7 8
 *
 * Naqsh paroldan ko'ra ancha kam variantli: eng kamida 4 nuqta shart
 * qo'yilganda ham barcha mumkin bo'lgan naqshlar soni ~390 mingdan oshmaydi.
 * Shu sababli naqshning o'zi hech qachon xavfsizlikning yagona qatlami emas —
 * urinishlar soni cheklanadi va hisob vaqtincha qulflanadi (`users.locked_until`).
 * Naqsh bcrypt bilan xeshlanadi, xuddi parol kabi.
 */

export const PATTERN_GRID_SIZE = 9;
export const PATTERN_MIN_NODES = 4;
export const PATTERN_MAX_NODES = PATTERN_GRID_SIZE;

/** Noto'g'ri kiritilgan naqsh yoki hisob ma'lumoti. Foydalanuvchiga ko'rsatiladi. */
export class PatternValidationError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'PatternValidationError';
  }
}

/**
 * Naqshni tekshiradi va bcrypt'ga beriladigan barqaror matnga aylantiradi.
 *
 * Qaytariladigan matn kanonik: bir xil chizilgan naqsh har doim bir xil
 * satrga aylanadi, shuning uchun xesh mos keladi.
 */
export function normalizePattern(value: unknown): string {
  if (!Array.isArray(value)) {
    throw new PatternValidationError('pattern', 'Naqsh nuqtalari ro‘yxat sifatida yuborilishi kerak.');
  }
  if (value.length < PATTERN_MIN_NODES) {
    throw new PatternValidationError('pattern', `Naqsh kamida ${PATTERN_MIN_NODES} ta nuqtadan iborat bo‘lsin.`);
  }
  if (value.length > PATTERN_MAX_NODES) {
    throw new PatternValidationError('pattern', 'Naqshda 9 tadan ortiq nuqta bo‘lishi mumkin emas.');
  }

  const nodes: number[] = [];
  for (const node of value) {
    // `1.0` emas, aynan butun son kutamiz: mijoz float yuborsa xesh
    // mos kelmay qolishi mumkin edi.
    if (typeof node !== 'number' || !Number.isInteger(node) || node < 0 || node >= PATTERN_GRID_SIZE) {
      throw new PatternValidationError('pattern', 'Naqsh nuqtalari 0 dan 8 gacha butun son bo‘lishi kerak.');
    }
    if (nodes.includes(node)) {
      throw new PatternValidationError('pattern', 'Bir nuqta naqshda faqat bir marta ishtirok etadi.');
    }
    nodes.push(node);
  }

  return nodes.join('-');
}

/**
 * Juda oson topiladigan naqshlarni rad etadi.
 *
 * To'g'ri chiziq (masalan yuqori qator yoki chap ustun) va to'rt burchakni
 * aylanib chiqish — eng ko'p uchraydigan naqshlar. Bularni to'sish naqshning
 * kam entropiyasini biroz qoplaydi.
 */
const TOO_COMMON = new Set([
  '0-1-2', '3-4-5', '6-7-8', '0-3-6', '1-4-7', '2-5-8', '0-4-8', '2-4-6',
].flatMap((line) => [line, line.split('-').reverse().join('-')]));

export function isTooSimplePattern(canonical: string): boolean {
  const nodes = canonical.split('-');
  // To'liq bir chiziq: "0-1-2" kabi uchta nuqtali chiziqning boshlanishi
  // butun naqshni tashkil qilsa.
  if (TOO_COMMON.has(canonical)) return true;
  // Ketma-ket qo'shni raqamlar (0-1-2-3, 8-7-6-5) — barmoq bilan chizishda
  // eng tabiiy va shu sababli eng ko'p tanlanadigan yo'l.
  const steps = nodes.slice(1).map((node, index) => Number(node) - Number(nodes[index]));
  return steps.every((step) => step === 1) || steps.every((step) => step === -1);
}

/** Foydalanuvchi nomi: qidirish va kirish uchun barqaror, kichik harfli. */
export function normalizeUsername(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw.length < 3 || raw.length > 20) {
    throw new PatternValidationError('username', 'Foydalanuvchi nomi 3 tadan 20 tagacha belgidan iborat bo‘lsin.');
  }
  if (!/^[a-z0-9._]+$/.test(raw)) {
    throw new PatternValidationError('username', 'Foydalanuvchi nomida faqat lotin harflari, raqam, nuqta va pastki chiziq bo‘ladi.');
  }
  if (!/^[a-z]/.test(raw)) {
    throw new PatternValidationError('username', 'Foydalanuvchi nomi harf bilan boshlansin.');
  }
  return raw;
}

/** Ko'rsatiladigan ism. Bo'sh bo'lsa foydalanuvchi nomi ishlatiladi. */
export function normalizeDisplayName(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!raw) return fallback;
  if (raw.length > 40) {
    throw new PatternValidationError('displayName', 'Ism 40 ta belgidan oshmasin.');
  }
  return raw;
}

/**
 * Hisob qulflanganmi va qachongacha.
 *
 * Naqsh kam variantli bo'lgani uchun qulflash ixtiyoriy emas: usiz naqshni
 * ketma-ket urinib topish mumkin bo'lardi.
 */
export const PATTERN_MAX_ATTEMPTS = 5;
export const PATTERN_LOCK_MINUTES = 15;

export function lockStateFor(failedCount: number, now: Date): { locked: boolean; until: Date | null } {
  if (failedCount < PATTERN_MAX_ATTEMPTS) return { locked: false, until: null };
  return { locked: true, until: new Date(now.getTime() + PATTERN_LOCK_MINUTES * 60_000) };
}

export function remainingLockMs(lockedUntil: Date | string | null, now: Date): number {
  if (!lockedUntil) return 0;
  const until = lockedUntil instanceof Date ? lockedUntil : new Date(lockedUntil);
  const remaining = until.getTime() - now.getTime();
  return remaining > 0 ? remaining : 0;
}
