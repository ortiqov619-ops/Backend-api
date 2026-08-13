import type { IsoDateTime, PageQuery, Paginated, Uuid } from './common';
import type { AdminRole } from './auth';
import type { ModerationStatus } from './contributions';

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export interface DashboardCounters {
  pendingRequests: number;
  approvedToday: number;
  rejectedToday: number;
  needsClarification: number;
  audioQueue: number;
  audioPendingAnalysis: number;
  flaggedLocation: number;
  totalWords: number;
  totalAudio: number;
}

export interface RegionStat {
  regionId: Uuid;
  regionName: string;
  wordCount: number;
  audioCount: number;
  pendingCount: number;
  /** Shu hududdan kelgan so'rovlarning o'rtacha sheva skori. */
  avgDialectScore: number;
}

export interface QueueItemPreview {
  id: Uuid;
  title: string;
  subtitle: string;
  status: ModerationStatus;
  score: number;
  hasAudio: boolean;
  flagged: boolean;
  createdAt: IsoDateTime;
}

/** GET /admin/dashboard */
export interface DashboardResponse {
  counters: DashboardCounters;
  regionStats: RegionStat[];
  recentQueue: QueueItemPreview[];
  /** Oxirgi 14 kunlik kunlik hajm — sparkline uchun. */
  trend: { date: string; submitted: number; approved: number; rejected: number }[];
  generatedAt: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Audit log                                                           */
/* ------------------------------------------------------------------ */

export type AuditAction =
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'word.create'
  | 'word.update'
  | 'word.archive'
  | 'word.delete'
  | 'request.status_change'
  | 'audio.decision'
  | 'region.update'
  | 'geofence.update'
  | 'dialect.update'
  | 'integration.update'
  | 'integration.rotate'
  | 'user.role_change';

export type AuditEntityType =
  | 'user'
  | 'word'
  | 'contribution_request'
  | 'audio_submission'
  | 'region'
  | 'geofence'
  | 'dialect'
  | 'integration_secret';

export interface AuditLogEntry {
  id: Uuid;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: Uuid | null;
  actorId?: Uuid | null;
  actorName: string;
  actorRoles: AdminRole[];
  /** Maskalangan IP (oxirgi oktet olib tashlangan). */
  ipAddress?: string | null;
  userAgent?: string | null;
  /** O'zgarishdan oldingi qiymat; maxfiy maydonlar `"***"` bilan almashtiriladi. */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Faqat o'zgargan maydon nomlari — tez ko'rish uchun. */
  changedFields: string[];
  reason?: string | null;
  createdAt: IsoDateTime;
}

/** GET /admin/audit-logs */
export interface AuditLogQuery extends PageQuery {
  action?: AuditAction;
  entityType?: AuditEntityType;
  entityId?: Uuid;
  actorId?: Uuid;
  from?: IsoDateTime;
  to?: IsoDateTime;
  search?: string;
}

export type AuditLogResponse = Paginated<AuditLogEntry>;

/* ------------------------------------------------------------------ */
/* Integratsiyalar (maxfiy kalitlar)                                   */
/* ------------------------------------------------------------------ */

export type IntegrationProvider =
  | 'stt_primary'
  | 'stt_fallback'
  | 'dialect_model'
  | 'pronunciation_model'
  | 'moderation_ai'
  | 'object_storage'
  | 'push_notifications';

export type IntegrationHealth = 'unknown' | 'ok' | 'degraded' | 'failing' | 'not_configured';

/**
 * MUHIM: bu obyekt hech qachon kalit qiymatini o'z ichiga olmaydi.
 * Server faqat metama'lumot qaytaradi; qiymat DB'da shifrlangan holda yotadi.
 */
export interface IntegrationSecretView {
  provider: IntegrationProvider;
  /** Inson o'qiy oladigan nom, masalan "Asosiy STT". */
  displayName: string;
  isConfigured: boolean;
  /** Faqat oxirgi 4 belgi, masalan `••••7f2a`. To'liq qiymat qaytmaydi. */
  maskedHint?: string | null;
  /** Shifrlash kaliti versiyasi (envelope encryption). */
  keyVersion?: number | null;
  lastRotatedAt?: IsoDateTime | null;
  lastRotatedBy?: string | null;
  lastUsedAt?: IsoDateTime | null;
  health: IntegrationHealth;
  healthCheckedAt?: IsoDateTime | null;
  /** Kalitdan tashqari, ochiq sozlamalar (model nomi, region, endpoint). */
  publicConfig: Record<string, string>;
  isEnabled: boolean;
  /**
   * Serverda bu provider uchun haqiqiy mijoz ulanganmi.
   * `false` bo'lsa kalit saqlanadi, lekin hech qayerda ishlatilmaydi —
   * panel buni ochiq ko'rsatishi kerak, aks holda egasi ishlamaydigan
   * katakka haqiqiy kalit yozib qo'yadi.
   */
  isSupported?: boolean;
  /** `POST /admin/integrations/:provider/health-check` natijasi bo'yicha izoh. */
  healthMessage?: string | null;
}

/** GET /admin/integrations */
export interface IntegrationListResponse {
  items: IntegrationSecretView[];
  /** Serverdagi shifrlash rejimi — panelda ko'rsatiladi. */
  encryption: { algorithm: string; keySource: 'kms' | 'env_master_key'; currentKeyVersion: number };
}

/**
 * PUT /admin/integrations/:provider
 * `secretValue` faqat YOZISH uchun. Javobda hech qachon qaytmaydi.
 */
export interface UpdateIntegrationRequest {
  secretValue?: string;
  publicConfig?: Record<string, string>;
  isEnabled?: boolean;
  /** Nima uchun almashtirilmoqda — audit uchun majburiy. */
  changeReason: string;
}

export interface UpdateIntegrationResponse {
  integration: IntegrationSecretView;
  auditLogId: Uuid;
}

/**
 * POST /admin/integrations/:provider/health-check
 *
 * Saqlangan kalit bilan provider'ga eng arzon so'rov yuboradi. Kalit qiymati
 * javobda ham, auditda ham qaytmaydi — faqat holat va qisqa izoh.
 */
export interface IntegrationHealthCheckResponse {
  integration: IntegrationSecretView;
  health: IntegrationHealth;
  message: string;
  checkedAt: IsoDateTime;
}
