/**
 * Umumiy API primitivlari. Bu paket faqat TypeScript turlari va sof
 * funksiyalardan iborat — RN, Node yoki brauzerga bog'liq kod yo'q.
 */

/** ISO-8601 UTC sana, masalan `2026-08-10T09:12:33.000Z`. */
export type IsoDateTime = string;

/** UUID v4 primary key. */
export type Uuid = string;

export type ApiErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'location_required'
  | 'location_outside_geofence'
  | 'location_low_accuracy'
  | 'location_stale'
  | 'rate_limited'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'provider_unavailable'
  | 'internal_error';

/** Barcha 4xx/5xx javoblar shu shaklda qaytadi. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    /** Foydalanuvchiga ko'rsatish mumkin bo'lgan o'zbekcha xabar. */
    message: string;
    /** Maydon nomi -> xatolik kodlari. */
    fields?: Record<string, string[]>;
    /** Kuzatuv uchun; loglarda ham shu id bo'ladi. */
    requestId: string;
  };
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

export type SortDirection = 'asc' | 'desc';

/** Har qanday yozuvni kim/qachon yaratgani. */
export interface Auditable {
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  createdBy?: Uuid | null;
  updatedBy?: Uuid | null;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
