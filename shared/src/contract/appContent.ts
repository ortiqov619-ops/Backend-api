import type { IsoDateTime, Uuid } from './common';

/**
 * «Ilova haqida / Biz haqimizda» — admin boshqaradigan matn va havolalar.
 *
 * Bu contract ataylab kichik: ilova sahifasi bitta sarlavha, bitta matn
 * va tartiblangan havolalar ro‘yxatidan iborat. Havolaning turi ilovada
 * qaysi ikonka chizilishini va bosilganda nima ochilishini belgilaydi,
 * shuning uchun ro‘yxat cheklangan.
 */

export type AppContentLinkKind =
  | 'telegram_channel'
  | 'telegram_group'
  | 'phone'
  | 'website'
  | 'instagram'
  | 'link';

export const APP_CONTENT_LINK_KINDS: readonly AppContentLinkKind[] = [
  'telegram_channel',
  'telegram_group',
  'phone',
  'website',
  'instagram',
  'link',
] as const;

export const APP_CONTENT_LINK_LABELS: Record<AppContentLinkKind, string> = {
  telegram_channel: 'Telegram kanal',
  telegram_group: 'Telegram guruh',
  phone: 'Telefon raqam',
  website: 'Veb-sayt',
  instagram: 'Instagram',
  link: 'Havola',
};

export interface AppContentLink {
  id: Uuid;
  kind: AppContentLinkKind;
  /** Ekranda ko‘rinadigan nom, masalan «Bizning telegram kanal». */
  label: string;
  /** Admin kiritgan xom qiymat: `@kanal`, `+998901234567`, `https://…`. */
  value: string;
  /** Ochish uchun tayyor manzil. Serverda `value` dan hisoblanadi. */
  url: string;
  sortOrder: number;
  isActive: boolean;
}

export interface AppContent {
  title: string;
  body: string;
  links: AppContentLink[];
  updatedAt: IsoDateTime | null;
}

/** GET /app/content (ochiq) va GET /admin/app-content */
export interface AppContentResponse {
  content: AppContent;
}

export interface UpsertAppContentLink {
  /** Mavjud havolani yangilash uchun. Bo‘sh bo‘lsa yangi yozuv yaratiladi. */
  id?: Uuid;
  kind: AppContentLinkKind;
  label: string;
  value: string;
  sortOrder?: number;
  isActive?: boolean;
}

/**
 * PUT /admin/app-content
 *
 * `links` berilsa ro‘yxat to‘liq almashtiriladi — ro‘yxatda bo‘lmagan
 * havola o‘chiriladi. Bu ataylab: adminda «hato ma’lumotni o‘chirish»
 * huquqi bo‘lishi kerak va alohida DELETE endpoint qo‘shmaslik ekranni
 * soddaroq qiladi.
 */
export interface UpdateAppContentRequest {
  title?: string;
  body?: string;
  links?: UpsertAppContentLink[];
  /** Audit uchun majburiy. */
  changeReason: string;
}

export interface UpdateAppContentResponse {
  content: AppContent;
  auditLogId: Uuid;
}

const TELEGRAM_HANDLE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
const PHONE_CHARACTERS = /^[+(0-9][0-9\s()-]{4,24}$/;

/**
 * Admin kiritgan xom qiymatni ochiladigan manzilga aylantiradi.
 *
 * Faqat `https`, `tel` va `t.me` sxemalari qaytadi: ilova bu manzilni
 * `Linking.openURL` ga beradi va `javascript:` yoki `intent:` kabi
 * sxemalar u yerga hech qachon yetib bormasligi kerak.
 *
 * Qiymat yaroqsiz bo‘lsa `null` qaytadi — chaqiruvchi buni «havola
 * saqlanmaydi» deb qabul qiladi.
 */
export function appContentLinkUrl(kind: AppContentLinkKind, rawValue: string): string | null {
  const value = rawValue.trim();
  if (!value) return null;

  if (kind === 'phone') {
    if (!PHONE_CHARACTERS.test(value)) return null;
    const digits = value.replace(/[^\d+]/g, '');
    return digits.length >= 5 ? `tel:${digits}` : null;
  }

  if (kind === 'telegram_channel' || kind === 'telegram_group') {
    const handle = value
      .replace(/^(https?:\/\/)?(www\.)?(t\.me|telegram\.me)\//i, '')
      .replace(/^@/, '')
      .replace(/\/+$/, '');
    if (TELEGRAM_HANDLE.test(handle)) return `https://t.me/${handle}`;
    // Yopiq guruh havolasi `+` yoki `joinchat/` bilan keladi va u
    // foydalanuvchi nomi qoidalariga bo‘ysunmaydi.
    if (/^(\+[A-Za-z0-9_-]{5,64}|joinchat\/[A-Za-z0-9_-]{5,64})$/.test(handle)) return `https://t.me/${handle}`;
    return null;
  }

  if (kind === 'instagram') {
    const handle = value
      .replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, '')
      .replace(/^@/, '')
      .replace(/\/+$/, '');
    if (/^[A-Za-z0-9._]{1,30}$/.test(handle)) return `https://instagram.com/${handle}`;
    return null;
  }

  // Sxema qo‘lda tekshiriladi: React Native'ning `URL` polifili to‘liq
  // emas (`protocol`/`hostname` yo‘q), shuning uchun bu yerda global
  // `URL` ga tayanib bo‘lmaydi — u faqat serverda ishlardi.
  const scheme = value.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') return null;
  const withoutScheme = value.replace(/^https?:\/\//i, '');
  if (!withoutScheme || /[\s<>"'`\\]/.test(withoutScheme)) return null;
  const host = withoutScheme.split(/[/?#]/, 1)[0] ?? '';
  // Domen nuqta bilan ajratilgan bo‘lishi shart: `localhost` va yalang‘och
  // IP ilova foydalanuvchisi uchun havola emas.
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(:\d{2,5})?$/i.test(host)) return null;
  return `https://${withoutScheme.replace(/\/+$/, '')}`;
}

/**
 * Server javob bermaganda ishlatiladigan lokal nusxa.
 *
 * Ilova hech qachon bo‘sh «Biz haqimizda» sahifasini ko‘rsatmasligi
 * kerak: internet yo‘q bo‘lganda ham matn joyida qoladi.
 */
export const FALLBACK_APP_CONTENT: AppContent = {
  title: 'Til — meros.',
  body: 'Xorazm Shevalari Xorazmning tirik lug‘atini saqlash, o‘rganish va avlodlarga yetkazish uchun yaratilgan.',
  links: [],
  updatedAt: null,
};
