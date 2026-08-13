import type {
  AuditLogQuery,
  AuditLogResponse,
  DashboardResponse,
  IntegrationListResponse,
  IntegrationProvider,
  UpdateIntegrationRequest,
  UpdateIntegrationResponse,
} from '../contract/admin';
import type { AdminLoginRequest, AdminLoginResponse, RefreshRequest, RefreshResponse } from '../contract/auth';
import type { Uuid } from '../contract/common';
import type {
  CreateAudioContributionMeta,
  CreateAudioContributionResponse,
  CreateWordContributionRequest,
  CreateWordContributionResponse,
  RequestListQuery,
  RequestListResponse,
  UpdateRequestStatusRequest,
  UpdateRequestStatusResponse,
} from '../contract/contributions';
import type { CreateRegionRequest, RegionListQuery, RegionListResponse, RegionMutationResponse, UpdateGeofenceRequest, UpdateGeofenceResponse, UpdateRegionRequest } from '../contract/geo';
import type {
  ArchiveWordRequest,
  ArchiveWordResponse,
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

  /* ---------------------------- moderation --------------------------- */

  listRequests(query?: RequestListQuery): Promise<RequestListResponse> {
    return this.http.request('GET', '/requests', { query: toQuery(query) });
  }

  updateRequestStatus(id: Uuid, body: UpdateRequestStatusRequest): Promise<UpdateRequestStatusResponse> {
    return this.http.request('PATCH', `/requests/${id}/status`, { body });
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
}
