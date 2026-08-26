/**
 * Lotin ↔ Kiril ko‘rsatish qatlami.
 *
 * MUHIM: bu modul faqat KO‘RSATISH uchun. Bazadagi matn hech qachon
 * o‘girilmaydi — so‘z, ma’no va hudud nomlari qanday kiritilgan bo‘lsa
 * shundayligicha saqlanadi. Foydalanuvchi tanlagan yozuv faqat ekranga
 * chizishdan oldin qo‘llanadi, shuning uchun sozlamani qaytarish
 * ma’lumotga zarar yetkazmaydi.
 *
 * O‘girish o‘zbek imlosining amaldagi jufti bo‘yicha bajariladi. U ideal
 * emas (masalan «e» so‘z boshida «э», o‘rtasida «е» bo‘ladi va bunday
 * qoidalar kontekstga bog‘liq), shuning uchun aylanma o‘girish har doim
 * ham bir xil matn bermaydi. Aynan shu sabab ikkala yo‘nalish ham faqat
 * chizishda ishlatiladi.
 */

export type DisplayScript = 'latin' | 'cyrillic';

export const DISPLAY_SCRIPTS: readonly DisplayScript[] = ['latin', 'cyrillic'] as const;

export const DISPLAY_SCRIPT_LABELS: Record<DisplayScript, string> = {
  latin: 'Lotin',
  cyrillic: 'Кирил',
};

export function isDisplayScript(value: unknown): value is DisplayScript {
  return value === 'latin' || value === 'cyrillic';
}

/** Har xil apostrof shakllari bitta belgiga keltiriladi. */
const APOSTROPHES = /[‘’ʻʼ`´ʹ]/g;

/**
 * Lotincha juftliklar. Tartib muhim: uzunroq ketma-ketlik avval keladi,
 * aks holda «sh» «s» + «h» bo‘lib ajralib ketadi.
 */
const LATIN_TO_CYRILLIC: readonly (readonly [string, string])[] = [
  ["o'", 'ў'], ["O'", 'Ў'],
  ["g'", 'ғ'], ["G'", 'Ғ'],
  ['sh', 'ш'], ['Sh', 'Ш'], ['SH', 'Ш'],
  ['ch', 'ч'], ['Ch', 'Ч'], ['CH', 'Ч'],
  ['yo', 'ё'], ['Yo', 'Ё'], ['YO', 'Ё'],
  ['yu', 'ю'], ['Yu', 'Ю'], ['YU', 'Ю'],
  ['ya', 'я'], ['Ya', 'Я'], ['YA', 'Я'],
  ['ts', 'ц'], ['Ts', 'Ц'], ['TS', 'Ц'],
  ['a', 'а'], ['A', 'А'],
  ['b', 'б'], ['B', 'Б'],
  ['d', 'д'], ['D', 'Д'],
  ['e', 'е'], ['E', 'Е'],
  ['f', 'ф'], ['F', 'Ф'],
  ['g', 'г'], ['G', 'Г'],
  ['h', 'ҳ'], ['H', 'Ҳ'],
  ['i', 'и'], ['I', 'И'],
  ['j', 'ж'], ['J', 'Ж'],
  ['k', 'к'], ['K', 'К'],
  ['l', 'л'], ['L', 'Л'],
  ['m', 'м'], ['M', 'М'],
  ['n', 'н'], ['N', 'Н'],
  ['o', 'о'], ['O', 'О'],
  ['p', 'п'], ['P', 'П'],
  ['q', 'қ'], ['Q', 'Қ'],
  ['r', 'р'], ['R', 'Р'],
  ['s', 'с'], ['S', 'С'],
  ['t', 'т'], ['T', 'Т'],
  ['u', 'у'], ['U', 'У'],
  ['v', 'в'], ['V', 'В'],
  ['w', 'в'], ['W', 'В'],
  ['x', 'х'], ['X', 'Х'],
  ['y', 'й'], ['Y', 'Й'],
  ['z', 'з'], ['Z', 'З'],
  ["'", 'ъ'],
];

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '’', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ў: 'o‘', ғ: 'g‘', қ: 'q', ҳ: 'h', ҷ: 'j', ӣ: 'i',
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ё: 'Yo', Ж: 'J', З: 'Z',
  И: 'I', Й: 'Y', К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P', Р: 'R',
  С: 'S', Т: 'T', У: 'U', Ф: 'F', Х: 'X', Ц: 'Ts', Ч: 'Ch', Ш: 'Sh',
  Щ: 'Shch', Ъ: '’', Ы: 'I', Ь: '', Э: 'E', Ю: 'Yu', Я: 'Ya',
  Ў: 'O‘', Ғ: 'G‘', Қ: 'Q', Ҳ: 'H', Ҷ: 'J', Ӣ: 'I',
};

const CYRILLIC_PATTERN = /[Ѐ-ӿ]/;

/** Matnda kirilcha harf bormi. */
export function hasCyrillic(value: string): boolean {
  return CYRILLIC_PATTERN.test(value);
}

/**
 * Lotincha matnni kirilchaga o‘giradi.
 *
 * Allaqachon kirilcha bo‘lgan bo‘laklar tegilmaydi: admin ba’zi
 * yozuvlarni kirilcha kiritishi mumkin va ularni ikki marta o‘girish
 * matnni buzardi.
 */
export function toCyrillicScript(value: string): string {
  if (!value) return value;
  const normalized = value.normalize('NFKC').replace(APOSTROPHES, "'");
  let result = '';
  let index = 0;
  outer: while (index < normalized.length) {
    for (const [latin, cyrillic] of LATIN_TO_CYRILLIC) {
      if (normalized.startsWith(latin, index)) {
        result += cyrillic;
        index += latin.length;
        continue outer;
      }
    }
    result += normalized[index];
    index += 1;
  }
  return result;
}

/** Kirilcha matnni lotinchaga o‘giradi. Lotincha bo‘laklar tegilmaydi. */
export function toLatinScript(value: string): string {
  if (!value) return value;
  let result = '';
  for (const character of value.normalize('NFKC')) {
    const mapped = CYRILLIC_TO_LATIN[character];
    result += mapped === undefined ? character : mapped;
  }
  return result;
}

/**
 * Tanlangan yozuvda ko‘rsatish uchun matn.
 *
 * `latin` tanlanganda kirilcha yozuvlar ham lotinga keltiriladi, shuning
 * uchun ro‘yxat aralash yozuvda ham bir xil ko‘rinadi.
 */
export function applyDisplayScript(value: string, script: DisplayScript): string {
  if (!value) return value;
  return script === 'cyrillic' ? toCyrillicScript(value) : toLatinScript(value);
}

/**
 * Qidiruv uchun yozuvdan mustaqil kalit.
 *
 * Foydalanuvchi «шамол» deb yozsa ham, «shamol» deb yozsa ham bir xil
 * natija chiqishi kerak — shuning uchun ikkala tomon ham lotinga
 * keltirilib, apostrof va registr olib tashlanadi.
 */
export function foldScript(value: string): string {
  return toLatinScript(value)
    .normalize('NFKC')
    .replace(APOSTROPHES, '')
    .replace(/'/g, '')
    .toLocaleLowerCase('en');
}
