import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import bcrypt from 'bcryptjs';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { AUDIO_LIMITS, evaluateLocationGate, phoneticKey, validateContributionText } from '@xorazm/shared';
import { fixedWindow, normalizeExpectedText, sameAudioFingerprint, type AudioIdempotencyFingerprint } from './audio-hardening';
import {
  audioStatusForRequestDecision,
  AudioModerationValidationError,
  isRecordableDecision,
  isSameInstant,
  parseAudioDecision,
} from './audio-moderation';
import { assertProductionConfig, config } from './config';
import { translateDatabaseError } from './db-errors';
import {
  canBeChildOf,
  canCreateRegionUnder,
  isDirectVillageChild,
  uniqueDialectIdByLabel,
  normalizeRegionName,
  parseRegionSuggestion,
  resolveRegionForPublication,
  RegionSuggestionValidationError,
} from './region-suggestion';
import {
  decryptSecret,
  encryptSecret,
  hashToken,
  newId,
  signAccessToken,
  signAudioPlaybackToken,
  verifyAccessToken,
  verifyAudioPlaybackToken,
} from './security';
import { INSERT_VALIDATION_RESULT, jsonb, UPDATE_REQUEST_RESOLUTION } from './sql';

assertProductionConfig();
const db = new Pool({ connectionString: config.databaseUrl, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024, trustProxy: config.trustProxy });

// `tsx` executes this entrypoint as CommonJS in the production Docker image.
// Keep plugin setup in a promise so the file has no top-level `await`.
const pluginsReady = Promise.all([
  app.register(cors, { origin: (origin, callback) => callback(null, !origin || config.corsOrigins.includes(origin)) }),
  app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } }),
]);

type Json = Record<string, unknown>;
type Claims = { sub: string; roles: string[]; permissions: string[] };

class RouteFault extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RouteFault';
  }
}

function iso(value: unknown): string | null { return value ? new Date(String(value)).toISOString() : null; }
function requiredIso(value: unknown): string { return new Date(String(value)).toISOString(); }
function page(input: unknown, fallback = 1): number { const value = Number(input ?? fallback); return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback; }
function pageSize(input: unknown): number { return Math.min(100, Math.max(1, page(input, 20))); }
function apiError(reply: FastifyReply, status: number, code: string, message: string, fields?: Record<string, string[]>) {
  // `requestId` Fastify logidagi `reqId` bilan bir xil bo'lishi shart: aks
  // holda mijoz ko'rgan xatoni server logidan topib bo'lmaydi.
  const requestId = reply.request?.id ?? newId();
  return reply.status(status).send({ error: { code, message, ...(fields ? { fields } : {}), requestId: String(requestId) } });
}

/**
 * Route ichidagi yagona xato chiqishi: `RouteFault` — bilib turib qaytarilgan
 * javob, tanilgan SQLSTATE — xavfsiz tarjima, qolgani — umumiy `500`.
 * Xatoning matni yoki `detail` maydoni mijozga hech qachon ko'chirilmaydi.
 */
function failFromError(reply: FastifyReply, error: unknown, context: string): FastifyReply {
  if (error instanceof RouteFault) return apiError(reply, error.status, error.code, error.message);

  const translated = translateDatabaseError(error);
  if (translated) {
    if (translated.serverDefect) {
      app.log.error({ err: error, context, reqId: reply.request?.id }, 'SQL nuqsoni: so‘rov bajarilmadi');
    } else {
      app.log.warn({ err: error, context, reqId: reply.request?.id }, 'Ma’lumotlar bazasi so‘rovni rad etdi');
    }
    return apiError(reply, translated.status, translated.code, translated.message);
  }

  app.log.error({ err: error, context, reqId: reply.request?.id }, 'Kutilmagan xatolik');
  return apiError(reply, 500, 'internal_error', 'Serverda kutilmagan xatolik yuz berdi.');
}
function asObject(value: unknown): Json { return typeof value === 'object' && value !== null ? value as Json : {}; }
function asString(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function bool(value: unknown): boolean { return value === true || value === 'true'; }
function nullableString(value: unknown): string | null { return asString(value) || null; }
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function multipartFieldValue(field: unknown): string {
  const candidate = Array.isArray(field) ? field[0] : field;
  return typeof candidate === 'object' && candidate !== null && 'value' in candidate
    ? String((candidate as { value: unknown }).value ?? '')
    : '';
}

let rateLimitCleanupCounter = 0;
async function enforceRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  scope: string,
  limit: number,
  windowSeconds: number,
  message = 'Juda ko‘p so‘rov yuborildi. Biroz kutib qayta urinib ko‘ring.',
): Promise<boolean> {
  const { windowStartMs, resetAtMs } = fixedWindow(Date.now(), windowSeconds);
  // IP manzilni ochiq saqlamaymiz. `trustProxy` faqat hosting proxylarida
  // yoqiladi, shuning uchun barcha foydalanuvchi bitta internal IP bo'lib qolmaydi.
  const bucket = `${scope}:${hashToken(request.ip).slice(0, 32)}`;
  const result = await db.query<{ request_count: number }>(
    `INSERT INTO api_rate_limits (bucket, window_start_ms, request_count, expires_at)
     VALUES ($1,$2,1,to_timestamp($3 / 1000.0))
     ON CONFLICT (bucket, window_start_ms)
     DO UPDATE SET request_count = api_rate_limits.request_count + 1
     RETURNING request_count`,
    [bucket, windowStartMs, resetAtMs],
  );
  const count = Number(result.rows[0]?.request_count ?? limit + 1);
  const remaining = Math.max(0, limit - count);
  reply.header('X-RateLimit-Limit', String(limit));
  reply.header('X-RateLimit-Remaining', String(remaining));
  reply.header('X-RateLimit-Reset', String(Math.ceil(resetAtMs / 1_000)));

  rateLimitCleanupCounter += 1;
  if (rateLimitCleanupCounter % 100 === 0) {
    void db.query("DELETE FROM api_rate_limits WHERE expires_at < now() - interval '1 day'")
      .catch((error: unknown) => app.log.warn(error, 'Eski rate-limit yozuvlari tozalanmadi'));
  }

  if (count <= limit) return true;
  reply.header('Retry-After', String(Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1_000))));
  apiError(reply, 429, 'rate_limited', message);
  return false;
}

