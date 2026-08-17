import type { IsoDateTime, PageQuery, Paginated, Uuid } from './common';
import type { PublicProfile } from './profile';
import type { Word } from './words';

/**
 * Jamoa amallari — yoqtirish, izoh, saqlash.
 *
 * Uchalasi ham hisobga bog'langan: qurilmaga bog'langan eski model bir
 * odamning ikkita telefonini ikki kishi deb sanardi va ilova qayta
 * o'rnatilganda hamma narsa yo'qolardi. Shuning uchun bu endpointlar
 * ilova foydalanuvchisi tokeni talab qiladi; o'qish esa ochiq, chunki
 * izohlar hisobsiz ham ko'rinishi kerak.
 */

export interface WordComment {
  id: Uuid;
  wordId: Uuid;
  body: string;
  author: PublicProfile | null;
  /** Bo'sh bo'lsa — asosiy izoh, aks holda shu izohga javob. */
  parentCommentId?: Uuid | null;
  /** Faqat bir daraja: javobga javob yozilmaydi. */
  replies: WordComment[];
  /** Joriy foydalanuvchi bu izohni o'chira oladimi. */
  canDelete: boolean;
  createdAt: IsoDateTime;
}

/** So'z ekrani bir so'rovda oladigan to'liq jamoa holati. */
export interface WordCommunityState {
  wordId: Uuid;
  likesCount: number;
  /** Kirmagan foydalanuvchida doim `false`. */
  likedByMe: boolean;
  savedByMe: boolean;
  commentsCount: number;
  comments: WordComment[];
}

/** POST /words/:id/comments */
export interface CreateWordCommentRequest {
  body: string;
  parentCommentId?: Uuid | null;
}

export interface CreateWordCommentResponse {
  comment: WordComment;
  commentsCount: number;
}

export interface DeleteWordCommentResponse {
  id: Uuid;
  commentsCount: number;
}

/** POST/DELETE /words/:id/like */
export interface WordLikeResponse {
  wordId: Uuid;
  liked: boolean;
  likesCount: number;
}

/** POST/DELETE /words/:id/save */
export interface WordSaveResponse {
  wordId: Uuid;
  saved: boolean;
}

export interface SavedWordsQuery extends PageQuery {}

/** GET /app/saved-words — saqlangan so'zning to'liq yozuvi qaytadi. */
export type SavedWordsResponse = Paginated<Word>;

export interface CommentListQuery extends PageQuery {}
export type CommentListResponse = Paginated<WordComment>;
