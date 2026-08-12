/**
 * O'zbek lotin yozuvi uchun soddalashtirilgan fonetik normallashtirish.
 * Maqsad — imlo variantlari (o‘/o'/oʻ, sh/ş, q/k, x/h) bir xil kalitga
 * tushishi. Bu IPA emas; duplicate topish va talaffuz taqqoslash uchun.
 */

const APOSTROPHES = /[ʻʼ‘’'`´]/g;

/** Ko'rinishni saqlagan holda faqat bo'shliq/registrni tozalaydi. */
export function normalizeDisplay(input: string): string {
  return input.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Taqqoslash uchun tozalangan, lekin hali fonetik bo'lmagan shakl. */
export function normalizeForCompare(input: string): string {
  return normalizeDisplay(input).toLocaleLowerCase('uz');
}

const CHAR_MAP: Record<string, string> = {
  ä: 'a',
  á: 'a',
  â: 'a',
  ə: 'a',
  ö: 'o',
  ó: 'o',
  ô: 'o',
  õ: 'o',
  ü: 'u',
  ú: 'u',
  í: 'i',
  ı: 'i',
  é: 'e',
  ğ: 'g',
  ǵ: 'g',
  ş: 'S',
  ç: 'C',
  ñ: 'N',
  w: 'v',
  c: 's',
  x: 'h',
  q: 'k',
  y: 'j',
};

/**
 * Fonetik kalit. Bir xil talaffuzli yozuvlar bir xil kalit beradi.
 * Masalan: `qo‘shko‘pir` va `koshkopir` → `kaSkapir` emas, `koSkopir`.
 */
export function phoneticKey(input: string): string {
  let s = normalizeForCompare(input).replace(APOSTROPHES, '');
  // Digraflar avval — alohida harflarga bo'linib ketmasin.
  s = s
    .replace(/sh/g, 'ş')
    .replace(/ch/g, 'ç')
    .replace(/ng/g, 'ñ')
    .replace(/ts/g, 's')
    .replace(/kh/g, 'h');
  let out = '';
  for (const ch of s) {
    if (/[a-zа-я0-9şçñäöüğəıáéíóôõúâǵ]/i.test(ch)) out += CHAR_MAP[ch] ?? ch;
  }
  // Ketma-ket takrorlangan harflarni bittaga tushiramiz: `salaaam` → `salam`.
  out = out.replace(/(.)\1+/g, '$1');
  return out;
}

/** Levenshtein masofasi (O(n·m) xotira-tejamkor variant). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = curr.slice();
  }
  return prev[b.length]!;
}

/** 0..1 oralig'idagi o'xshashlik. */
export function similarityRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

/** Fonetik kalitlar bo'yicha o'xshashlik, 0..1. */
export function phoneticSimilarity(a: string, b: string): number {
  return similarityRatio(phoneticKey(a), phoneticKey(b));
}

/**
 * Talaffuz o'xshashligi, 0–100.
 * Kutilgan so'z bilan STT transkripti taqqoslanadi. Transkript bir necha
 * so'zdan iborat bo'lsa, eng mos bo'lagi olinadi.
 */
export function pronunciationSimilarityScore(expected: string, transcript: string): number {
  const key = phoneticKey(expected);
  if (!key) return 0;
  const tokens = normalizeForCompare(transcript).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  let best = similarityRatio(key, phoneticKey(transcript));
  for (const token of tokens) {
    const ratio = similarityRatio(key, phoneticKey(token));
    if (ratio > best) best = ratio;
  }
  return Math.round(best * 100);
}
