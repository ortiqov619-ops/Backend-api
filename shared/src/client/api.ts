import type {
  AuditLogQuery,
  AuditLogResponse,
  DashboardResponse,
  IntegrationHealthCheckResponse,
  IntegrationListResponse,
  IntegrationProvider,
  UpdateIntegrationRequest,
  UpdateIntegrationResponse,
} from '../contract/admin';
import type {
  AudioModerationDecisionRequest,
  AudioModerationDecisionResponse,
  AudioModerationListResponse,
  AudioModerationQuery,
} from '../contract/audio';
import type { AdminLoginRequest, AdminLoginResponse, RefreshRequest, RefreshResponse } from '../contract/auth';
import type { Uuid } from '../contract/common';
import type {
  CommentListQuery,
  CommentListResponse,
  CreateWordCommentRequest,
  CreateWordCommentResponse,
  DeleteWordCommentResponse,
  SavedWordsQuery,
  SavedWordsResponse,
  WordCommunityState,
  WordLikeResponse,
  WordSaveResponse,
} from '../contract/community';
import type {
  NotificationListQuery,
  NotificationListResponse,
  NotificationReadAllResponse,
  NotificationReadResponse,
  UnreadCountResponse,
} from '../contract/notifications';
import type {
  CreateAudioContributionMeta,
  CreateAudioContributionResponse,
  CreateWordContributionRequest,
  CreateWordContributionResponse,
  MyContributionListQuery,
  MyContributionListResponse,
  RequestListQuery,
  RequestListResponse,
  UpdateRequestStatusRequest,
  UpdateRequestStatusResponse,
} from '../contract/contributions';
import type { CreateRegionRequest, RegionListQuery, RegionListResponse, RegionMutationResponse, UpdateGeofenceRequest, UpdateGeofenceResponse, UpdateRegionRequest } from '../contract/geo';
import type {
  ArchiveWordRequest,
  ArchiveWordResponse,
  CreateAdminWordRequest,
  CreateAdminWordResponse,
  UpdateWordRequest,
  UpdateWordResponse,
  Word,
  WordListQuery,
  WordListResponse,
} from '../contract/words';
import { HttpClient, type HttpClientOptions } from './http';

/** Audio yuborish uchun platformaga bog'liq bo'lmagan fayl tavsifi. */
export interface AudioFilePart {
  uri: string;
  name: string;
  type: string;
}

function toQuery(input: object | undefined): Record<string, string | number | boolean | undefined> {
  if (!input) return {};
  return Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== null),
  ) as Record<string, string | number | boolean | undefined>;
}

/**
 * V3 API mijozi. Bitta manba — admin ham, foydalanuvchi ilovasi ham
 * shu klassdan foydalanadi; farq faqat ishlatiladigan metodlarda.
 */
export class XorazmApiClient {
  readonly http: HttpClient;

  constructor(options: HttpClientOptions) {
    this.http = new HttpClient(options);
  }

  /* ------------------------------ auth ------------------------------ */

  login(body: AdminLoginRequest): Promise<AdminLoginResponse> {
    return this.http.request('POST', '/auth/admin/login', { body, auth: false });
  }

  refresh(body: RefreshRequest): Promise<RefreshResponse> {
    return this.http.request('POST', '/auth/admin/refresh', { body, auth: false });
  }

  logout(): Promise<void> {
    return this.http.request('POST', '/auth/admin/logout', {});
  }

  /* ---------------------------- dictionary --------------------------- */

  listWords(query?: WordListQuery): Promise<WordListResponse> {
    return this.http.request('GET', '/words', { query: toQuery(query), auth: false });
  }

  getWord(id: Uuid): Promise<Word> {
    return this.http.request('GET', `/words/${id}`, { auth: false });
  }

  createAdminWord(body: CreateAdminWordRequest): Promise<CreateAdminWordResponse> {
    return this.http.request('POST', '/admin/words', { body });
  }

  updateWord(id: Uuid, body: UpdateWordRequest): Promise<UpdateWordResponse> {
    return this.http.request('PATCH', `/words/${id}`, { body });
  }

  archiveWord(id: Uuid, body: ArchiveWordRequest): Promise<ArchiveWordResponse> {
    return this.http.request('DELETE', `/words/${id}`, { body });
  }

  /* --------------------------- contributions ------------------------- */

  createWordContribution(body: CreateWordContributionRequest): Promise<CreateWordContributionResponse> {
    return this.http.request('POST', '/contributions/words', { body, idempotencyKey: body.idempotencyKey });
  }

  createAudioContribution(
    file: AudioFilePart,
    meta: CreateAudioContributionMeta,
  ): Promise<CreateAudioContributionResponse> {
    const form = new FormData();
    // Parser metama’lumotni audio oqimidan avval tekshira olishi uchun.
    form.append('meta', JSON.stringify(meta));
    // React Native `FormData` fayl uchun `{ uri, name, type }` obyektini kutadi.
    form.append('audio', file as unknown as Blob);
    return this.http.request('POST', '/contributions/audio', {
      formData: form,
      idempotencyKey: meta.idempotencyKey,
    });
  }

  /** Foydalanuvchining o'z takliflari va ular bo'yicha moderator qarori. */
  myContributions(query?: MyContributionListQuery): Promise<MyContributionListResponse> {
    return this.http.request('GET', '/app/contributions', { query: toQuery(query) });
  }

  /* ----------------------------- community --------------------------- */
  // O'qish ochiq (`auth: false`), yozish hisob talab qiladi. Shu sabab
  // yoqtirish/izoh metodlari tokenni yuboradi va token yo'q bo'lsa server
  // `401` qaytaradi — ilova buni "avval hisobga kiring" deb ko'rsatadi.