async function claimsFor(request: FastifyRequest, permission?: string): Promise<Claims | null> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return null;
  try {
    const claims = await verifyAccessToken(authorization.slice(7));
    if (permission && !claims.permissions.includes(permission)) return null;
    return claims;
  } catch { return null; }
}
async function requirePermission(request: FastifyRequest, reply: FastifyReply, permission: string): Promise<Claims | null> {
  const claims = await claimsFor(request, permission);
  if (!claims) {
    apiError(reply, request.headers.authorization ? 403 : 401, request.headers.authorization ? 'forbidden' : 'unauthorized', request.headers.authorization ? 'Bu amal uchun ruxsat yo‘q.' : 'Avval tizimga kiring.');
    return null;
  }
  return claims;
}
async function audit(actor: Claims | null, action: string, entityType: string, entityId: string | null, reason: string | null, after: Json | null, request: FastifyRequest, transaction?: PoolClient) {
  const executor = transaction ?? db;
  const actorName = actor ? (await executor.query<{ full_name: string }>('SELECT full_name FROM users WHERE id = $1', [actor.sub])).rows[0]?.full_name ?? 'Administrator' : 'Tizim';
  const auditLogId = newId();
  await executor.query(
    `INSERT INTO audit_logs (action, entity_type, entity_id, actor_id, actor_name, actor_roles, ip_address, user_agent, after_data, reason, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [action, entityType, entityId, actor?.sub ?? null, actorName, actor?.roles ?? [], request.ip ?? null, request.headers['user-agent'] ?? null, after, reason, auditLogId],
  );
  return auditLogId;
}

function mapRegion(row: QueryResultRow) {
  return { id: row.id, code: row.code, nameUz: row.name_uz, nameOz: row.name_oz, parentId: row.parent_id, level: row.level, isContributionAllowed: row.is_contribution_allowed, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}
function mapFence(row: QueryResultRow) {
  return { id: row.id, regionId: row.region_id, name: row.name, area: row.area_geojson, policy: row.policy, isActive: row.is_active, version: row.version, note: row.note, createdAt: requiredIso(row.created_at), updatedAt: requiredIso(row.updated_at) };
}
function mapDialect(row: QueryResultRow) {
  return { id: row.id, code: row.code, nameUz: row.name_uz, description: row.description, markerWords: row.marker_words ?? [], regionIds: row.region_ids ?? [], isActive: row.is_active, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}
function mapWord(row: QueryResultRow) {
  return { id: row.id, word: row.word, literaryForm: row.literary_form, meaning: row.meaning, example: row.example, category: row.category, phoneticKey: row.phonetic_key, status: row.status, regionId: row.region_id, districtId: row.district_id, villageId: row.village_id, dialectId: row.dialect_id, clan: row.clan, dialectScore: row.dialect_score, sourceRequestId: row.source_request_id, archivedAt: iso(row.archived_at), archiveReason: row.archive_reason, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}
async function activeFences() { const result = await db.query('SELECT * FROM geofences WHERE is_active = true'); return result.rows.map(mapFence); }

async function payloadForPublication(source: Json, overrides: Json, client: PoolClient): Promise<{ payload: Json; regionResolution: Json | null; dialectResolution: Json | null }> {
  const payload = { ...source, ...overrides };
  const sourceProposal = source.proposedRegion;
  const regionId = asString(payload.regionId) || '00000000-0000-4000-8000-000000000001';
  if (!isUuid(regionId)) throw new RouteFault(422, 'validation_failed', 'So‘z hududi noto‘g‘ri.');
  const region = await client.query('SELECT id, level, is_contribution_allowed FROM regions WHERE id=$1', [regionId]);
  if (!region.rows[0] || region.rows[0].level !== 'region' || !region.rows[0].is_contribution_allowed) {
    throw new RouteFault(422, 'validation_failed', 'So‘z uchun tanlangan viloyat hissa qabul qilmaydi.');
  }
  payload.regionId = regionId;

  let proposal: ReturnType<typeof parseRegionSuggestion> = null;
  try {
    proposal = parseRegionSuggestion(sourceProposal, regionId);
  } catch (error) {
    if (error instanceof RegionSuggestionValidationError) throw new RouteFault(422, 'validation_failed', error.message);
    throw error;
  }

  let regionResolution: Json | null = null;
  if (proposal) {
    if (!Object.prototype.hasOwnProperty.call(overrides, 'regionId')) {
      throw new RouteFault(422, 'validation_failed', 'Yangi hudud taklifini tasdiqlashdan oldin rasmiy hududga bog‘lang.');
    }
    const parent = await client.query('SELECT id, name_uz, parent_id, level, is_contribution_allowed FROM regions WHERE id=$1', [proposal.parentRegionId]);
    if (!parent.rows[0] || !parent.rows[0].is_contribution_allowed || !canBeChildOf(proposal.level, String(parent.rows[0].level))) {
      throw new RouteFault(422, 'validation_failed', 'Taklif qilingan hududning yuqori hududi endi yaroqli emas.');
    }
    const belongs = await client.query(`WITH RECURSIVE lineage AS (
      SELECT id, parent_id FROM regions WHERE id=$1
      UNION ALL
      SELECT r.id, r.parent_id FROM regions r JOIN lineage l ON l.parent_id=r.id
    ) SELECT 1 FROM lineage WHERE id=$2 LIMIT 1`, [proposal.parentRegionId, regionId]);
    if (!belongs.rows[0]) throw new RouteFault(422, 'validation_failed', 'Taklif qilingan hudud viloyatga mos emas.');

    // Admin UI faqat ikki xavfsiz qaror yuboradi: Xorazm umumiy yoki
    // mavjud kanonik tuman. Manba proposalini payloadda saqlab qolamiz,
    // ammo Word uchun faqat explicit override ishlatiladi.
    const explicitDistrictId = asString(overrides.districtId) || null;
    const explicitVillageId = asString(overrides.villageId) || null;
    const explicitNeighborhood = asString(overrides.neighborhood) || null;
    if (explicitVillageId) {
      const village = await client.query('SELECT level::text, parent_id FROM regions WHERE id=$1 AND is_contribution_allowed=true', [explicitVillageId]);
      const row = village.rows[0];
      if (!isDirectVillageChild(row ? { level: String(row.level), parentId: nullableString(row.parent_id) } : null, explicitDistrictId)) {
        throw new RouteFault(422, 'validation_failed', 'Moderator tanlagan qishloq aynan tanlangan tumanga tegishli bo‘lishi kerak.');
      }
    }
    const resolved = resolveRegionForPublication(proposal, {
      districtId: explicitDistrictId,
      villageId: explicitVillageId,
      neighborhood: explicitNeighborhood,
    });
    payload.districtId = resolved.districtId ?? undefined;
    payload.villageId = resolved.villageId ?? undefined;
    payload.neighborhood = resolved.neighborhood ?? undefined;
    delete payload.proposedRegion;
    regionResolution = {
      resolution: resolved.resolution,
      proposedNameUz: proposal.nameUz,
      proposedLevel: proposal.level,
      matchedRegionId: resolved.matchedRegionId,
      publishedDistrictId: resolved.districtId,
      publishedVillageId: resolved.villageId,
      publishedNeighborhood: resolved.neighborhood,
    };
  }
  // `words` jadvali faqat canonical ustunlarni oladi. Proposal faqat manba
  // contribution payloadida audit uchun qoladi.
  delete payload.proposedRegion;

  for (const [field, expectedLevel] of [['districtId', 'district'], ['villageId', 'village']] as const) {
    const selectedId = asString(payload[field]);
    if (!selectedId) {
      delete payload[field];
      continue;
    }
    if (!isUuid(selectedId)) throw new RouteFault(422, 'validation_failed', 'So‘zning hudud identifikatori noto‘g‘ri.');
    const canonical = await client.query(`WITH RECURSIVE lineage AS (
      SELECT id, parent_id, level, is_contribution_allowed FROM regions WHERE id=$1
      UNION ALL
      SELECT r.id, r.parent_id, r.level, r.is_contribution_allowed FROM regions r JOIN lineage l ON l.parent_id=r.id
    ) SELECT
      EXISTS(SELECT 1 FROM lineage WHERE id=$2) AS belongs_to_region,
      (SELECT level::text FROM lineage WHERE id=$1) AS selected_level,
      (SELECT is_contribution_allowed FROM lineage WHERE id=$1) AS contribution_allowed`, [selectedId, regionId]);
    const selected = canonical.rows[0];
    if (!selected?.belongs_to_region || selected.selected_level !== expectedLevel || !selected.contribution_allowed) {
      throw new RouteFault(422, 'validation_failed', 'So‘zning rasmiy tuman/qishloq tanlovi yaroqli emas.');
    }
  }
  const publishedDistrictId = asString(payload.districtId) || null;
  const publishedVillageId = asString(payload.villageId) || null;
  if (publishedVillageId) {
    const village = await client.query('SELECT level::text, parent_id FROM regions WHERE id=$1 AND is_contribution_allowed=true', [publishedVillageId]);
    const row = village.rows[0];
    if (!isDirectVillageChild(row ? { level: String(row.level), parentId: nullableString(row.parent_id) } : null, publishedDistrictId)) {
      throw new RouteFault(422, 'validation_failed', 'Tanlangan qishloq aynan tanlangan tumanga tegishli bo‘lishi kerak.');
    }
  }

  let dialectResolution: Json | null = null;
  const requestedDialect = asString(payload.dialectId);
  if (requestedDialect) {
    if (isUuid(requestedDialect)) {
      const canonicalDialect = await client.query('SELECT id FROM dialects WHERE id=$1 AND is_active=true', [requestedDialect]);
      if (!canonicalDialect.rows[0]) {
        delete payload.dialectId;
        dialectResolution = { source: requestedDialect, resolution: 'dropped_inactive_or_unknown', canonicalId: null };
      }
    } else {
      const dialects = await client.query('SELECT id, code, name_uz FROM dialects WHERE is_active=true');
      const canonicalId = uniqueDialectIdByLabel(requestedDialect, dialects.rows.map((row) => ({ id: String(row.id), code: String(row.code), nameUz: String(row.name_uz) })));
      if (canonicalId) payload.dialectId = canonicalId;
      else delete payload.dialectId;
      dialectResolution = { source: requestedDialect, resolution: canonicalId ? 'legacy_label_mapped' : 'dropped_unknown_label', canonicalId };
    }
  } else {
    delete payload.dialectId;
  }

  return { payload, regionResolution, dialectResolution };
}

/** Mobil GPS uchun juda qat'iy boshlang'ich siyosat amalda hissa oqimini
 * to'xtatib qo'yar edi. Bu yerda pastroq aniqlik qabul qilinadi, lekin u
 * avtomatik ravishda moderator tekshiruviga belgilab yuboriladi. */
function practicalMobileGate(sample: Json, geofences: Awaited<ReturnType<typeof activeFences>>) {
  const source = evaluateLocationGate({ sample: sample as never, permission: 'granted', geofences });
  if (source.status !== 'low_accuracy') return source;
  const accuracy = Number(sample.accuracy);
  if (!Number.isFinite(accuracy) || accuracy > 1_500) return source;
  const relaxedFences = geofences.map((fence) => ({ ...fence, policy: { ...fence.policy, maxAccuracyM: 1_500, boundaryReviewBufferM: 2_000 } }));
  return evaluateLocationGate({ sample: sample as never, permission: 'granted', geofences: relaxedFences });
}

async function createPlaybackAccess(row: QueryResultRow): Promise<{ playbackUrl: string; playbackUrlExpiresAt: string }> {
  const audioId = String(row.audio_id ?? row.id);
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  if (row.storage_bucket === 'local') {
    const signed = await signAudioPlaybackToken(audioId);
    return {
      playbackUrl: `${config.publicBaseUrl}/v3/audio/${encodeURIComponent(audioId)}?token=${encodeURIComponent(signed.token)}`,
      playbackUrlExpiresAt: signed.expiresAt,
    };
  }

  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new RouteFault(503, 'provider_unavailable', 'Bulut audio storage sozlanmagan.');
  }
  const encodedKey = String(row.storage_key).split('/').map(encodeURIComponent).join('/');
  const response = await fetch(
    `${config.supabaseUrl}/storage/v1/object/sign/${encodeURIComponent(String(row.storage_bucket))}/${encodedKey}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
        apikey: config.supabaseServiceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 300 }),
    },
  );
  if (!response.ok) throw new RouteFault(503, 'provider_unavailable', 'Bulut audio havolasini yaratib bo‘lmadi.');
  const payload = await response.json() as { signedURL?: string; signedUrl?: string };
  const signedPath = payload.signedURL ?? payload.signedUrl;
  if (!signedPath) throw new RouteFault(503, 'provider_unavailable', 'Bulut audio havolasi qaytmadi.');
  return {
    playbackUrl: signedPath.startsWith('http') ? signedPath : `${config.supabaseUrl}/storage/v1${signedPath}`,
    playbackUrlExpiresAt: expiresAt,
  };
}

async function mapAudioSubmission(row: QueryResultRow) {
  const id = String(row.audio_id ?? row.id);
  const playback = await createPlaybackAccess(row);
  const engineName = row.audio_engine_name ?? row.engine_name;
  const engineVersion = row.audio_engine_version ?? row.engine_version;
  const engineProvider = row.audio_engine_provider ?? row.engine_provider;
  const createdAt = row.audio_created_at ?? row.created_at;
  const updatedAt = row.audio_updated_at ?? row.updated_at;
  return {
    id,
    contributionRequestId: row.audio_contribution_request_id ?? row.contribution_request_id ?? null,
    wordId: row.audio_word_id ?? row.word_id ?? null,
    storageKey: row.storage_key,
    ...playback,
    mimeType: row.mime_type,
    durationMs: Number(row.duration_ms),
    sizeBytes: Number(row.size_bytes),
    sampleRateHz: row.sample_rate_hz ?? null,
    checksumSha256: row.checksum_sha256,
    expectedText: row.expected_text,
    analysis: {
      status: row.analysis_status,
      stage: row.pipeline_stage,
      transcript: row.transcript ?? null,
      transcriptConfidence: row.transcript_confidence ?? null,
      detectedLanguage: row.detected_language ?? null,
      dialectConfidence: row.dialect_confidence ?? null,
      pronunciationSimilarity: row.pronunciation_similarity ?? null,
      textAudioMatch: row.text_audio_match ?? null,
      overallScore: row.overall_score ?? null,
      reasons: row.analysis_reasons ?? [],
      requiresHumanReview: Boolean(row.audio_requires_review ?? row.requires_human_review),
      engine: engineName && engineVersion ? {
        kind: engineProvider ? 'hybrid' : 'rules',
        name: engineName,
        version: engineVersion,
        ...(engineProvider ? { provider: engineProvider } : {}),
      } : null,
      analyzedAt: iso(row.analyzed_at),
      failureMessage: row.audio_failure_message ?? row.failure_message ?? null,
    },
    moderationStatus: row.audio_moderation_status ?? row.moderation_status,
    version: Number(row.audio_version ?? row.version ?? 1),
    supersededAt: iso(row.audio_superseded_at ?? row.superseded_at),
    createdAt: requiredIso(createdAt),
    updatedAt: requiredIso(updatedAt),
  };
}

/**
 * Moderator audioni baholash uchun uning kontekstini ko'rishi kerak: bu yangi
 * taklifmi, mavjud lug'at so'ziga qo'shilgan talaffuzmi, yoki bog'lanishi
 * uzilgan yozuvmi. Uchinchi holat 0007 migratsiyasidan keyin real mavjud.
 */
function audioContext(row: QueryResultRow) {
  if (row.ctx_request_id) {
    const payload = asObject(row.ctx_request_payload);
    return {
      kind: 'contribution_request' as const,
      id: String(row.ctx_request_id),
      word: asString(payload.word) || String(row.expected_text),
      meaning: nullableString(payload.meaning),
      status: row.ctx_request_status ?? null,
    };
  }
  if (row.ctx_word_id) {
    return {
      kind: 'word' as const,
      id: String(row.ctx_word_id),
      word: String(row.ctx_word),
      meaning: nullableString(row.ctx_word_meaning),
      status: row.ctx_word_status ?? null,
    };
  }
  return {
    kind: 'detached' as const,
    id: String(row.id),
    word: String(row.expected_text),
    meaning: null,
    status: null,
  };
}

