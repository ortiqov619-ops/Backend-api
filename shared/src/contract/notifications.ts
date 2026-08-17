import type { IsoDateTime, PageQuery, Paginated, Uuid } from './common';
import type { PublicProfile } from './profile';

/**
 * Bildirishnoma turlari.
 *
 * Ro'yxat `notification_type` PostgreSQL enumi bilan bir xil bo'lishi shart:
 * server enumga yozadi, ilova esa har bir turga ikonka va yo'nalish bog'laydi.
 * Yangi tur qo'shilganda ikkala joy ham yangilanadi.
 */
export type NotificationType =
  // --- moderatorga ---
  | 'WORD_SUBMITTED'
  | 'WORD_RESUBMITTED'
  | 'AUDIO_SUBMITTED'
  // --- hissa qo'shuvchiga ---
  | 'WORD_APPROVED'
  | 'WORD_REVISION_REQUESTED'
  | 'WORD_REJECTED'
  | 'AUDIO_APPROVED'
  | 'AUDIO_REVISION_REQUESTED'
  | 'AUDIO_REJECTED'
  // --- jamoa ---
  | 'COMMENT_CREATED'
  | 'COMMENT_REPLY'
  | 'LIKE_RECEIVED'
  // --- hisob ---
  | 'ACCOUNT_BLOCKED'
  | 'ACCOUNT_UNBLOCKED'
  | 'SYSTEM';

export type NotificationEntityType =
  | 'word'
  | 'contribution_request'
  | 'audio_submission'
  | 'word_comment'
  | 'user'
  | 'none';

export interface Notification {
  id: Uuid;
  type: NotificationType;
  title: string;
  body: string;
  /** Bosilganda qaysi yozuv ochilishi. `none` — ochiladigan yozuv yo'q. */
  entityType: NotificationEntityType;
  entityId?: string | null;
  /** Deep-link uchun qo'shimcha kontekst (so'z matni, taklif holati...). */
  data: Record<string, unknown>;
  /** Amalni bajargan odam. Tizim yozuvlarida bo'sh. */
  actor?: PublicProfile | null;
  isRead: boolean;
  readAt?: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface NotificationListQuery extends PageQuery {
  /** `true` — faqat o'qilmaganlar. */
  unreadOnly?: boolean;
}

export interface NotificationListResponse extends Paginated<Notification> {
  unreadCount: number;
}

export interface NotificationReadResponse {
  notification: Notification;
  unreadCount: number;
}

export interface NotificationReadAllResponse {
  updated: number;
  unreadCount: number;
}

/** Ekran chizishdan oldin faqat sonini olish uchun — arzon so'rov. */
export interface UnreadCountResponse {
  unreadCount: number;
}
