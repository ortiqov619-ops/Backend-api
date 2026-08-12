import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import bcrypt from 'bcryptjs';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { Pool, type QueryResultRow } from 'pg';
import { evaluateLocationGate, phoneticKey, validateContributionText } from '@xorazm/shared';
import { assertProductionConfig, config } from './config';
import { decryptSecret, encryptSecret, hashToken, newId, signAccessToken, verifyAccessToken } from './security';

assertProductionConfig();
const db = new Pool({ connectionString: config.databaseUrl, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 });

// `tsx` executes this entrypoint as CommonJS in the production Docker image.
// Keep plugin setup in a promise so the file has no top-level `await`.
const pluginsReady = Promise.all([
  app.register(cors, { origin: (origin, callback) => callback(null, !origin || config.corsOrigins.includes(origin)) }),
  app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } }),
]);

type Json = Record<string, unknown>;
type Claims = { sub: string; roles: string[]; permissions: string[] };

function iso(value: unknown): string | null { return value ? new Date(String(value)).toISOString() : null; }
function requiredIso(value: unknown): string { return new Date(String(value)).toISOString(); }
function page(input: unknown, fallback = 1): number { const value = Number(input ?? fallback); return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback; }
function pageSize(input: unknown): number { return Math.min(100, Math.max(1, page(input, 20))); }
function apiError(reply: FastifyReply, status: number, code: string, message: string, fields?: Record<string, string[]>) {
  return reply.status(status).send({ error: { code, message, ...(fields ? { fields } : {}), requestId: newId() } });
}
function asObject(value: unknown): Json { return typeof value === 'object' && value !== null ? value as Json : {}; }
function asString(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function bool(value: unknown): boolean { return value === true || value === 'true'; }
function multipartFieldValue(field: unknown): string {
  const candidate = Array.isArray(field) ? field[0] : field;
  return typeof candidate === 'object' && candidate !== null && 'value' in candidate
    ? String((candidate as { value: unknown }).value ?? '')
    : '';
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
async function audit(actor: Claims | null, action: string, entityType: string, entityId: string | null, reason: string | null, after: Json | null, request: FastifyRequest) {
  const actorName = actor ? (await db.query<{ full_name: string }>('SELECT full_name FROM users WHERE id = $1', [actor.sub])).rows[0]?.full_name ?? 'Administrator' : 'Tizim';
  const auditLogId = newId();
  await db.query(
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

async function mapRequest(row: QueryResultRow) {
  const audio = row.audio_id ? {
    id: row.audio_id, contributionRequestId: row.id, storageKey: row.storage_key, mimeType: row.mime_type, durationMs: row.duration_ms,
    sizeBytes: row.size_bytes, checksumSha256: row.checksum_sha256, expectedText: row.expected_text,
    analysis: { status: row.analysis_status, stage: row.pipeline_stage, transcript: row.transcript, transcriptConfidence: row.transcript_confidence, detectedLanguage: row.detected_language, dialectConfidence: row.dialect_confidence, pronunciationSimilarity: row.pronunciation_similarity, textAudioMatch: row.text_audio_match, overallScore: row.overall_score, reasons: row.analysis_reasons ?? [], requiresHumanReview: row.audio_requires_review, analyzedAt: iso(row.analyzed_at) },
    moderationStatus: row.audio_moderation_status, createdAt: iso(row.audio_created_at), updatedAt: iso(row.audio_updated_at),
  } : null;
  return { id: row.id, type: row.type, status: row.status, payload: row.payload, submittedByUserId: row.submitted_by_user_id, submittedByDisplayName: row.submitted_by_display_name, device: row.device, latitude: row.latitude, longitude: row.longitude, locationAccuracyM: row.location_accuracy_m, locationCheckedAt: iso(row.location_checked_at), submissionLocationStatus: row.submission_location_status, matchedGeofenceId: row.matched_geofence_id, geofenceVersion: row.geofence_version, validationVerdict: row.validation_verdict, validationScore: row.validation_score, validationResults: row.validation_results ?? [], audio, clarificationNote: row.clarification_note, resolvedAt: iso(row.resolved_at), resolvedByUserId: row.resolved_by_user_id, resultWordId: row.result_word_id, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}
const requestSql = `SELECT cr.*, a.id AS audio_id, a.storage_key, a.mime_type, a.duration_ms, a.size_bytes, a.checksum_sha256, a.expected_text, a.analysis_status, a.pipeline_stage, a.transcript, a.transcript_confidence, a.detected_language, a.dialect_confidence, a.pronunciation_similarity, a.text_audio_match, a.overall_score, a.analysis_reasons, a.requires_human_review AS audio_requires_review, a.moderation_status AS audio_moderation_status, a.analyzed_at, a.created_at AS audio_created_at, a.updated_at AS audio_updated_at,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('subject', vr.subject, 'verdict', vr.verdict, 'score', vr.score, 'confidence', vr.confidence, 'reasons', vr.reasons, 'origin', vr.origin, 'evaluatedAt', vr.evaluated_at)) FROM validation_results vr WHERE vr.contribution_request_id = cr.id), '[]'::jsonb) AS validation_results
FROM contribution_requests cr LEFT JOIN audio_submissions a ON a.contribution_request_id = cr.id`;

async function loadIntegrationSecret(provider: string): Promise<string | null> {
  const result = await db.query<{ secret_ciphertext: Buffer | null; secret_nonce: Buffer | null }>('SELECT secret_ciphertext, secret_nonce FROM integration_secrets WHERE provider = $1 AND is_enabled = true', [provider]);
  const row = result.rows[0];
  return row?.secret_ciphertext && row.secret_nonce ? decryptSecret(row.secret_ciphertext, row.secret_nonce) : null;
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
  if (!user || !user.is_active || locked || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
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
  const body = asObject(request.body); const payload = asObject(body.payload); const location = asObject(body.location); const device = asObject(body.device); const key = asString(body.idempotencyKey);
  if (!asString(payload.word) || !asString(payload.meaning) || !key) return apiError(reply, 422, 'validation_failed', 'So‘z, ma’no va idempotency kaliti majburiy.');
  const existing = await db.query(`${requestSql} WHERE cr.idempotency_key=$1`, [key]); if (existing.rows[0]) return { request: await mapRequest(existing.rows[0]), userMessage: 'Avvalgi so‘rov qaytarildi.' };
  const geofences = await activeFences(); const gate = evaluateLocationGate({ sample: location as never, permission: 'granted', geofences });
  if (!gate.allowed) return apiError(reply, 422, gate.status === 'outside' ? 'location_outside_geofence' : gate.status === 'low_accuracy' ? 'location_low_accuracy' : 'location_stale', gate.message);
  const duplicates = await db.query('SELECT id, word, phonetic_key FROM words WHERE status <> \'archived\'');
  const validation = validateContributionText({ payload: payload as never, locationGate: gate, duplicateCandidates: duplicates.rows.map((row) => ({ id: row.id, word: row.word, phoneticKey: row.phonetic_key })), origin: 'server' });
  if (validation.verdict === 'rejected') return apiError(reply, 422, 'validation_failed', 'So‘z avtomatik tekshiruvdan o‘tmadi.');
  const created = await db.query(`INSERT INTO contribution_requests (payload, device, idempotency_key, latitude, longitude, location_accuracy_m, location_checked_at, submission_location_status, matched_geofence_id, geofence_version, distance_to_boundary_m, is_location_mocked, validation_verdict, validation_score, requires_human_review)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`, [payload, device, key, location.latitude, location.longitude, location.accuracy, location.capturedAt, gate.status, gate.matchedGeofenceId ?? null, geofences.find((f) => f.id === gate.matchedGeofenceId)?.version ?? null, gate.distanceToBoundaryM ?? null, location.isMocked ?? null, validation.verdict, validation.score, validation.verdict !== 'accepted_for_review' || gate.requiresReview]);
  const requestId = created.rows[0].id;
  await db.query('INSERT INTO validation_results (contribution_request_id, subject, verdict, score, confidence, reasons, engine_kind, engine_name, engine_version, origin, geofence_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [requestId, validation.subject, validation.verdict, validation.score, validation.confidence, validation.reasons, validation.engine.kind, validation.engine.name, validation.engine.version, validation.origin, geofences.find((f) => f.id === gate.matchedGeofenceId)?.version ?? null]);
  const record = await db.query(`${requestSql} WHERE cr.id=$1`, [requestId]); return { request: await mapRequest(record.rows[0]), userMessage: 'So‘zingiz moderatorlar tekshiruviga yuborildi.' };
});

app.post('/v3/audio/transcriptions', async (request, reply) => {
  const file = await request.file(); if (!file) return apiError(reply, 422, 'validation_failed', 'Audio fayl topilmadi.');
  const buffer = await file.toBuffer();
  const locationText = multipartFieldValue(file.fields.location);
  let location: Json = {}; try { location = JSON.parse(String(locationText ?? '{}')) as Json; } catch { return apiError(reply, 422, 'validation_failed', 'Lokatsiya formati noto‘g‘ri.'); }
  const gate = evaluateLocationGate({ sample: location as never, permission: 'granted', geofences: await activeFences() });
  if (!gate.allowed) return apiError(reply, 422, 'location_outside_geofence', gate.message);
  try { const result = await transcribe(buffer, file.filename, file.mimetype); return result; } catch (error) { return apiError(reply, 503, 'provider_unavailable', error instanceof Error ? error.message : 'STT ishlamayapti.'); }
});

app.post('/v3/contributions/audio', async (request, reply) => {
  const file = await request.file(); if (!file) return apiError(reply, 422, 'validation_failed', 'Audio fayl topilmadi.');
  const buffer = await file.toBuffer();
  const metaText = multipartFieldValue(file.fields.meta); let meta: Json = {};
  try { meta = JSON.parse(String(metaText ?? '{}')) as Json; } catch { return apiError(reply, 422, 'validation_failed', 'Audio metama’lumoti noto‘g‘ri.'); }
  const gate = evaluateLocationGate({ sample: asObject(meta.location) as never, permission: 'granted', geofences: await activeFences() });
  if (!gate.allowed) return apiError(reply, 422, 'location_outside_geofence', gate.message);
  const stored = await storeAudio(buffer, file.filename, file.mimetype); const checksum = createHash('sha256').update(buffer).digest('hex');
  const created = await db.query(`INSERT INTO audio_submissions (contribution_request_id, word_id, storage_bucket, storage_key, mime_type, duration_ms, size_bytes, checksum_sha256, expected_text, moderation_status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending') RETURNING *`, [meta.contributionRequestId ?? null, meta.wordId ?? null, stored.bucket, stored.key, file.mimetype, Number(meta.durationMs), buffer.length, checksum, asString(meta.expectedText)]);
  return { submission: { id: created.rows[0].id, storageKey: stored.key, mimeType: file.mimetype, durationMs: Number(meta.durationMs), sizeBytes: buffer.length, checksumSha256: checksum, expectedText: asString(meta.expectedText), moderationStatus: 'pending' }, userMessage: 'Audio moderator tekshiruviga yuborildi.' };
});

app.get('/v3/requests', async (request, reply) => {
  if (!(await requirePermission(request, reply, 'requests:read'))) return;
  const query = request.query as Json; const params: unknown[] = []; const where: string[] = [];
  for (const [input, column] of [['status','cr.status'],['type','cr.type'],['verdict','cr.validation_verdict'],['locationStatus','cr.submission_location_status']] as const) if (query[input]) { params.push(query[input]); where.push(`${column}=$${params.length}`); }
  if (query.search) { params.push(`%${asString(query.search)}%`); where.push(`(cr.payload->>'word' ILIKE $${params.length} OR cr.payload->>'meaning' ILIKE $${params.length})`); }
  const current = page(query.page); const size = pageSize(query.pageSize); const count = await db.query(`SELECT count(*)::int AS total FROM contribution_requests cr ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`, params); params.push(size, (current - 1) * size);
  const rows = await db.query(`${requestSql} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY cr.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params); const total = count.rows[0].total;
  return { items: await Promise.all(rows.rows.map(mapRequest)), meta: { page: current, pageSize: size, total, totalPages: Math.ceil(total / size) } };
});

app.patch('/v3/requests/:id/status', async (request, reply) => {
  const claims = await requirePermission(request, reply, 'requests:moderate'); if (!claims) return;
  const body = asObject(request.body); const id = asString((request.params as Json).id); const current = await db.query(`${requestSql} WHERE cr.id=$1`, [id]); if (!current.rows[0]) return apiError(reply, 404, 'not_found', 'So‘rov topilmadi.');
  const previous = current.rows[0]; if (asString(body.expectedUpdatedAt) !== iso(previous.updated_at)) return apiError(reply, 409, 'conflict', 'So‘rov boshqa moderator tomonidan yangilangan.');
  const status = asString(body.status); const reason = asString(body.reason); if (!['approved','rejected','needs_clarification'].includes(status) || (status !== 'approved' && !reason)) return apiError(reply, 422, 'validation_failed', 'Qaror va zarur bo‘lsa sababi kiritilishi shart.');
  const payload = { ...asObject(previous.payload), ...asObject(body.overrides) }; let wordId: string | null = null;
  if (status === 'approved') { const createdWord = await db.query(`INSERT INTO words (word, literary_form, meaning, example, category, phonetic_key, status, region_id, district_id, village_id, dialect_id, clan, dialect_score, source_request_id) VALUES ($1,$2,$3,$4,$5,$6,'published',$7,$8,$9,$10,$11,$12,$13) RETURNING id`, [payload.word, payload.literaryForm ?? null, payload.meaning, payload.example ?? null, payload.category ?? null, phoneticKey(String(payload.word)), payload.regionId ?? null, payload.districtId ?? null, payload.villageId ?? null, payload.dialectId ?? null, payload.clan ?? null, previous.validation_score, id]); wordId = createdWord.rows[0].id; }
  await db.query(`UPDATE contribution_requests SET status=$2, payload=$3, clarification_note=$4, resolved_at=CASE WHEN $2='needs_clarification' THEN NULL ELSE now() END, resolved_by_user_id=CASE WHEN $2='needs_clarification' THEN NULL ELSE $5 END, result_word_id=$6 WHERE id=$1`, [id,status,payload,reason || null,claims.sub,wordId]);
  if (bool(body.applyToAudio)) await db.query('UPDATE audio_submissions SET moderation_status=$2 WHERE contribution_request_id=$1', [id,status]);
  await db.query('INSERT INTO moderation_decisions (contribution_request_id, moderator_id, decision, reason, automated_verdict, automated_score) VALUES ($1,$2,$3,$4,$5,$6)', [id,claims.sub,status,reason || null,previous.validation_verdict,previous.validation_score]);
  await audit(claims, 'request.status_change', 'contribution_request', id, reason || null, { status, wordId }, request); const updated = await db.query(`${requestSql} WHERE cr.id=$1`, [id]); return { request: await mapRequest(updated.rows[0]), createdWordId: wordId, auditLogId: newId() };
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

app.get('/v3/admin/dashboard', async (request, reply) => { if (!(await requirePermission(request, reply, 'dashboard:read'))) return; const [counts, regions, queue] = await Promise.all([db.query(`SELECT count(*) FILTER (WHERE status='pending')::int AS pending, count(*) FILTER (WHERE status='approved' AND resolved_at::date=current_date)::int AS approved_today, count(*) FILTER (WHERE status='rejected' AND resolved_at::date=current_date)::int AS rejected_today, count(*) FILTER (WHERE status='needs_clarification')::int AS clarification FROM contribution_requests`), db.query('SELECT * FROM v_region_stats ORDER BY word_count DESC LIMIT 12'), db.query(`${requestSql} WHERE cr.status IN ('pending','needs_clarification') ORDER BY cr.created_at DESC LIMIT 5`)]); const audio = await db.query(`SELECT count(*) FILTER (WHERE moderation_status='pending')::int AS queue, count(*) FILTER (WHERE analysis_status='pending_analysis')::int AS pending, count(*)::int AS total FROM audio_submissions`); const c = counts.rows[0]; const a = audio.rows[0]; return { counters: { pendingRequests:c.pending, approvedToday:c.approved_today, rejectedToday:c.rejected_today, needsClarification:c.clarification, audioQueue:a.queue, audioPendingAnalysis:a.pending, flaggedLocation:0, totalWords:(await db.query(`SELECT count(*)::int AS n FROM words WHERE status='published'`)).rows[0].n, totalAudio:a.total }, regionStats: regions.rows.map((row) => ({ regionId:row.region_id, regionName:row.region_name, wordCount:Number(row.word_count), audioCount:Number(row.audio_count), pendingCount:Number(row.pending_count), avgDialectScore:Number(row.avg_dialect_score) })), recentQueue: queue.rows.map((row) => ({ id:row.id,title:row.payload.word,subtitle:row.payload.meaning,status:row.status,score:row.validation_score,hasAudio:!!row.audio_id,flagged:row.submission_location_status!=='inside',createdAt:iso(row.created_at) })), trend: [], generatedAt:new Date().toISOString() }; });

app.get('/v3/admin/integrations', async (request, reply) => { if (!(await requirePermission(request, reply, 'integrations:read'))) return; const rows = await db.query('SELECT s.*, u.full_name AS last_rotated_by_name FROM integration_secrets s LEFT JOIN users u ON u.id=s.last_rotated_by ORDER BY s.provider'); return { items: rows.rows.map((row) => ({ provider:row.provider,displayName:row.display_name,isConfigured:!!row.secret_ciphertext,maskedHint:row.masked_hint,keyVersion:row.key_version,lastRotatedAt:iso(row.last_rotated_at),lastRotatedBy:row.last_rotated_by_name,lastUsedAt:iso(row.last_used_at),health:row.health,healthCheckedAt:iso(row.health_checked_at),publicConfig:row.public_config,isEnabled:row.is_enabled })), encryption:{ algorithm:'AES-256-GCM',keySource:'env_master_key',currentKeyVersion:1 } }; });
app.put('/v3/admin/integrations/:provider', async (request, reply) => { const claims = await requirePermission(request, reply, 'integrations:write'); if (!claims) return; const provider = asString((request.params as Json).provider); const body = asObject(request.body); const reason = asString(body.changeReason); if (!reason) return apiError(reply,422,'validation_failed','O‘zgarish sababi majburiy.'); const existing = await db.query('SELECT provider FROM integration_secrets WHERE provider=$1',[provider]); if (!existing.rows[0]) return apiError(reply,404,'not_found','Integratsiya topilmadi.'); const secret = asString(body.secretValue); const encrypted = secret ? encryptSecret(secret) : null; await db.query(`UPDATE integration_secrets SET secret_ciphertext=COALESCE($2,secret_ciphertext), secret_nonce=COALESCE($3,secret_nonce), wrapped_dek=CASE WHEN $2 IS NULL THEN wrapped_dek ELSE 'server-master'::bytea END, key_version=CASE WHEN $2 IS NULL THEN key_version ELSE 1 END, masked_hint=COALESCE($4,masked_hint), secret_fingerprint=COALESCE($5,secret_fingerprint), public_config=COALESCE($6,public_config), is_enabled=COALESCE($7,is_enabled), health=CASE WHEN COALESCE($7,is_enabled) THEN 'unknown' ELSE 'not_configured' END, last_rotated_at=CASE WHEN $2 IS NULL THEN last_rotated_at ELSE now() END, last_rotated_by=CASE WHEN $2 IS NULL THEN last_rotated_by ELSE $8 END WHERE provider=$1`, [provider,encrypted?.ciphertext ?? null,encrypted?.nonce ?? null,encrypted?.maskedHint ?? null,encrypted?.fingerprint ?? null,body.publicConfig ?? null,typeof body.isEnabled==='boolean' ? body.isEnabled : null,claims.sub]); await audit(claims,'integration.update','integration_secret',provider,reason,{ provider },request); return { integration: { provider }, auditLogId:newId() }; });

app.post('/v3/telemetry/app-opens', async (request, reply) => { const body=asObject(request.body); if (!asString(body.installationId)||!asString(body.appVersion)||!asString(body.openedAt)) return apiError(reply,422,'validation_failed','Hodisa ma’lumoti to‘liq emas.'); await db.query('INSERT INTO app_open_events (installation_id,app_version,location_consent,classification,region_id,opened_at) VALUES ($1,$2,$3,$4,$5,$6)',[body.installationId,body.appVersion,bool(body.locationConsent),body.classification ?? 'unknown',body.regionId ?? null,body.openedAt]); return reply.status(202).send({ accepted:true }); });

app.get('/v3/audio/:id', async (request, reply) => { const row=(await db.query('SELECT * FROM audio_submissions WHERE id=$1',[(request.params as Json).id])).rows[0]; if(!row) return apiError(reply,404,'not_found','Audio topilmadi.'); if(row.storage_bucket!=='local') return apiError(reply,501,'provider_unavailable','Bulut audio havolasi hali sozlanmagan.'); try { const audio=await readFile(join(config.uploadDir,row.storage_key)); return reply.type(row.mime_type).send(Readable.from(audio)); } catch { return apiError(reply,404,'not_found','Audio fayl topilmadi.'); } });

app.setErrorHandler((error, _request, reply) => { app.log.error(error); if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') return apiError(reply,413,'payload_too_large','Audio 8 MB dan oshmasligi kerak.'); return apiError(reply,500,'internal_error','Serverda kutilmagan xatolik yuz berdi.'); });

async function startServer() {
  await pluginsReady;
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

void startServer().catch((error: unknown) => {
  app.log.error(error, 'Server ishga tushmadi');
  process.exitCode = 1;
});