async function mapRequest(row: QueryResultRow) {
  const audio = row.audio_id ? await mapAudioSubmission(row) : null;
  return { id: row.id, type: row.type, status: row.status, payload: row.payload, submittedByUserId: row.submitted_by_user_id, submittedByDisplayName: row.submitted_by_display_name, device: row.device, latitude: row.latitude, longitude: row.longitude, locationAccuracyM: row.location_accuracy_m, locationCheckedAt: iso(row.location_checked_at), submissionLocationStatus: row.submission_location_status, matchedGeofenceId: row.matched_geofence_id, geofenceVersion: row.geofence_version, validationVerdict: row.validation_verdict, validationScore: row.validation_score, validationResults: row.validation_results ?? [], audio, clarificationNote: row.clarification_note, resolvedAt: iso(row.resolved_at), resolvedByUserId: row.resolved_by_user_id, resultWordId: row.result_word_id, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}
const requestSql = `SELECT cr.*, a.id AS audio_id, a.contribution_request_id AS audio_contribution_request_id, a.word_id AS audio_word_id, a.storage_bucket, a.storage_key, a.mime_type, a.duration_ms, a.size_bytes, a.sample_rate_hz, a.checksum_sha256, a.expected_text, a.analysis_status, a.pipeline_stage, a.transcript, a.transcript_confidence, a.detected_language, a.dialect_confidence, a.pronunciation_similarity, a.text_audio_match, a.overall_score, a.analysis_reasons, a.requires_human_review AS audio_requires_review, a.engine_name AS audio_engine_name, a.engine_version AS audio_engine_version, a.engine_provider AS audio_engine_provider, a.failure_message AS audio_failure_message, a.moderation_status AS audio_moderation_status, a.version AS audio_version, a.superseded_at AS audio_superseded_at, a.analyzed_at, a.created_at AS audio_created_at, a.updated_at AS audio_updated_at,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('subject', vr.subject, 'verdict', vr.verdict, 'score', vr.score, 'confidence', vr.confidence, 'reasons', vr.reasons, 'origin', vr.origin, 'evaluatedAt', vr.evaluated_at)) FROM validation_results vr WHERE vr.contribution_request_id = cr.id), '[]'::jsonb) AS validation_results
FROM contribution_requests cr
LEFT JOIN LATERAL (
  -- Faqat joriy versiya: almashtirilgan yozuv audit uchun qoladi, lekin
  -- moderatorga eski talaffuz ko'rsatilmaydi.
  SELECT candidate.*
  FROM audio_submissions candidate
  WHERE candidate.contribution_request_id = cr.id AND candidate.superseded_at IS NULL
  ORDER BY candidate.created_at DESC, candidate.id DESC
  LIMIT 1
) a ON true`;

const INTEGRATION_SELECT = `SELECT s.*, u.full_name AS last_rotated_by_name
  FROM integration_secrets s
  LEFT JOIN users u ON u.id = s.last_rotated_by`;

/**
 * Serverda haqiqiy mijozi bor providerlar. Qolganlari uchun kalit saqlanadi,
 * lekin hech qayerda ishlatilmaydi — panel buni ochiq ko'rsatishi kerak.
 */
const SUPPORTED_INTEGRATIONS = new Set(['stt_primary']);

function mapIntegration(row: QueryResultRow) {
  return {
    provider: row.provider,
    displayName: row.display_name,
    isConfigured: !!row.secret_ciphertext,
    maskedHint: row.masked_hint,
    keyVersion: row.key_version,
    lastRotatedAt: iso(row.last_rotated_at),
    lastRotatedBy: row.last_rotated_by_name ?? null,
    lastUsedAt: iso(row.last_used_at),
    health: row.health,
    healthCheckedAt: iso(row.health_checked_at),
    publicConfig: row.public_config,
    isEnabled: row.is_enabled,
    isSupported: SUPPORTED_INTEGRATIONS.has(String(row.provider)),
  };
}

type IntegrationHealth = 'unknown' | 'ok' | 'degraded' | 'failing' | 'not_configured';

/** Kalitni ochib ko'rsatmasdan, provider javob berishini tekshiradi. */
async function checkIntegrationHealth(provider: string, isConfigured: boolean, isEnabled: boolean): Promise<{ health: IntegrationHealth; message: string }> {
  if (!isConfigured) return { health: 'not_configured', message: 'Kalit hali kiritilmagan.' };
  if (!isEnabled) return { health: 'not_configured', message: 'Integratsiya o‘chirilgan holatda.' };
  if (!SUPPORTED_INTEGRATIONS.has(provider)) {
    return { health: 'unknown', message: 'Kalit saqlandi, ammo bu provider serverda hali ulanmagan — u hozircha ishlatilmaydi.' };
  }

  const key = await loadIntegrationSecret(provider);
  if (!key) return { health: 'not_configured', message: 'Kalitni o‘qib bo‘lmadi. Uni qaytadan kiriting.' };
  try {
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return { health: 'ok', message: 'Provider javob berdi, kalit qabul qilindi.' };
    if (response.status === 401 || response.status === 403) {
      return { health: 'failing', message: 'Provider kalitni qabul qilmadi. Kalitni qaytadan kiriting.' };
    }
    return { health: 'degraded', message: `Provider javob berdi, ammo holat kodi ${response.status}.` };
  } catch {
    // Xato matni (host, kalit bo'lagi) mijozga ko'chirilmaydi.
    return { health: 'failing', message: 'Providerga ulanib bo‘lmadi. Internet yoki xizmat holatini tekshiring.' };
  }
}

async function loadIntegrationSecret(provider: string): Promise<string | null> {
  const result = await db.query<{ secret_ciphertext: Buffer | null; secret_nonce: Buffer | null }>('SELECT secret_ciphertext, secret_nonce FROM integration_secrets WHERE provider = $1 AND is_enabled = true', [provider]);
  const row = result.rows[0];
  if (!row?.secret_ciphertext || !row.secret_nonce) return null;
  // Egasi kalit haqiqatan ishlatilayotganini panelda ko'rishi uchun.
  void db.query('UPDATE integration_secrets SET last_used_at = now() WHERE provider = $1', [provider])
    .catch((error: unknown) => app.log.warn(error, 'Integratsiya foydalanish vaqti yangilanmadi'));
  return decryptSecret(row.secret_ciphertext, row.secret_nonce);
}
async function storeAudio(buffer: Buffer, filename: string, mimeType: string): Promise<{ bucket: string; key: string }> {
  const key = `${new Date().toISOString().slice(0, 10)}/${newId()}-${basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  if (config.storageMode === 'supabase') {
    const response = await fetch(`${config.supabaseUrl}/storage/v1/object/${config.supabaseBucket}/${key}`, { method: 'POST', headers: { Authorization: `Bearer ${config.supabaseServiceRoleKey}`, apikey: config.supabaseServiceRoleKey!, 'Content-Type': mimeType, 'x-upsert': 'false' }, body: new Uint8Array(buffer) });
    if (!response.ok) throw new Error('Supabase Storage audio qabul qilmadi.');
    return { bucket: config.supabaseBucket, key };
  }
  const fullPath = join(config.uploadDir, key);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, buffer);
  return { bucket: 'local', key };
}

async function deleteStoredAudio(stored: { bucket: string; key: string }): Promise<void> {
  if (stored.bucket === 'local') {
    await unlink(join(config.uploadDir, stored.key)).catch(() => undefined);
    return;
  }
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) return;
  const encodedKey = stored.key.split('/').map(encodeURIComponent).join('/');
  await fetch(
    `${config.supabaseUrl}/storage/v1/object/${encodeURIComponent(stored.bucket)}/${encodedKey}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
        apikey: config.supabaseServiceRoleKey,
      },
    },
  ).catch(() => undefined);
}
async function transcribe(buffer: Buffer, filename: string, mimeType: string): Promise<{ text: string; confidence: number | null; language: string | null }> {
  const key = await loadIntegrationSecret('stt_primary') ?? config.groqApiKey;
  if (!key) throw new Error('STT provider ulanmagan.');
  const body = new FormData();
  body.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);
  body.append('model', config.groqModel);
  body.append('language', 'uz');
  body.append('response_format', 'json');
  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body });
  if (!response.ok) throw new Error('STT provider hozir javob bermayapti.');
  const data = await response.json() as { text?: string; language?: string };
  if (!data.text?.trim()) throw new Error('Audio ichidan so‘z aniqlanmadi.');
  return { text: data.text.trim(), confidence: null, language: data.language ?? 'uz' };
}

app.get('/health', async (_request, reply) => {
  try {
    await db.query('SELECT 1');
    return { status: 'ok', service: 'xorazm-api', database: 'connected', time: new Date().toISOString() };
  } catch {
    return reply.status(503).send({ status: 'error', service: 'xorazm-api', database: 'unavailable' });
  }
});

