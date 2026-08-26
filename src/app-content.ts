import { APP_CONTENT_LINK_KINDS, appContentLinkUrl, type AppContentLinkKind } from '@xorazm/shared';

/**
 * «Ilova haqida / Biz haqimizda» kirish ma'lumotini tekshirish.
 *
 * Bu yerda sof funksiyalar turadi: ular bazaga tegmaydi, shuning uchun
 * test qilinadi va route faqat natijani yozadi. Havola manzili har doim
 * SERVERDA hisoblanadi — mijoz yuborgan `url` qabul qilinmaydi, aks
 * holda admin ilovasidagi xato yoki buzilgan mijoz ilovaga ixtiyoriy
 * sxemani (`javascript:`, `intent:`) jo'nata olardi.
 */

export class AppContentValidationError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = 'AppContentValidationError';
  }
}

export interface NormalizedContentLink {
  id: string | null;
  kind: AppContentLinkKind;
  label: string;
  value: string;
  url: string;
  sortOrder: number;
  isActive: boolean;
}

export interface NormalizedAppContent {
  title?: string;
  body?: string;
  links?: NormalizedContentLink[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LINKS = 24;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/g, ' ').trim() : '';
}

export function parseAppContentUpdate(input: unknown): NormalizedAppContent {
  const body = asRecord(input);
  if (!body) throw new AppContentValidationError('Ma’lumot noto‘g‘ri yuborildi.', 'body');

  const result: NormalizedAppContent = {};

  if (body.title !== undefined) {
    const title = text(body.title);
    if (title.length < 1 || title.length > 160) {
      throw new AppContentValidationError('Sarlavha 1–160 ta belgidan iborat bo‘lishi kerak.', 'title');
    }
    result.title = title;
  }

  if (body.body !== undefined) {
    // Matnda abzas bo'lishi mumkin, shuning uchun bu yerda `\n` saqlanadi.
    const value = typeof body.body === 'string' ? body.body.normalize('NFKC').trim() : '';
    if (value.length > 4_000) {
      throw new AppContentValidationError('Matn 4000 ta belgidan oshmasligi kerak.', 'body');
    }
    result.body = value;
  }

  if (body.links !== undefined) {
    if (!Array.isArray(body.links)) {
      throw new AppContentValidationError('Havolalar ro‘yxati noto‘g‘ri.', 'links');
    }
    if (body.links.length > MAX_LINKS) {
      throw new AppContentValidationError(`Havolalar soni ${MAX_LINKS} tadan oshmasligi kerak.`, 'links');
    }
    result.links = body.links.map((entry, index) => parseLink(entry, index));
  }

  return result;
}

function parseLink(input: unknown, index: number): NormalizedContentLink {
  const field = `links.${index}`;
  const entry = asRecord(input);
  if (!entry) throw new AppContentValidationError('Havola ma’lumoti noto‘g‘ri.', field);

  const kind = text(entry.kind) as AppContentLinkKind;
  if (!APP_CONTENT_LINK_KINDS.includes(kind)) {
    throw new AppContentValidationError('Havola turi noto‘g‘ri.', `${field}.kind`);
  }

  const label = text(entry.label);
  if (label.length < 1 || label.length > 80) {
    throw new AppContentValidationError('Havola nomi 1–80 ta belgidan iborat bo‘lishi kerak.', `${field}.label`);
  }

  const value = text(entry.value);
  if (value.length < 1 || value.length > 300) {
    throw new AppContentValidationError('Havola qiymati 1–300 ta belgidan iborat bo‘lishi kerak.', `${field}.value`);
  }

  const url = appContentLinkUrl(kind, value);
  if (!url) {
    throw new AppContentValidationError('Havola manzili tushunarsiz. Masalan: @kanal, +998901234567 yoki https://sayt.uz', `${field}.value`);
  }

  const id = text(entry.id);
  if (id && !UUID_PATTERN.test(id)) {
    throw new AppContentValidationError('Havola identifikatori noto‘g‘ri.', `${field}.id`);
  }

  const rawOrder = Number(entry.sortOrder ?? index);
  const sortOrder = Number.isFinite(rawOrder) ? Math.max(0, Math.min(9_999, Math.trunc(rawOrder))) : index;

  return {
    id: id || null,
    kind,
    label,
    value,
    url,
    sortOrder,
    isActive: entry.isActive === undefined ? true : entry.isActive === true || entry.isActive === 'true',
  };
}
