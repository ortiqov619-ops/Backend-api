import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { APPLICATION_API_KEY_SCOPES, type ApplicationApiKeyScope } from '@xorazm/shared';

const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{12}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface GeneratedApplicationApiKey {
  token: string;
  publicId: string;
  secretHash: string;
  maskedHint: string;
}

/** 328 bitdan ortiq tasodifiy material: 72 bit public lookup va 256 bit secret. */
export function generateApplicationApiKey(): GeneratedApplicationApiKey {
  const publicId = randomBytes(9).toString('base64url');
  const secret = randomBytes(32).toString('base64url');
  const token = `xsk_${publicId}_${secret}`;
  return {
    token,
    publicId,
    secretHash: hashApplicationApiKey(token),
    maskedHint: `xsk_${publicId}_…${secret.slice(-4)}`,
  };
}

export function hashApplicationApiKey(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Public ID indekslangan lookup uchun, secret esa faqat hash solishtirish uchun. */
export function parseApplicationApiKey(token: string): { publicId: string } | null {
  const match = /^xsk_([A-Za-z0-9_-]{12})_([A-Za-z0-9_-]{43})$/.exec(token.trim());
  if (!match || !PUBLIC_ID_PATTERN.test(match[1]!) || !SECRET_PATTERN.test(match[2]!)) return null;
  return { publicId: match[1]! };
}

export function matchesApplicationApiKey(token: string, storedHash: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(storedHash)) return false;
  const candidate = Buffer.from(hashApplicationApiKey(token), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function parseApplicationApiKeyScopes(input: unknown): ApplicationApiKeyScope[] {
  if (!Array.isArray(input)) throw new Error('Kamida bitta ruxsat tanlang.');
  const allowed = new Set<string>(APPLICATION_API_KEY_SCOPES);
  const scopes = [...new Set(input.filter((scope): scope is string => typeof scope === 'string'))];
  if (!scopes.length || scopes.some((scope) => !allowed.has(scope))) {
    throw new Error('API kalit ruxsatlari noto‘g‘ri.');
  }
  return scopes as ApplicationApiKeyScope[];
}

/**
 * Saqlangan ruxsatlarni xavfsiz o'qish.
 *
 * `parseApplicationApiKeyScopes` kirishni tekshiradi va yaroqsizida
 * xato tashlaydi — bu YARATISH uchun to'g'ri. Lekin AUTENTIFIKATSIYA
 * yo'lida u xavfli: agar kelajakda biror scope ro'yxatdan olib
 * tashlansa, o'sha scope bilan saqlangan eski kalit har so'rovda 500
 * berardi. Bu yerda noma'lum qiymat jimgina tashlab yuboriladi —
 * natijada kalit o'sha ruxsatni YO'QOTADI (403), lekin server
 * yiqilmaydi.
 */
export function knownApplicationApiKeyScopes(input: unknown): ApplicationApiKeyScope[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set<string>(APPLICATION_API_KEY_SCOPES);
  return [...new Set(input.filter((scope): scope is ApplicationApiKeyScope =>
    typeof scope === 'string' && allowed.has(scope)))];
}

/**
 * `last_used_at` ni qanchalik tez-tez yangilash kerak.
 *
 * Har so'rovda `UPDATE` yozish Render bepul tarifidagi bazaga keraksiz
 * yuk beradi va javobga kechikish qo'shadi. Bu maydon audit uchun —
 * daqiqagacha aniqlik yetarli.
 */
export const LAST_USED_THROTTLE_MINUTES = 5;