  wordCommunity(wordId: Uuid): Promise<WordCommunityState> {
    return this.http.request('GET', `/words/${wordId}/community`, {});
  }

  listWordComments(wordId: Uuid, query?: CommentListQuery): Promise<CommentListResponse> {
    return this.http.request('GET', `/words/${wordId}/comments`, { query: toQuery(query), auth: false });
  }

  createWordComment(wordId: Uuid, body: CreateWordCommentRequest): Promise<CreateWordCommentResponse> {
    return this.http.request('POST', `/words/${wordId}/comments`, { body });
  }

  deleteWordComment(commentId: Uuid): Promise<DeleteWordCommentResponse> {
    return this.http.request('DELETE', `/comments/${commentId}`, {});
  }

  likeWord(wordId: Uuid): Promise<WordLikeResponse> {
    return this.http.request('POST', `/words/${wordId}/like`, {});
  }

  unlikeWord(wordId: Uuid): Promise<WordLikeResponse> {
    return this.http.request('DELETE', `/words/${wordId}/like`, {});
  }

  saveWord(wordId: Uuid): Promise<WordSaveResponse> {
    return this.http.request('POST', `/words/${wordId}/save`, {});
  }

  unsaveWord(wordId: Uuid): Promise<WordSaveResponse> {
    return this.http.request('DELETE', `/words/${wordId}/save`, {});
  }

  savedWords(query?: SavedWordsQuery): Promise<SavedWordsResponse> {
    return this.http.request('GET', '/app/saved-words', { query: toQuery(query) });
  }

  /* --------------------------- notifications ------------------------- */
  // Ilova va admin inbox'i bir xil shaklda, lekin alohida yo'llarda:
  // tokenlar ham har xil (`xorazm-app` auditoriyasi va admin tokeni),
  // shuning uchun bitta yo'lda ikkalasini qabul qilish xavfli bo'lardi.

  appNotifications(query?: NotificationListQuery): Promise<NotificationListResponse> {
    return this.http.request('GET', '/app/notifications', { query: toQuery(query) });
  }

  appUnreadCount(): Promise<UnreadCountResponse> {
    return this.http.request('GET', '/app/notifications/unread-count', {});
  }

  readAppNotification(id: Uuid): Promise<NotificationReadResponse> {
    return this.http.request('POST', `/app/notifications/${id}/read`, {});
  }

  readAllAppNotifications(): Promise<NotificationReadAllResponse> {
    return this.http.request('POST', '/app/notifications/read-all', {});
  }

  adminNotifications(query?: NotificationListQuery): Promise<NotificationListResponse> {
    return this.http.request('GET', '/admin/notifications', { query: toQuery(query) });
  }

  adminUnreadCount(): Promise<UnreadCountResponse> {
    return this.http.request('GET', '/admin/notifications/unread-count', {});
  }

  readAdminNotification(id: Uuid): Promise<NotificationReadResponse> {
    return this.http.request('POST', `/admin/notifications/${id}/read`, {});
  }

  readAllAdminNotifications(): Promise<NotificationReadAllResponse> {
    return this.http.request('POST', '/admin/notifications/read-all', {});
  }

  /* ---------------------------- moderation --------------------------- */

  listRequests(query?: RequestListQuery): Promise<RequestListResponse> {
    return this.http.request('GET', '/requests', { query: toQuery(query) });
  }

  updateRequestStatus(id: Uuid, body: UpdateRequestStatusRequest): Promise<UpdateRequestStatusResponse> {
    return this.http.request('PATCH', `/requests/${id}/status`, { body });
  }

  /* ------------------------- audio moderation ------------------------ */

  listAudioModeration(query?: AudioModerationQuery): Promise<AudioModerationListResponse> {
    return this.http.request('GET', '/audio/moderation', { query: toQuery(query) });
  }

  /** Faqat audio yozuvini o'zgartiradi: so'rov statusi va lug'at tegilmaydi. */
  decideAudio(id: Uuid, body: AudioModerationDecisionRequest): Promise<AudioModerationDecisionResponse> {
    return this.http.request('PATCH', `/audio/${id}/moderation`, { body });
  }

  /* ------------------------------ admin ------------------------------ */

  dashboard(): Promise<DashboardResponse> {
    return this.http.request('GET', '/admin/dashboard', {});
  }

  listRegions(query?: RegionListQuery): Promise<RegionListResponse> {
    return this.http.request('GET', '/regions', { query: toQuery(query), auth: false });
  }

  createRegion(body: CreateRegionRequest): Promise<RegionMutationResponse> {
    return this.http.request('POST', '/admin/regions', { body });
  }

  updateRegion(id: Uuid, body: UpdateRegionRequest): Promise<RegionMutationResponse> {
    return this.http.request('PATCH', `/admin/regions/${id}`, { body });
  }

  updateGeofence(id: Uuid, body: UpdateGeofenceRequest): Promise<UpdateGeofenceResponse> {
    return this.http.request('PUT', `/admin/geofences/${id}`, { body });
  }

  auditLogs(query?: AuditLogQuery): Promise<AuditLogResponse> {
    return this.http.request('GET', '/admin/audit-logs', { query: toQuery(query) });
  }

  integrations(): Promise<IntegrationListResponse> {
    return this.http.request('GET', '/admin/integrations', {});
  }

  updateIntegration(provider: IntegrationProvider, body: UpdateIntegrationRequest): Promise<UpdateIntegrationResponse> {
    return this.http.request('PUT', `/admin/integrations/${provider}`, { body });
  }

  /** Saqlangan kalitni provider'da sinaydi. Kalit qiymati uzatilmaydi. */
  checkIntegration(provider: IntegrationProvider): Promise<IntegrationHealthCheckResponse> {
    return this.http.request('POST', `/admin/integrations/${provider}/health-check`, {});
  }
}
