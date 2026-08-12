/**
 * Xorazm shevasi qoida to'plami (rule pack).
 *
 * OGOHLANTIRISH: quyidagi ro'yxatlar — boshlang'ich (seed) qiymatlar.
 * Ular tilshunos ko'rigidan o'tishi va admin panel orqali kengaytirilishi
 * kerak. Hech bir avtomatik qoida yakuniy hukm chiqarmaydi; u faqat
 * moderatorga signal beradi.
 *
 * Har o'zgarishda `RULE_PACK_VERSION` oshiriladi va u har bir
 * `validation_results` yozuviga saqlanadi.
 */

export const RULE_PACK_NAME = 'xorazm-dialect-rules';
export const RULE_PACK_VERSION = '1.0.0';

/** Xorazm (o'g'uz) shevasiga xos belgi so'zlar. */
export const XORAZM_MARKER_WORDS: readonly string[] = [
  'gel',
  'geldi',
  'gelyatir',
  'gelaman',
  'git',
  'gitti',
  'gityatir',
  'gapiryatir',
  'boyatir',
  'bolyatir',
  'turur',
  'durur',
  'qarpiz',
  'gavun',
  'paqir',
  'yanga',
  'boldiz',
  'ata',
  'ana',
  'dada',
  'nema',
  'nemaga',
  'qanda',
  'qayda',
  'shoncha',
  'muncha',
  'hovlicha',
  'supra',
  'chorpoya',
  'ketmon',
  'yop',
  'tandir',
];

/**
 * Morfologik/fonetik belgilar. Har bir naqsh — o'g'uz yoki qipchoq
 * shevasiga xos ko'rsatkich.
 */
export interface DialectPattern {
  id: string;
  /** Fonetik kalit ustida emas, normallashtirilgan matn ustida tekshiriladi. */
  pattern: RegExp;
  label: string;
  weight: number;
}

export const XORAZM_DIALECT_PATTERNS: readonly DialectPattern[] = [
  { id: 'oghuz_gel', pattern: /\bg[eè]l\w*/u, label: 'o‘g‘uz «gel-» (kel-)', weight: 12 },
  { id: 'oghuz_git', pattern: /\bgit\w*/u, label: 'o‘g‘uz «git-» (ket-)', weight: 12 },
  { id: 'khorezm_yatir', pattern: /\w+(y|i)?atir\b/u, label: 'Xorazm «-yatir» hozirgi zamon', weight: 14 },
  { id: 'oghuz_dur', pattern: /\w+(dur|tur)ur\b/u, label: 'o‘g‘uz «-durur» qo‘shimchasi', weight: 10 },
  { id: 'kipchak_j', pattern: /\bj[oaeiu]\w{2,}/u, label: 'qipchoq y→j almashinuvi', weight: 8 },
  { id: 'khorezm_nema', pattern: /\bnem[ae]\w*/u, label: 'Xorazm «nema» (nima)', weight: 9 },
  { id: 'khorezm_qanda', pattern: /\b(qanda|qayda)\b/u, label: 'Xorazm «qanda/qayda»', weight: 9 },
  { id: 'oghuz_vowel', pattern: /[äöü]/u, label: 'o‘g‘uz unlilari (ä/ö/ü)', weight: 7 },
];

/**
 * Juda keng tarqalgan adabiy o'zbekcha shakllar. So'z aynan shulardan
 * biri bo'lsa — bu sheva birligi emas, adabiy so'z.
 */
export const STANDARD_UZBEK_FORMS: readonly string[] = [
  'kelmoq',
  'ketmoq',
  'bormoq',
  'qilmoq',
  'aytmoq',
  'bo‘lmoq',
  'bolmoq',
  'uy',
  'non',
  'suv',
  'kitob',
  'maktab',
  'bola',
  'odam',
  'ish',
  'kun',
  'yaxshi',
  'yomon',
  'katta',
  'kichik',
  'salom',
  'rahmat',
  'tarvuz',
  'qovun',
  'chelak',
  'nima',
  'qayerda',
];

/**
 * Haqoratli leksika ildizlari. Qisqa ildizlar faqat to'liq so'z sifatida,
 * uzunlari (>=4) prefiks sifatida tekshiriladi — noto'g'ri ishlashni
 * kamaytirish uchun.
 */
export const PROFANITY_ROOTS: readonly string[] = [
  'jalab',
  'ko‘tak',
  'kotak',
  'qanjiq',
  'haromi',
  'ablah',
  'padar',
  'onangni',
  'otangni',
  'sik',
  'sikay',
  'ame',
  'blyat',
  'blyad',
  'suka',
  'pizd',
  'huyn',
  'ebal',
  'fuck',
  'shit',
  'bitch',
];

/** Spam belgilari. */
export const SPAM_PATTERNS: readonly { id: string; pattern: RegExp; label: string }[] = [
  { id: 'url', pattern: /(https?:\/\/|www\.|t\.me\/|@[a-z0-9_]{4,})/i, label: 'havola yoki reklama' },
  { id: 'phone', pattern: /(\+?998|\b9\d{8}\b)[\d\s-]{6,}/, label: 'telefon raqami' },
  { id: 'money', pattern: /(so[‘'`]?m|dollar|\$\s?\d|narx|sotiladi|arzon)/i, label: 'savdo matni' },
  { id: 'shout', pattern: /[!?]{3,}/, label: 'ortiqcha tinish belgilari' },
];

export const TEXT_LIMITS = {
  wordMinLength: 2,
  wordMaxLength: 64,
  meaningMinLength: 3,
  meaningMaxLength: 600,
  /** Bir foydalanuvchidan soatiga ruxsat etilgan so'rovlar. */
  hourlyRateLimit: 20,
  /** Shundan yuqori o'xshashlik — dublikat deb hisoblanadi (0..1). */
  duplicateSimilarity: 0.86,
} as const;

/** Ruxsat etilgan belgilar: o'zbek lotin + kirill + tutuq + defis. */
export const ALLOWED_TEXT_PATTERN =
  /^[\p{Script=Latin}\p{Script=Cyrillic}0-9\s'‘’ʻʼ`´\-–—.,;:!?()"«»]+$/u;