app.post('/v3/auth/admin/login', async (request, reply) => {
  const body = asObject(request.body); const email = asString(body.email); const password = asString(body.password);
  if (!email || !password) return apiError(reply, 422, 'validation_failed', 'Email va parol majburiy.');
  const found = await db.query('SELECT id, full_name, email, phone, password_hash, is_active, locked_until FROM users WHERE email = $1 AND is_anonymous = false', [email]);
  const user = found.rows[0];
  const locked = user?.locked_until && new Date(user.locked_until).getTime() > Date.now();
  if (locked) {
    return apiError(reply, 429, 'rate_limited', 'Hisob 15 daqiqaga vaqtincha himoyalangan. Biroz kutib qayta urinib ko‘ring.');
  }
  if (!user || !user.is_active || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    if (user) await db.query('UPDATE users SET failed_login_count = failed_login_count + 1, locked_until = CASE WHEN failed_login_count + 1 >= 5 THEN now() + interval \'15 minutes\' ELSE locked_until END WHERE id = $1', [user.id]);
    return apiError(reply, 401, 'unauthorized', 'Email yoki parol noto‘g‘ri.');
  }
  const rolesResult = await db.query('SELECT r.code, r.permissions FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = $1', [user.id]);
  const roles = rolesResult.rows.map((row) => row.code).filter((role) => ['admin','moderator','editor'].includes(role));
  if (!roles.length) return apiError(reply, 403, 'forbidden', 'Bu hisob admin panel uchun ruxsatga ega emas.');
  const permissions = [...new Set(rolesResult.rows.flatMap((row) => row.permissions ?? []))];
  const assigned = await db.query('SELECT region_id FROM user_region_assignments WHERE user_id = $1', [user.id]);
  const { token, expiresAt } = await signAccessToken({ sub: user.id, roles, permissions });
  const refreshToken = randomBytes(48).toString('base64url');
  const device = asObject(body.device);
  await db.query('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
  await db.query('INSERT INTO admin_sessions (user_id, refresh_token_hash, installation_id, platform, app_version, expires_at) VALUES ($1,$2,$3,$4,$5, now() + interval \'30 days\')', [user.id, hashToken(refreshToken), asString(device.installationId), asString(device.platform) || 'android', asString(device.appVersion)]);
  const claims: Claims = { sub: user.id, roles, permissions };
  await audit(claims, 'auth.login', 'user', user.id, null, { email }, request);
  return { status: 'ok', session: { user: { id: user.id, fullName: user.full_name, email: user.email, phone: user.phone, roles, assignedRegionIds: assigned.rows.map((row) => row.region_id), isActive: user.is_active, lastLoginAt: iso(user.last_login_at) }, permissions, accessToken: token, accessTokenExpiresAt: expiresAt, refreshToken } };
});

app.post('/v3/auth/admin/refresh', async (request, reply) => {
  const refreshToken = asString(asObject(request.body).refreshToken);
  const session = await db.query('SELECT s.user_id, r.code, r.permissions FROM admin_sessions s JOIN user_roles ur ON ur.user_id=s.user_id JOIN roles r ON r.id=ur.role_id WHERE s.refresh_token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > now()', [hashToken(refreshToken)]);
  if (!session.rows.length) return apiError(reply, 401, 'unauthorized', 'Sessiya tugadi.');
  const userId = session.rows[0].user_id; const roles = session.rows.map((row) => row.code); const permissions = [...new Set(session.rows.flatMap((row) => row.permissions ?? []))];
  const nextRefresh = randomBytes(48).toString('base64url'); const signed = await signAccessToken({ sub: userId, roles, permissions });
  await db.query('UPDATE admin_sessions SET revoked_at=now() WHERE refresh_token_hash=$1', [hashToken(refreshToken)]);
  await db.query('INSERT INTO admin_sessions (user_id, refresh_token_hash, installation_id, platform, expires_at) VALUES ($1,$2,$3,$4,now()+interval \'30 days\')', [userId, hashToken(nextRefresh), 'refresh', 'android']);
  return { accessToken: signed.token, accessTokenExpiresAt: signed.expiresAt, refreshToken: nextRefresh };
});
app.post('/v3/auth/admin/logout', async (request) => { const auth = request.headers.authorization?.slice(7); if (auth) { const claims = await claimsFor(request); if (claims) await db.query('UPDATE admin_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [claims.sub]); } return {}; });

app.get('/v3/regions', async (request) => {
  const query = request.query as Json; const params: unknown[] = []; const filters: string[] = [];
  if (query.parentId) { params.push(query.parentId); filters.push(`parent_id = $${params.length}`); }
  if (query.level) { params.push(query.level); filters.push(`level = $${params.length}`); }
  const regions = await db.query(`SELECT * FROM regions ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY sort_order, name_uz`, params);
  const response: Json = { items: regions.rows.map(mapRegion) };
  if (bool(query.includeGeofences)) {
    const [fences, dialects] = await Promise.all([db.query('SELECT * FROM geofences WHERE is_active=true'), db.query(`SELECT d.*, COALESCE(array_agg(dr.region_id) FILTER (WHERE dr.region_id IS NOT NULL), '{}') AS region_ids FROM dialects d LEFT JOIN dialect_regions dr ON dr.dialect_id=d.id GROUP BY d.id`)]);
    response.geofences = fences.rows.map(mapFence); response.dialects = dialects.rows.map(mapDialect);
  }
  return response;
});

/** Hudud katalogi loyiha egasi nazoratida. Boshlanishida faqat Xorazm
 * ochiq; yangi viloyatlar avval yopiq yaratiladi va admin alohida yoqadi. */
app.post('/v3/admin/regions', async (request, reply) => {
  const claims = await requirePermission(request, reply, 'regions:write'); if (!claims) return;
  const body = asObject(request.body); const nameUz = asString(body.nameUz); const code = asString(body.code).toLowerCase(); const reason = asString(body.changeReason);
  const level = asString(body.level) || 'region';
  if (!nameUz || !code || !reason) return apiError(reply, 422, 'validation_failed', 'Hudud nomi, kodi va o‘zgarish sababi majburiy.');
  if (!['region','district','village','neighborhood'].includes(level)) return apiError(reply, 422, 'validation_failed', 'Hudud darajasi noto‘g‘ri.');
  const parentId = asString(body.parentId) || (level === 'region' ? '00000000-0000-4000-8000-000000000000' : '');
  if (!isUuid(parentId)) return apiError(reply, 422, 'validation_failed', 'Yuqori hududni tanlash majburiy.');
  const parent = await db.query('SELECT id, level::text, is_contribution_allowed FROM regions WHERE id=$1', [parentId]);
  if (!parent.rows[0] || !canCreateRegionUnder(level as 'region' | 'district' | 'village' | 'neighborhood', String(parent.rows[0].level))) {
    return apiError(reply, 422, 'validation_failed', 'Yangi hudud darajasi tanlangan yuqori hududga mos emas.');
  }
  if (level !== 'region' && !parent.rows[0].is_contribution_allowed) {
    return apiError(reply, 422, 'validation_failed', 'Yopiq yuqori hudud ostida hissa hududi yaratib bo‘lmaydi.');
  }
  try {
    const created = await db.query(`INSERT INTO regions (code,name_uz,parent_id,level,is_contribution_allowed,sort_order,created_by,updated_by)
      VALUES ($1,$2,$3,$4,false,COALESCE((SELECT max(sort_order)+1 FROM regions),1),$5,$5) RETURNING *`, [code,nameUz,parentId,level,claims.sub]);
    await audit(claims, 'region.update', 'region', created.rows[0].id, reason, { action:'create', code, nameUz, level, isContributionAllowed:false }, request);
    return reply.status(201).send({ region: mapRegion(created.rows[0]) });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return apiError(reply, 409, 'conflict', 'Bunday hudud kodi allaqachon mavjud.');
    throw error;
  }
});

app.patch('/v3/admin/regions/:id', async (request, reply) => {
  const claims = await requirePermission(request, reply, 'regions:write'); if (!claims) return;
  const id = asString((request.params as Json).id); const body = asObject(request.body); const reason = asString(body.changeReason);
  if (!reason || typeof body.isContributionAllowed !== 'boolean') return apiError(reply, 422, 'validation_failed', 'Hissa holati va o‘zgarish sababi majburiy.');
  const current = await db.query('SELECT * FROM regions WHERE id=$1', [id]); if (!current.rows[0]) return apiError(reply, 404, 'not_found', 'Hudud topilmadi.');
  if (current.rows[0].level === 'republic') return apiError(reply, 422, 'validation_failed', 'Respublika darajasi hissa hududi sifatida yoqilmaydi.');
  const updated = await db.query('UPDATE regions SET is_contribution_allowed=$2,updated_by=$3 WHERE id=$1 RETURNING *', [id,body.isContributionAllowed,claims.sub]);
  await audit(claims, 'region.update', 'region', id, reason, { isContributionAllowed:body.isContributionAllowed }, request);
  return { region: mapRegion(updated.rows[0]) };
});

app.get('/v3/words', async (request) => {
  const query = request.query as Json; const requester = await claimsFor(request); const params: unknown[] = []; const where: string[] = [];
  if (!requester || !query.status) where.push(`status = 'published'`); else { params.push(query.status); where.push(`status = $${params.length}`); }
  if (query.search) { params.push(`%${asString(query.search)}%`); where.push(`(word ILIKE $${params.length} OR meaning ILIKE $${params.length})`); }
  if (query.regionId) { params.push(query.regionId); where.push(`(region_id=$${params.length} OR district_id=$${params.length})`); }
  if (query.dialectId) { params.push(query.dialectId); where.push(`dialect_id=$${params.length}`); }
  if (query.category) { params.push(query.category); where.push(`category=$${params.length}`); }
  const current = page(query.page); const size = pageSize(query.pageSize); const order = query.sort === 'alphabetical' ? 'word ASC' : 'created_at DESC';
  const count = await db.query(`SELECT count(*)::int AS total FROM words ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`, params);
  params.push(size, (current - 1) * size);
  const words = await db.query(`SELECT * FROM words ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const total = count.rows[0].total; return { items: words.rows.map(mapWord), meta: { page: current, pageSize: size, total, totalPages: Math.ceil(total / size) } };
});
app.get('/v3/words/:id', async (request, reply) => { const result = await db.query('SELECT * FROM words WHERE id=$1 AND status=\'published\'', [(request.params as Json).id]); if (!result.rows[0]) return apiError(reply, 404, 'not_found', 'So‘z topilmadi.'); return mapWord(result.rows[0]); });

/** Adminning bevosita lug‘atga kiritishi: foydalanuvchi taklifidan farqli
 * ravishda nashr etilgan yozuv darhol yaratiladi va auditga tushadi. */
app.post('/v3/admin/words', async (request, reply) => {
  const claims = await requirePermission(request, reply, 'words:write'); if (!claims) return;
  const body = asObject(request.body); const word = asString(body.word); const meaning = asString(body.meaning); const reason = asString(body.changeReason);
  if (!word || !meaning || !reason) return apiError(reply, 422, 'validation_failed', 'So‘z, ma’no va kiritish sababi majburiy.');
  const exists = await db.query(`SELECT id FROM words WHERE status <> 'archived' AND phonetic_key=$1 LIMIT 1`, [phoneticKey(word)]);
  if (exists.rows[0]) return apiError(reply, 409, 'conflict', 'Shunga o‘xshash so‘z lug‘atda allaqachon bor.');
  const created = await db.query(`INSERT INTO words (word,literary_form,meaning,example,category,phonetic_key,status,region_id,district_id,dialect_id)
    VALUES ($1,$2,$3,$4,$5,$6,'published',$7,$8,$9) RETURNING *`, [word, body.literaryForm ?? null, meaning, body.example ?? null, body.category ?? null, phoneticKey(word), body.regionId ?? null, body.districtId ?? null, body.dialectId ?? null]);
  const auditLogId = await audit(claims, 'word.create', 'word', created.rows[0].id, reason, { word, meaning, source: 'admin_direct' }, request);
  return reply.status(201).send({ word: mapWord(created.rows[0]), auditLogId });
});

app.post('/v3/contributions/words', async (request, reply) => {
  if (!(await enforceRateLimit(request, reply, 'word-contribution', 20, 15 * 60))) return;
  const body = asObject(request.body); const payload = asObject(body.payload); const location = asObject(body.location); const device = asObject(body.device); const key = asString(body.idempotencyKey);
  if (!asString(payload.word) || !asString(payload.meaning) || !key) return apiError(reply, 422, 'validation_failed', 'So‘z, ma’no va idempotency kaliti majburiy.');
  const existing = await db.query(`${requestSql} WHERE cr.idempotency_key=$1`, [key]); if (existing.rows[0]) return { request: await mapRequest(existing.rows[0]), userMessage: 'Avvalgi so‘rov qaytarildi.' };
  const geofences = await activeFences(); const heritageDeclaration = bool(body.heritageDeclaration);
  const hasLocation = Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude));
  const gate = hasLocation ? practicalMobileGate(location, geofences) : null;
  // GPS hissa yuborish sharti emas. Hudud foydalanuvchi tanlovi va admin
  // moderatsiyasi bilan belgilanadi; mavjud koordinata faqat ixtiyoriy auditdir.
  const requestedRegionId = asString(payload.regionId) || '00000000-0000-4000-8000-000000000001';
  if (!isUuid(requestedRegionId)) return apiError(reply, 422, 'validation_failed', 'Tanlangan viloyat identifikatori noto‘g‘ri.', { 'payload.regionId': ['Rasmiy hududni qayta tanlang.'] });
  const allowedRegion = await db.query('SELECT id, level FROM regions WHERE id=$1 AND is_contribution_allowed=true', [requestedRegionId]);
  if (!allowedRegion.rows[0]) return apiError(reply, 422, 'validation_failed', 'Tanlangan hudud uchun hissa qabul qilish admin tomonidan yoqilmagan.');
  payload.regionId = requestedRegionId;

  let proposedRegion: ReturnType<typeof parseRegionSuggestion> = null;
  try {
    proposedRegion = parseRegionSuggestion(payload.proposedRegion, requestedRegionId);
  } catch (error) {
    if (error instanceof RegionSuggestionValidationError) {
      return apiError(reply, 422, 'validation_failed', error.message, { [error.field]: [error.message] });
    }
    throw error;
  }

  if (proposedRegion) {
    const conflictField = proposedRegion.level === 'district'
      ? 'districtId'
      : proposedRegion.level === 'village'
        ? 'villageId'
        : 'neighborhood';
    if (asString(payload[conflictField])) {
      return apiError(reply, 422, 'validation_failed', 'Rasmiy hudud va “Boshqa” hududni bir vaqtda tanlab bo‘lmaydi.', {
        [`payload.${conflictField}`]: ['Bittasini tanlang.'],
        'payload.proposedRegion': ['Bittasini tanlang.'],
      });
    }

    const parent = await db.query('SELECT id, parent_id, level, is_contribution_allowed FROM regions WHERE id=$1', [proposedRegion.parentRegionId]);
    if (!parent.rows[0] || !parent.rows[0].is_contribution_allowed) {
      return apiError(reply, 422, 'validation_failed', 'Boshqa hudud uchun tanlangan yuqori hudud hissa qabul qilmaydi.', {
        'payload.proposedRegion.parentRegionId': ['Yuqori hududni qayta tanlang.'],
      });
    }
    if (!canBeChildOf(proposedRegion.level, String(parent.rows[0].level))) {
      return apiError(reply, 422, 'validation_failed', 'Boshqa hudud darajasi tanlangan yuqori hududga mos emas.', {
        'payload.proposedRegion.level': ['Hudud turini qayta tanlang.'],
      });
    }

    const lineage = await db.query(`WITH RECURSIVE lineage AS (
      SELECT id, parent_id FROM regions WHERE id=$1
      UNION ALL
      SELECT r.id, r.parent_id FROM regions r JOIN lineage l ON l.parent_id=r.id
    ) SELECT 1 FROM lineage WHERE id=$2 LIMIT 1`, [proposedRegion.parentRegionId, requestedRegionId]);
    if (!lineage.rows[0]) {
      return apiError(reply, 422, 'validation_failed', 'Boshqa hudud tanlangan viloyat tarkibiga kirmaydi.', {
        'payload.proposedRegion.parentRegionId': ['Mos yuqori hududni tanlang.'],
      });
    }
    if (proposedRegion.level === 'village' && asString(payload.districtId) !== proposedRegion.parentRegionId) {
      return apiError(reply, 422, 'validation_failed', 'Boshqa qishloq uchun uning tumani ham tanlanishi kerak.', {
        'payload.proposedRegion.parentRegionId': ['Tanlangan tuman bilan bir xil bo‘lishi kerak.'],
        'payload.districtId': ['Qishloqning tumanini tanlang.'],
      });
    }
    if (proposedRegion.level === 'neighborhood') {
      const expectedParent = String(parent.rows[0].level) === 'village'
        ? asString(payload.villageId)
        : asString(payload.districtId);
      if (expectedParent !== proposedRegion.parentRegionId) {
        return apiError(reply, 422, 'validation_failed', 'Boshqa mahalla uchun uning yuqori hududi ham tanlanishi kerak.', {
          'payload.proposedRegion.parentRegionId': ['Tanlangan yuqori hudud bilan bir xil bo‘lishi kerak.'],
        });
      }
    }

    const siblings = await db.query('SELECT id, name_uz FROM regions WHERE parent_id=$1 AND level=$2', [proposedRegion.parentRegionId, proposedRegion.level]);
    const existingRegion = siblings.rows.find((row) => normalizeRegionName(String(row.name_uz)) === normalizeRegionName(proposedRegion!.nameUz));
    if (existingRegion) {
      return apiError(reply, 409, 'conflict', 'Bu hudud ro‘yxatda mavjud. “Boshqa” o‘rniga ro‘yxatdan tanlang.', {
        'payload.proposedRegion.nameUz': ['Mavjud hududni tanlang.'],
      });
    }
    payload.proposedRegion = proposedRegion;
  } else {
    delete payload.proposedRegion;
  }

  for (const [field, expectedLevel] of [['districtId', 'district'], ['villageId', 'village']] as const) {
    const selectedId = asString(payload[field]);
    if (!selectedId) continue;
    if (!isUuid(selectedId)) return apiError(reply, 422, 'validation_failed', 'Tanlangan hudud identifikatori noto‘g‘ri.', { [`payload.${field}`]: ['Hududni qayta tanlang.'] });
    const selected = await db.query(`WITH RECURSIVE lineage AS (
      SELECT id, parent_id, level, is_contribution_allowed FROM regions WHERE id=$1
      UNION ALL
      SELECT r.id, r.parent_id, r.level, r.is_contribution_allowed FROM regions r JOIN lineage l ON l.parent_id=r.id
    ) SELECT
      EXISTS(SELECT 1 FROM lineage WHERE id=$2) AS belongs_to_region,
      (SELECT level::text FROM lineage WHERE id=$1) AS selected_level,
      (SELECT is_contribution_allowed FROM lineage WHERE id=$1) AS contribution_allowed`, [selectedId, requestedRegionId]);
    const selection = selected.rows[0];
    if (!selection?.belongs_to_region || selection.selected_level !== expectedLevel || !selection.contribution_allowed) {
      return apiError(reply, 422, 'validation_failed', 'Tanlangan tuman/qishloq viloyatga mos emas yoki hissa uchun yopiq.', { [`payload.${field}`]: ['Hududni qayta tanlang.'] });
    }
  }
  const selectedDistrictId = asString(payload.districtId) || null;
  const selectedVillageId = asString(payload.villageId) || null;
  if (selectedVillageId) {
    const village = await db.query('SELECT level::text, parent_id FROM regions WHERE id=$1 AND is_contribution_allowed=true', [selectedVillageId]);
    const row = village.rows[0];
    if (!isDirectVillageChild(row ? { level: String(row.level), parentId: nullableString(row.parent_id) } : null, selectedDistrictId)) {
      return apiError(reply, 422, 'validation_failed', 'Tanlangan qishloq aynan tanlangan tumanga tegishli bo‘lishi kerak.', {
        'payload.villageId': ['Mos qishloqni tanlang.'],
        'payload.districtId': ['Qishloqning tumanini tanlang.'],
      });
    }
  }
  const duplicates = await db.query('SELECT id, word, phonetic_key FROM words WHERE status <> \'archived\'');
  const validation = validateContributionText({ payload: payload as never, locationGate: null, duplicateCandidates: duplicates.rows.map((row) => ({ id: row.id, word: row.word, phoneticKey: row.phonetic_key })), origin: 'server', thresholds: { rejectBelow:0, autoQueueAbove:65, minConfidenceForVerdict:0.5 } });
  if (validation.verdict === 'rejected') return apiError(reply, 422, 'validation_failed', 'So‘z avtomatik tekshiruvdan o‘tmadi.');
  const created = await db.query(`INSERT INTO contribution_requests (payload, device, idempotency_key, latitude, longitude, location_accuracy_m, location_checked_at, submission_location_status, matched_geofence_id, geofence_version, distance_to_boundary_m, is_location_mocked, validation_verdict, validation_score, requires_human_review)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`, [payload, { ...device, heritageDeclaration }, key, hasLocation ? location.latitude : null, hasLocation ? location.longitude : null, hasLocation ? location.accuracy : null, hasLocation ? location.capturedAt : null, hasLocation ? gate?.status ?? 'not_provided' : 'not_provided', gate?.matchedGeofenceId ?? null, geofences.find((f) => f.id === gate?.matchedGeofenceId)?.version ?? null, gate?.distanceToBoundaryM ?? null, hasLocation ? location.isMocked ?? null : null, validation.verdict, validation.score, true]);
  const requestId = created.rows[0].id;
  await db.query(INSERT_VALIDATION_RESULT, [requestId, validation.subject, validation.verdict, validation.score, validation.confidence, jsonb(validation.reasons), validation.engine.kind, validation.engine.name, validation.engine.version, validation.origin, geofences.find((f) => f.id === gate?.matchedGeofenceId)?.version ?? null]);
  const record = await db.query(`${requestSql} WHERE cr.id=$1`, [requestId]); return {
    request: await mapRequest(record.rows[0]),
    userMessage: proposedRegion
      ? 'So‘zingiz va yangi hudud taklifingiz moderatorlar tekshiruviga yuborildi.'
      : 'So‘zingiz moderatorlar tekshiruviga yuborildi.',
  };
});

app.post('/v3/audio/transcriptions', async (request, reply) => {
  if (!(await enforceRateLimit(request, reply, 'audio-transcription', 12, 10 * 60))) return;
  const file = await request.file(); if (!file) return apiError(reply, 422, 'validation_failed', 'Audio fayl topilmadi.');
  const buffer = await file.toBuffer();
  if (!AUDIO_LIMITS.allowedMimeTypes.includes(file.mimetype as never)) return apiError(reply, 415, 'unsupported_media_type', 'Audio formati qo‘llab-quvvatlanmaydi.');
  if (!buffer.length || buffer.length > AUDIO_LIMITS.maxSizeBytes) return apiError(reply, 413, 'payload_too_large', 'Audio fayl hajmi noto‘g‘ri.');
  try { const result = await transcribe(buffer, file.filename, file.mimetype); return result; } catch (error) { return apiError(reply, 503, 'provider_unavailable', error instanceof Error ? error.message : 'STT ishlamayapti.'); }
});

app.post('/v3/contributions/audio', async (request, reply) => {
  if (!(await enforceRateLimit(request, reply, 'audio-upload', 30, 15 * 60))) return;
  const file = await request.file(); if (!file) return apiError(reply, 422, 'validation_failed', 'Audio fayl topilmadi.');
  const buffer = await file.toBuffer();
  const metaText = multipartFieldValue(file.fields.meta); let meta: Json = {};
  try { meta = JSON.parse(String(metaText ?? '{}')) as Json; } catch { return apiError(reply, 422, 'validation_failed', 'Audio metama’lumoti noto‘g‘ri.'); }
  const headerKey = Array.isArray(request.headers['idempotency-key']) ? request.headers['idempotency-key'][0] : request.headers['idempotency-key'];
  const idempotencyKey = asString(meta.idempotencyKey) || asString(headerKey);
  const durationMs = Number(meta.durationMs);
  const contributionRequestId = nullableString(meta.contributionRequestId);
  const wordId = nullableString(meta.wordId);
  const expectedText = asString(meta.expectedText);
  const device = asObject(meta.device);
  const installationId = asString(device.installationId);
  if (!idempotencyKey || idempotencyKey.length > 255) return apiError(reply, 422, 'validation_failed', 'Audio idempotency kaliti majburiy.');
  if (!expectedText || expectedText.length > 160) return apiError(reply, 422, 'validation_failed', 'Kutilgan so‘z noto‘g‘ri.');
  if (!installationId || installationId.length > 160) return apiError(reply, 422, 'validation_failed', 'Qurilma identifikatori majburiy.');
  if (!idempotencyKey.startsWith(`${installationId}:`)) return apiError(reply, 403, 'forbidden', 'Audio kaliti ushbu qurilmaga tegishli emas.');
  if (Number(Boolean(contributionRequestId)) + Number(Boolean(wordId)) !== 1) return apiError(reply, 422, 'validation_failed', 'Audio bitta so‘z yoki bitta taklifga biriktirilishi kerak.');
  if ((contributionRequestId && !isUuid(contributionRequestId)) || (wordId && !isUuid(wordId))) return apiError(reply, 422, 'validation_failed', 'Audio nishoni noto‘g‘ri.');
  if (!Number.isFinite(durationMs) || durationMs < AUDIO_LIMITS.minDurationMs || durationMs > AUDIO_LIMITS.maxDurationMs) {
    return apiError(reply, 422, 'validation_failed', 'Audio davomiyligi 0,7–40 soniya bo‘lishi kerak.');
  }
  if (asString(meta.mimeType) && asString(meta.mimeType) !== file.mimetype) return apiError(reply, 422, 'validation_failed', 'Audio MIME metama’lumoti faylga mos emas.');
  if (!AUDIO_LIMITS.allowedMimeTypes.includes(file.mimetype as never)) return apiError(reply, 415, 'unsupported_media_type', 'Audio formati qo‘llab-quvvatlanmaydi.');
  if (!buffer.length || buffer.length > AUDIO_LIMITS.maxSizeBytes) return apiError(reply, 413, 'payload_too_large', 'Audio fayl hajmi noto‘g‘ri.');
  const checksumSha256 = createHash('sha256').update(buffer).digest('hex');
  const incomingFingerprint: AudioIdempotencyFingerprint = {
    contributionRequestId,
    wordId,
    checksumSha256,
    mimeType: file.mimetype,
    durationMs,
    expectedText,
  };

  const client: PoolClient = await db.connect();
  let transactionOpen = false;
  let stored: { bucket: string; key: string } | null = null;
  let targetStatus = '';
  let targetExpectedText = '';
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    // DB advisory lock barcha Render instansiyalari orasida ham bir xil
    // idempotency/target amallarini ketma-ket bajaradi.
    const lockKeys = [
      `audio:idempotency:${idempotencyKey}`,
      contributionRequestId ? `audio:request:${contributionRequestId}` : `audio:word:${wordId}`,
    ].sort();
    for (const lockKey of lockKeys) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
    }

    if (contributionRequestId) {
      const target = await client.query('SELECT id, status, payload, device FROM contribution_requests WHERE id=$1 FOR UPDATE', [contributionRequestId]);
      const targetRow = target.rows[0];
      if (!targetRow) throw new RouteFault(404, 'not_found', 'So‘z taklifi topilmadi.');
      const ownerInstallationId = asString(asObject(targetRow.device).installationId);
      if (!ownerInstallationId || ownerInstallationId !== installationId) {
        throw new RouteFault(403, 'forbidden', 'Bu taklif boshqa qurilmaga tegishli.');
      }
      targetStatus = String(targetRow.status);
      targetExpectedText = asString(asObject(targetRow.payload).word);
    } else {
      const target = await client.query('SELECT id, status FROM words WHERE id=$1', [wordId]);
      if (!target.rows[0]) throw new RouteFault(404, 'not_found', 'Lug‘at so‘zi topilmadi.');
      targetStatus = String(target.rows[0].status);
    }

    const existing = await client.query('SELECT * FROM audio_submissions WHERE idempotency_key=$1', [idempotencyKey]);
    if (existing.rows[0]) {
      const row = existing.rows[0];
      const storedFingerprint: AudioIdempotencyFingerprint = {
        contributionRequestId: nullableString(row.contribution_request_id),
        wordId: nullableString(row.word_id),
        checksumSha256: String(row.checksum_sha256),
        mimeType: String(row.mime_type),
        durationMs: Number(row.duration_ms),
        expectedText: String(row.expected_text),
      };
      if (!sameAudioFingerprint(storedFingerprint, incomingFingerprint)) {
        throw new RouteFault(409, 'conflict', 'Idempotency kaliti boshqa audio uchun avval ishlatilgan.');
      }
      await client.query('COMMIT');
      transactionOpen = false;
      return { submission: await mapAudioSubmission(row), userMessage: 'Avvalgi audio so‘rovi qaytarildi.' };
    }

    // Idempotent retry avvalgi muvaffaqiyatli javobni holat keyin o‘zgargan
    // bo‘lsa ham qaytaradi; yangi upload esa joriy target holatini tekshiradi.
    if (contributionRequestId) {
      if (!['pending', 'needs_clarification'].includes(targetStatus)) {
        throw new RouteFault(409, 'conflict', 'Yakunlangan taklifga audio qo‘shib bo‘lmaydi.');
      }
      if (normalizeExpectedText(targetExpectedText) !== normalizeExpectedText(expectedText)) {
        throw new RouteFault(422, 'validation_failed', 'Audio so‘zi taklifdagi so‘zga mos emas.');
      }
    } else if (targetStatus !== 'published') {
      throw new RouteFault(409, 'conflict', 'Nashr qilinmagan lug‘at so‘ziga audio qo‘shib bo‘lmaydi.');
    }

    let supersededAudioId: string | null = null;
    let nextVersion = 1;
    if (contributionRequestId) {
      const attached = await client.query('SELECT id, version, moderation_status::text AS moderation_status FROM audio_submissions WHERE contribution_request_id=$1 AND superseded_at IS NULL LIMIT 1', [contributionRequestId]);
      const currentAudio = attached.rows[0];
      if (currentAudio) {
        // Moderator «qayta yozishni so'rash» yoki «rad etish» qarorini bergan
        // bo'lsa, foydalanuvchi yangi talaffuz yuborishi mumkin. Eski yozuv
        // o'chirilmaydi — u audit dalili bo'lib qoladi.
        if (!['needs_clarification', 'rejected'].includes(String(currentAudio.moderation_status))) {
          throw new RouteFault(409, 'conflict', 'Bu taklifga audio allaqachon biriktirilgan.');
        }
        supersededAudioId = String(currentAudio.id);
        nextVersion = Number(currentAudio.version ?? 1) + 1;
      }
    } else {
      const duplicate = await client.query('SELECT id FROM audio_submissions WHERE word_id=$1 AND checksum_sha256=$2 LIMIT 1', [wordId, checksumSha256]);
      if (duplicate.rows[0]) throw new RouteFault(409, 'conflict', 'Aynan shu audio lug‘at so‘ziga avval qo‘shilgan.');
    }

    // Storage yozuvi transaction lock ostida yaratiladi. Keyingi DB bosqichi
    // xato bersa exact key darhol o‘chiriladi va orphan fayl qolmaydi.
    stored = await storeAudio(buffer, file.filename, file.mimetype);
    // Eski versiya avval belgilanadi: «bitta joriy audio» unikal indeksi
    // ikkitasi bir vaqtda joriy bo'lishiga yo'l qo'ymaydi.
    if (supersededAudioId) {
      await client.query('UPDATE audio_submissions SET superseded_at=now() WHERE id=$1', [supersededAudioId]);
    }
    const created = await client.query(`INSERT INTO audio_submissions (contribution_request_id, word_id, storage_bucket, storage_key, mime_type, duration_ms, size_bytes, checksum_sha256, expected_text, moderation_status, idempotency_key, version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11) RETURNING *`, [contributionRequestId, wordId, stored.bucket, stored.key, file.mimetype, durationMs, buffer.length, checksumSha256, expectedText, idempotencyKey, nextVersion]);
    if (supersededAudioId) {
      await client.query('UPDATE audio_submissions SET superseded_by=$2 WHERE id=$1', [supersededAudioId, created.rows[0].id]);
    }
    await client.query('COMMIT');
    transactionOpen = false;
    stored = null;
    return reply.status(201).send({ submission: await mapAudioSubmission(created.rows[0]), userMessage: 'Audio moderator tekshiruviga yuborildi.' });
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
    if (stored) await deleteStoredAudio(stored);
    return failFromError(reply, error, 'contributions.audio');
  } finally {
    client.release();
  }
});

app.get('/v3/requests', async (request, reply) => {
  if (!(await requirePermission(request, reply, 'requests:read'))) return;
  const query = request.query as Json; const params: unknown[] = []; const where: string[] = [];
  for (const [input, column] of [['status','cr.status'],['type','cr.type'],['verdict','cr.validation_verdict'],['locationStatus','cr.submission_location_status']] as const) if (query[input]) { params.push(query[input]); where.push(`${column}=$${params.length}`); }
  if (query.search) { params.push(`%${asString(query.search)}%`); where.push(`(cr.payload->>'word' ILIKE $${params.length} OR cr.payload->>'meaning' ILIKE $${params.length} OR cr.payload#>>'{proposedRegion,nameUz}' ILIKE $${params.length})`); }
  if (query.hasAudio !== undefined) {
    const hasAudio = String(query.hasAudio).toLowerCase();
    if (hasAudio !== 'true' && hasAudio !== 'false') return apiError(reply, 422, 'validation_failed', 'hasAudio true yoki false bo‘lishi kerak.');
    where.push(`${hasAudio === 'false' ? 'NOT ' : ''}EXISTS (SELECT 1 FROM audio_submissions filter_audio WHERE filter_audio.contribution_request_id=cr.id)`);
  }
  if (query.hasRegionSuggestion !== undefined) {
    const hasRegionSuggestion = String(query.hasRegionSuggestion).toLowerCase();
    if (hasRegionSuggestion !== 'true' && hasRegionSuggestion !== 'false') return apiError(reply, 422, 'validation_failed', 'hasRegionSuggestion true yoki false bo‘lishi kerak.');
    where.push(`${hasRegionSuggestion === 'false' ? 'NOT ' : ''}(cr.payload ? 'proposedRegion')`);
  }
  const current = page(query.page); const size = pageSize(query.pageSize); const count = await db.query(`SELECT count(*)::int AS total FROM contribution_requests cr ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`, params); params.push(size, (current - 1) * size);
  const rows = await db.query(`${requestSql} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY cr.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params); const total = count.rows[0].total;
  return { items: await Promise.all(rows.rows.map(mapRequest)), meta: { page: current, pageSize: size, total, totalPages: Math.ceil(total / size) } };
});

/**
 * Audio navbati. So'rovlar ro'yxatidan mustaqil, chunki audio uch xil holatda
 * bo'ladi: yangi taklifga biriktirilgan, nashr etilgan lug'at so'ziga
 * biriktirilgan, yoki (0007 migratsiyasi dublikatni ajratgani sabab) hech
 * qayerga bog'lanmagan. Oldingi ro'yxat faqat birinchisini ko'rsatardi.
 */
app.get('/v3/audio/moderation', async (request, reply) => {
  if (!(await requirePermission(request, reply, 'audio:read'))) return;
  const query = request.query as Json;
  const params: unknown[] = [];
  const where: string[] = [];
  const status = asString(query.status);
  if (status) {
    if (!['pending', 'approved', 'rejected', 'needs_clarification'].includes(status)) {
      return apiError(reply, 422, 'validation_failed', 'Audio holati noto‘g‘ri.');
    }
    params.push(status);
    where.push(`a.moderation_status = $${params.length}::moderation_status`);
  }
  if (query.analysisStatus) { params.push(asString(query.analysisStatus)); where.push(`a.analysis_status = $${params.length}::audio_analysis_status`); }
  // Almashtirilgan (qayta yozilgan) versiyalar navbatda ko'rinmaydi — ular
  // faqat audit uchun saqlanadi.
  if (!bool(query.includeSuperseded)) where.push('a.superseded_at IS NULL');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const current = page(query.page);
  const size = pageSize(query.pageSize);
  const count = await db.query<{ total: number }>(`SELECT count(*)::int AS total FROM audio_submissions a ${clause}`, params);
  params.push(size, (current - 1) * size);
  const rows = await db.query(`SELECT a.*,
      cr.id AS ctx_request_id, cr.status::text AS ctx_request_status, cr.payload AS ctx_request_payload,
      w.id AS ctx_word_id, w.word AS ctx_word, w.meaning AS ctx_word_meaning, w.status::text AS ctx_word_status
    FROM audio_submissions a
    LEFT JOIN contribution_requests cr ON cr.id = a.contribution_request_id
    LEFT JOIN words w ON w.id = a.word_id
    ${clause}
    ORDER BY a.created_at ASC, a.id ASC
    LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const total = count.rows[0]?.total ?? 0;
  return {
    items: await Promise.all(rows.rows.map(async (row) => ({
      submission: await mapAudioSubmission(row),
      context: audioContext(row),
    }))),
    meta: { page: current, pageSize: size, total, totalPages: Math.ceil(total / size) },
  };
});

/**
 * Audio qarori. FAQAT `audio_submissions` yozuvini o'zgartiradi: so'rov
 * statusiga ham, `words` jadvaliga ham tegmaydi.
 */
app.patch('/v3/audio/:id/moderation', async (request, reply) => {
  const claims = await requirePermission(request, reply, 'audio:moderate');
  if (!claims) return;
  const audioId = asString((request.params as Json).id);
  if (!isUuid(audioId)) return apiError(reply, 404, 'not_found', 'Audio topilmadi.');

  let decision: ReturnType<typeof parseAudioDecision>;
  try {
    decision = parseAudioDecision(request.body);
  } catch (error) {
    if (error instanceof AudioModerationValidationError) {
      return apiError(reply, 422, 'validation_failed', error.message, { [error.field]: [error.message] });
    }
    throw error;
  }

  const client: PoolClient = await db.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT * FROM audio_submissions WHERE id=$1 FOR UPDATE', [audioId]);
    const previous = locked.rows[0];
    if (!previous) throw new RouteFault(404, 'not_found', 'Audio topilmadi.');
    if (!isSameInstant(decision.expectedUpdatedAt, iso(previous.updated_at))) {
      throw new RouteFault(409, 'conflict', 'Bu audio boshqa moderator tomonidan yangilangan. Ro‘yxatni yangilang.');
    }

    const updated = await client.query(
      'UPDATE audio_submissions SET moderation_status=$2::moderation_status WHERE id=$1 RETURNING *',
      [audioId, decision.decision],
    );
    await client.query(
      `INSERT INTO moderation_decisions (contribution_request_id, audio_submission_id, moderator_id, decision, reason, automated_score)
       VALUES ($1,$2,$3,$4::moderation_status,$5,$6)`,
      [previous.contribution_request_id ?? null, audioId, claims.sub, decision.decision, decision.reason, previous.overall_score ?? null],
    );
    const auditLogId = await audit(claims, 'audio.decision', 'audio_submission', audioId, decision.reason, {
      moderationStatus: decision.decision,
      previousStatus: previous.moderation_status,
      source: 'audio_queue',
      contributionRequestId: previous.contribution_request_id ?? null,
      wordId: previous.word_id ?? null,
    }, request, client);
    await client.query('COMMIT');

    const context = await db.query(`SELECT a.*,
        cr.id AS ctx_request_id, cr.status::text AS ctx_request_status, cr.payload AS ctx_request_payload,
        w.id AS ctx_word_id, w.word AS ctx_word, w.meaning AS ctx_word_meaning, w.status::text AS ctx_word_status
      FROM audio_submissions a
      LEFT JOIN contribution_requests cr ON cr.id = a.contribution_request_id
      LEFT JOIN words w ON w.id = a.word_id
      WHERE a.id=$1`, [audioId]);
    const row = context.rows[0] ?? updated.rows[0];
    return { submission: await mapAudioSubmission(row), context: audioContext(row), auditLogId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return failFromError(reply, error, 'audio.moderation');
  } finally {
    client.release();
  }
});

app.patch('/v3/requests/:id/status', async (request, reply) => {
  const claims = await requirePermission(request, reply, 'requests:moderate'); if (!claims) return;
  const body = asObject(request.body); const id = asString((request.params as Json).id);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT * FROM contribution_requests WHERE id=$1 FOR UPDATE', [id]);
    if (!locked.rows[0]) {
      await client.query('ROLLBACK');
      return apiError(reply, 404, 'not_found', 'So‘rov topilmadi.');
    }
    const previous = locked.rows[0];
    if (asString(body.expectedUpdatedAt) !== iso(previous.updated_at)) {
      await client.query('ROLLBACK');
      return apiError(reply, 409, 'conflict', 'So‘rov boshqa moderator tomonidan yangilangan.');
    }
    const status = asString(body.status); const reason = asString(body.reason);
    if (!['approved','rejected','needs_clarification'].includes(status) || (status !== 'approved' && !reason)) {
      await client.query('ROLLBACK');
      return apiError(reply, 422, 'validation_failed', 'Qaror va zarur bo‘lsa sababi kiritilishi shart.');
    }
    const sourcePayload = asObject(previous.payload);
    const overrides = asObject(body.overrides);
    // Source payload audit dalilidir: foydalanuvchining `proposedRegion`
    // qiymatini moderator qarori bilan almashtirmaymiz.
    const storedPayload: Json = { ...sourcePayload, ...overrides };
    if (sourcePayload.proposedRegion !== undefined) storedPayload.proposedRegion = sourcePayload.proposedRegion;
    let wordId: string | null = null; let regionResolution: Json | null = null; let dialectResolution: Json | null = null;
    if (status === 'approved') {
      const publication = await payloadForPublication(sourcePayload, overrides, client);
      regionResolution = publication.regionResolution;
      dialectResolution = publication.dialectResolution;
      const published = publication.payload;
      storedPayload.regionId = published.regionId;
      for (const field of ['districtId', 'villageId', 'neighborhood'] as const) {
        if (published[field]) storedPayload[field] = published[field];
        else delete storedPayload[field];
      }
      const createdWord = await client.query(`INSERT INTO words (word, literary_form, meaning, example, category, phonetic_key, status, region_id, district_id, village_id, dialect_id, clan, dialect_score, source_request_id) VALUES ($1,$2,$3,$4,$5,$6,'published',$7,$8,$9,$10,$11,$12,$13) RETURNING id`, [published.word, published.literaryForm ?? null, published.meaning, published.example ?? null, published.category ?? null, phoneticKey(String(published.word)), published.regionId ?? null, published.districtId ?? null, published.villageId ?? null, published.dialectId ?? null, published.clan ?? null, previous.validation_score, id]);
      wordId = createdWord.rows[0].id;
    }
    // Parametr turlari nozik — izohi `sql.ts` da.
    await client.query(UPDATE_REQUEST_RESOLUTION, [id, status, jsonb(storedPayload), reason || null, claims.sub, wordId]);
    if (bool(body.applyToAudio)) {
      // So'z bo'yicha aniqlashtirish so'ralganda audio baholanmagan bo'lib
      // qoladi: aks holda u navbatdan tushib ketadi va qayta ko'rilmaydi.
      const audioStatus = audioStatusForRequestDecision(status);
      const applied = await client.query<{ id: string }>('UPDATE audio_submissions SET moderation_status=$2::moderation_status WHERE contribution_request_id=$1 RETURNING id', [id, audioStatus]);
      for (const audioRow of applied.rows) {
        if (isRecordableDecision(audioStatus)) {
          await client.query('INSERT INTO moderation_decisions (audio_submission_id, moderator_id, decision, reason) VALUES ($1,$2,$3::moderation_status,$4)', [audioRow.id, claims.sub, audioStatus, reason || null]);
        }
        await audit(claims, 'audio.decision', 'audio_submission', audioRow.id, reason || null, { moderationStatus: audioStatus, source: 'request_decision', contributionRequestId: id }, request, client);
      }
    }
    await client.query('INSERT INTO moderation_decisions (contribution_request_id, moderator_id, decision, reason, automated_verdict, automated_score) VALUES ($1,$2,$3,$4,$5,$6)', [id,claims.sub,status,reason || null,previous.validation_verdict,previous.validation_score]);
    const auditLogId = await audit(claims, 'request.status_change', 'contribution_request', id, reason || null, { status, wordId, regionResolution, dialectResolution }, request, client);
    await client.query('COMMIT');
    const updated = await db.query(`${requestSql} WHERE cr.id=$1`, [id]);
    return { request: await mapRequest(updated.rows[0]), createdWordId: wordId, auditLogId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return failFromError(reply, error, 'request.status_change');
  } finally {
    client.release();
  }
});

app.patch('/v3/words/:id', async (request, reply) => {
  const claims = await requirePermission(request, reply, 'words:write'); if (!claims) return;
  const id = asString((request.params as Json).id); const body = asObject(request.body); const reason = asString(body.changeReason);
  if (!reason) return apiError(reply, 422, 'validation_failed', 'O‘zgarish sababi majburiy.');
  const current = await db.query('SELECT * FROM words WHERE id=$1', [id]); if (!current.rows[0]) return apiError(reply, 404, 'not_found', 'So‘z topilmadi.');
  const previous = current.rows[0]; const word = asString(body.word) || previous.word;
  const updated = await db.query(`UPDATE words SET word=$2, literary_form=COALESCE($3,literary_form), meaning=$4, example=COALESCE($5,example), category=COALESCE($6,category), region_id=COALESCE($7,region_id), district_id=COALESCE($8,district_id), village_id=COALESCE($9,village_id), dialect_id=COALESCE($10,dialect_id), clan=COALESCE($11,clan), status=COALESCE($12,status), phonetic_key=$13 WHERE id=$1 RETURNING *`, [id, word, body.literaryForm ?? null, asString(body.meaning) || previous.meaning, body.example ?? null, body.category ?? null, body.regionId ?? null, body.districtId ?? null, body.villageId ?? null, body.dialectId ?? null, body.clan ?? null, body.status ?? null, phoneticKey(word)]);
  await audit(claims, 'word.update', 'word', id, reason, { word, meaning: updated.rows[0].meaning }, request);
  return { word: mapWord(updated.rows[0]), auditLogId: newId() };
});

app.delete('/v3/words/:id', async (request, reply) => {
  const claims = await requirePermission(request, reply, 'words:archive'); if (!claims) return;
  const id = asString((request.params as Json).id); const body = asObject(request.body); const reason = asString(body.reason);
  if (!reason) return apiError(reply, 422, 'validation_failed', 'Arxivlash sababi majburiy.');
  const current = await db.query('SELECT id FROM words WHERE id=$1', [id]); if (!current.rows[0]) return apiError(reply, 404, 'not_found', 'So‘z topilmadi.');
  const hardDelete = bool(body.hardDelete);
  if (hardDelete && !claims.roles.includes('admin')) return apiError(reply, 403, 'forbidden', 'Butunlay o‘chirish faqat administrator uchun.');
  if (hardDelete) await db.query('DELETE FROM words WHERE id=$1', [id]); else await db.query(`UPDATE words SET status='archived', archived_at=now(), archive_reason=$2 WHERE id=$1`, [id, reason]);
  await audit(claims, hardDelete ? 'word.delete' : 'word.archive', 'word', id, reason, { hardDelete }, request);
  return { id, status: hardDelete ? 'archived' : 'archived', archivedAt: new Date().toISOString(), auditLogId: newId() };
});

app.put('/v3/admin/geofences/:id', async (request, reply) => {
  const claims = await requirePermission(request, reply, 'geofences:write'); if (!claims) return;
  const id = asString((request.params as Json).id); const body = asObject(request.body); const reason = asString(body.changeReason);
  if (!reason) return apiError(reply, 422, 'validation_failed', 'Chegara o‘zgarishi sababi majburiy.');
  const current = await db.query('SELECT * FROM geofences WHERE id=$1', [id]); if (!current.rows[0]) return apiError(reply, 404, 'not_found', 'Chegara topilmadi.');
  const previous = current.rows[0]; if (Number(body.expectedVersion) !== Number(previous.version)) return apiError(reply, 409, 'conflict', 'Chegara boshqa administrator tomonidan yangilangan.');
  const nextArea = body.area ?? previous.area_geojson; const nextPolicy = { ...previous.policy, ...asObject(body.policy) }; const nextVersion = Number(previous.version) + 1;
  const updated = await db.query(`UPDATE geofences SET name=COALESCE($2,name), area_geojson=$3, policy=$4, is_active=COALESCE($5,is_active), note=COALESCE($6,note), version=$7, updated_by=$8 WHERE id=$1 RETURNING *`, [id, body.name ?? null, nextArea, nextPolicy, typeof body.isActive === 'boolean' ? body.isActive : null, body.note ?? null, nextVersion, claims.sub]);
  await db.query('INSERT INTO geofence_versions (geofence_id,version,area_geojson,policy,changed_by,change_reason) VALUES ($1,$2,$3,$4,$5,$6)', [id,nextVersion,nextArea,nextPolicy,claims.sub,reason]);
  await audit(claims, 'geofence.update', 'geofence', id, reason, { version: nextVersion }, request);
  return { geofence: mapFence(updated.rows[0]) };
});

app.get('/v3/admin/audit-logs', async (request, reply) => {
  if (!(await requirePermission(request, reply, 'audit:read'))) return;
  const query = request.query as Json; const params: unknown[] = []; const where: string[] = [];
  if (query.entityType) { params.push(query.entityType); where.push(`entity_type=$${params.length}`); }
  if (query.action) { params.push(query.action); where.push(`action=$${params.length}`); }
  if (query.search) { params.push(`%${asString(query.search)}%`); where.push(`(actor_name ILIKE $${params.length} OR action ILIKE $${params.length} OR reason ILIKE $${params.length})`); }
  const current=page(query.page); const size=pageSize(query.pageSize); const count=await db.query(`SELECT count(*)::int AS total FROM audit_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,params); params.push(size,(current-1)*size);
  const rows=await db.query(`SELECT * FROM audit_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,params); const total=count.rows[0].total;
  return { items: rows.rows.map((row) => ({ id:String(row.id), action:row.action, entityType:row.entity_type, entityId:row.entity_id, actorId:row.actor_id, actorName:row.actor_name, actorRoles:row.actor_roles ?? [], ipAddress:row.ip_address, userAgent:row.user_agent, before:row.before_data, after:row.after_data, changedFields:row.changed_fields ?? [], reason:row.reason, createdAt:iso(row.created_at) })), meta:{ page:current,pageSize:size,total,totalPages:Math.ceil(total/size) } };
});

/**
 * Joylashuv endi majburiy emas, shuning uchun `not_provided` — odatiy holat,
 * shubha emas. «Belgilangan» deb faqat server geofence bo'yicha muammo
 * aniqlagan holatlar sanaladi.
 */
const FLAGGED_LOCATION_SQL = `submission_location_status NOT IN ('inside', 'not_provided')`;

app.get('/v3/admin/dashboard', async (request, reply) => {
  if (!(await requirePermission(request, reply, 'dashboard:read'))) return;
  const [counts, regions, queue, audio, words, trend] = await Promise.all([
    db.query(`SELECT
        count(*) FILTER (WHERE status='pending')::int AS pending,
        count(*) FILTER (WHERE status='approved' AND resolved_at::date=current_date)::int AS approved_today,
        count(*) FILTER (WHERE status='rejected' AND resolved_at::date=current_date)::int AS rejected_today,
        count(*) FILTER (WHERE status='needs_clarification')::int AS clarification,
        count(*) FILTER (WHERE ${FLAGGED_LOCATION_SQL})::int AS flagged_location
      FROM contribution_requests`),
    db.query('SELECT * FROM v_region_stats ORDER BY word_count DESC LIMIT 12'),
    db.query(`${requestSql} WHERE cr.status IN ('pending','needs_clarification') ORDER BY cr.created_at DESC LIMIT 5`),
    db.query(`SELECT
        count(*) FILTER (WHERE moderation_status='pending' AND superseded_at IS NULL)::int AS queue,
        count(*) FILTER (WHERE analysis_status='pending_analysis' AND superseded_at IS NULL)::int AS pending,
        count(*) FILTER (WHERE superseded_at IS NULL)::int AS total
      FROM audio_submissions`),
    db.query(`SELECT count(*)::int AS n FROM words WHERE status='published'`),
    // Oxirgi 14 kun. Bo'sh kunlar ham nol bilan qaytadi, aks holda grafik
    // uzilib ko'rinadi.
    db.query(`WITH days AS (
        SELECT generate_series(current_date - interval '13 days', current_date, interval '1 day')::date AS day
      )
      SELECT days.day,
        (SELECT count(*)::int FROM contribution_requests cr WHERE cr.created_at::date = days.day) AS submitted,
        (SELECT count(*)::int FROM contribution_requests cr WHERE cr.status='approved' AND cr.resolved_at::date = days.day) AS approved,
        (SELECT count(*)::int FROM contribution_requests cr WHERE cr.status='rejected' AND cr.resolved_at::date = days.day) AS rejected
      FROM days ORDER BY days.day`),
  ]);
  const c = counts.rows[0];
  const a = audio.rows[0];
  return {
    counters: {
      pendingRequests: c.pending,
      approvedToday: c.approved_today,
      rejectedToday: c.rejected_today,
      needsClarification: c.clarification,
      audioQueue: a.queue,
      audioPendingAnalysis: a.pending,
      flaggedLocation: c.flagged_location,
      totalWords: words.rows[0].n,
      totalAudio: a.total,
    },
    regionStats: regions.rows.map((row) => ({ regionId: row.region_id, regionName: row.region_name, wordCount: Number(row.word_count), audioCount: Number(row.audio_count), pendingCount: Number(row.pending_count), avgDialectScore: Number(row.avg_dialect_score) })),
    recentQueue: queue.rows.map((row) => ({ id: row.id, title: row.payload.word, subtitle: row.payload.meaning, status: row.status, score: row.validation_score, hasAudio: !!row.audio_id, flagged: !['inside', 'not_provided'].includes(String(row.submission_location_status)), createdAt: iso(row.created_at) })),
    trend: trend.rows.map((row) => ({ date: String(row.day instanceof Date ? row.day.toISOString().slice(0, 10) : row.day), submitted: Number(row.submitted), approved: Number(row.approved), rejected: Number(row.rejected) })),
    generatedAt: new Date().toISOString(),
  };
});

app.get('/v3/admin/integrations', async (request, reply) => {
  if (!(await requirePermission(request, reply, 'integrations:read'))) return;
  const rows = await db.query(INTEGRATION_SELECT);
  const currentKeyVersion = rows.rows.reduce((highest, row) => Math.max(highest, Number(row.key_version ?? 0)), 0);
  return {
    items: rows.rows.map(mapIntegration),
    encryption: { algorithm: 'AES-256-GCM', keySource: 'env_master_key' as const, currentKeyVersion: currentKeyVersion || 1 },
  };
});

app.put('/v3/admin/integrations/:provider', async (request, reply) => {
  const claims = await requirePermission(request, reply, 'integrations:write');
  if (!claims) return;
  const provider = asString((request.params as Json).provider);
  const body = asObject(request.body);
  const reason = asString(body.changeReason);
  if (!reason) return apiError(reply, 422, 'validation_failed', 'O‘zgarish sababi majburiy.');
  const secret = asString(body.secretValue);
  if (secret && secret.length > 8_192) return apiError(reply, 422, 'validation_failed', 'Kalit qiymati juda uzun.');

  const client: PoolClient = await db.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM integration_secrets WHERE provider=$1 FOR UPDATE', [provider]);
    const previous = existing.rows[0];
    if (!previous) throw new RouteFault(404, 'not_found', 'Integratsiya topilmadi.');

    const encrypted = secret ? encryptSecret(secret) : null;
    if (encrypted && previous.secret_ciphertext && previous.key_version) {
      // Rotatsiya: eski shifrmatn yo'qolmaydi, tarixga ko'chadi.
      // Ilgari bu qadam umuman yo'q edi va eski kalit qaytarib bo'lmas
      // tarzda ustiga yozilardi.
      await client.query(
        `INSERT INTO integration_secret_versions (provider, key_version, secret_ciphertext, secret_nonce, wrapped_dek, masked_hint, retired_by)
         VALUES ($1,$2,$3,$4,COALESCE($5,'server-master'::bytea),$6,$7)
         ON CONFLICT (provider, key_version) DO NOTHING`,
        [provider, previous.key_version, previous.secret_ciphertext, previous.secret_nonce, previous.wrapped_dek, previous.masked_hint, claims.sub],
      );
    }

    const updated = await client.query(
      `UPDATE integration_secrets SET
         secret_ciphertext = COALESCE($2, secret_ciphertext),
         secret_nonce = COALESCE($3, secret_nonce),
         wrapped_dek = CASE WHEN $2::bytea IS NULL THEN wrapped_dek ELSE 'server-master'::bytea END,
         key_version = CASE WHEN $2::bytea IS NULL THEN key_version ELSE COALESCE(key_version, 0) + 1 END,
         masked_hint = COALESCE($4, masked_hint),
         secret_fingerprint = COALESCE($5, secret_fingerprint),
         public_config = COALESCE($6, public_config),
         is_enabled = COALESCE($7, is_enabled),
         health = CASE WHEN $2::bytea IS NOT NULL THEN 'unknown'::integration_health
                       WHEN COALESCE($7, is_enabled) THEN health
                       ELSE 'not_configured'::integration_health END,
         health_checked_at = CASE WHEN $2::bytea IS NULL THEN health_checked_at ELSE NULL END,
         last_rotated_at = CASE WHEN $2::bytea IS NULL THEN last_rotated_at ELSE now() END,
         last_rotated_by = CASE WHEN $2::bytea IS NULL THEN last_rotated_by ELSE $8 END
       WHERE provider=$1`,
      [provider, encrypted?.ciphertext ?? null, encrypted?.nonce ?? null, encrypted?.maskedHint ?? null, encrypted?.fingerprint ?? null, body.publicConfig ?? null, typeof body.isEnabled === 'boolean' ? body.isEnabled : null, claims.sub],
    );
    if (!updated.rowCount) throw new RouteFault(404, 'not_found', 'Integratsiya topilmadi.');

    // Auditda kalit qiymati emas, faqat uning izi qoladi.
    const auditLogId = await audit(claims, encrypted ? 'integration.rotate' : 'integration.update', 'integration_secret', provider, reason, {
      provider,
      secretValue: encrypted ? '***' : undefined,
      maskedHint: encrypted?.maskedHint ?? previous.masked_hint ?? null,
      isEnabled: typeof body.isEnabled === 'boolean' ? body.isEnabled : previous.is_enabled,
    }, request, client);
    await client.query('COMMIT');

    const view = await db.query(`${INTEGRATION_SELECT} WHERE s.provider=$1`, [provider]);
    return { integration: mapIntegration(view.rows[0]), auditLogId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return failFromError(reply, error, 'integration.update');
  } finally {
    client.release();
  }
});

/**
 * Saqlangan kalit haqiqatan ishlayotganini tekshiradi. Loyiha egasi kalitni
 * kiritgach, uni sinash uchun boshqa yo'l yo'q edi: panel doim `unknown`
 * ko'rsatardi. Kalit qiymati bu yerda ham hech qayerga chiqmaydi.
 */
app.post('/v3/admin/integrations/:provider/health-check', async (request, reply) => {
  const claims = await requirePermission(request, reply, 'integrations:write');
  if (!claims) return;
  const provider = asString((request.params as Json).provider);
  const existing = await db.query('SELECT provider, is_enabled, secret_ciphertext FROM integration_secrets WHERE provider=$1', [provider]);
  if (!existing.rows[0]) return apiError(reply, 404, 'not_found', 'Integratsiya topilmadi.');

  const outcome = await checkIntegrationHealth(provider, Boolean(existing.rows[0].secret_ciphertext), Boolean(existing.rows[0].is_enabled));
  await db.query('UPDATE integration_secrets SET health=$2::integration_health, health_checked_at=now() WHERE provider=$1', [provider, outcome.health]);
  await audit(claims, 'integration.update', 'integration_secret', provider, 'Ulanish tekshirildi', { provider, health: outcome.health }, request);
  const view = await db.query(`${INTEGRATION_SELECT} WHERE s.provider=$1`, [provider]);
  return {
    integration: mapIntegration(view.rows[0]),
    health: outcome.health,
    message: outcome.message,
    checkedAt: new Date().toISOString(),
  };
});

app.post('/v3/telemetry/app-opens', async (request, reply) => { const body=asObject(request.body); if (!asString(body.installationId)||!asString(body.appVersion)||!asString(body.openedAt)) return apiError(reply,422,'validation_failed','Hodisa ma’lumoti to‘liq emas.'); await db.query('INSERT INTO app_open_events (installation_id,app_version,location_consent,classification,region_id,opened_at) VALUES ($1,$2,$3,$4,$5,$6)',[body.installationId,body.appVersion,bool(body.locationConsent),body.classification ?? 'unknown',body.regionId ?? null,body.openedAt]); return reply.status(202).send({ accepted:true }); });

app.get('/v3/audio/:id', async (request, reply) => {
  const audioId = asString((request.params as Json).id);
  if (!isUuid(audioId)) return apiError(reply, 404, 'not_found', 'Audio topilmadi.');
  const bearerClaims = await claimsFor(request, 'audio:read');
  let hasPlaybackToken = false;
  const playbackToken = asString((request.query as Json).token);
  if (playbackToken) {
    try {
      await verifyAudioPlaybackToken(playbackToken, audioId);
      hasPlaybackToken = true;
    } catch {
      hasPlaybackToken = false;
    }
  }
  if (!bearerClaims && !hasPlaybackToken) {
    const credentialsProvided = Boolean(request.headers.authorization || playbackToken);
    return apiError(
      reply,
      credentialsProvided ? 403 : 401,
      credentialsProvided ? 'forbidden' : 'unauthorized',
      credentialsProvided ? 'Audio havolasi yaroqsiz yoki muddati tugagan.' : 'Audio tinglash uchun ruxsat kerak.',
    );
  }

  const row = (await db.query('SELECT * FROM audio_submissions WHERE id=$1', [audioId])).rows[0];
  if (!row) return apiError(reply, 404, 'not_found', 'Audio topilmadi.');
  // Supabase obyektlari `createPlaybackAccess` bergan native 5 daqiqalik
  // storage URL orqali tinglanadi; bu endpoint faqat private local diskdir.
  if (row.storage_bucket !== 'local') return apiError(reply, 409, 'storage_mismatch', 'Bu audio uchun storage havolasidan foydalaning.');

  const uploadRoot = resolve(config.uploadDir);
  const audioPath = resolve(uploadRoot, String(row.storage_key));
  if (audioPath !== uploadRoot && !audioPath.startsWith(`${uploadRoot}${sep}`)) {
    app.log.error({ audioId }, 'Audio storage key upload papkasidan tashqariga chiqdi');
    return apiError(reply, 404, 'not_found', 'Audio fayl topilmadi.');
  }

  try {
    const audio = await readFile(audioPath);
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Cache-Control', 'private, max-age=300');
    const range = request.headers.range;
    if (!range) {
      return reply.type(String(row.mime_type)).header('Content-Length', String(audio.length)).send(audio);
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start: number;
    let end: number;
    if (!match || (!match[1] && !match[2])) {
      return reply.status(416).header('Content-Range', `bytes */${audio.length}`).send();
    }
    if (!match[1]) {
      const suffixLength = Number(match[2]);
      if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
        return reply.status(416).header('Content-Range', `bytes */${audio.length}`).send();
      }
      start = Math.max(0, audio.length - suffixLength);
      end = audio.length - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : audio.length - 1;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= audio.length || end < start) {
      return reply.status(416).header('Content-Range', `bytes */${audio.length}`).send();
    }
    end = Math.min(end, audio.length - 1);
    const chunk = audio.subarray(start, end + 1);
    return reply
      .status(206)
      .type(String(row.mime_type))
      .header('Content-Range', `bytes ${start}-${end}/${audio.length}`)
      .header('Content-Length', String(chunk.length))
      .send(chunk);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return apiError(reply, 404, 'not_found', 'Audio fayl topilmadi.');
    throw error;
  }
});

app.setErrorHandler((error, request, reply) => {
  if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
    return apiError(reply, 413, 'payload_too_large', 'Audio 8 MB dan oshmasligi kerak.');
  }
  return failFromError(reply, error, `unhandled:${request.method} ${request.routeOptions?.url ?? request.url}`);
});

async function startServer() {
  await pluginsReady;
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

void startServer().catch((error: unknown) => {
  app.log.error(error, 'Server ishga tushmadi');
  process.exitCode = 1;
});
