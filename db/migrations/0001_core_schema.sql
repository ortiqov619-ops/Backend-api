-- =====================================================================
-- Xorazm Shevalari — V3 asosiy PostgreSQL sxemasi
-- Migratsiya: 0001_core_schema
-- Talab: PostgreSQL 14+
--
-- Bu migratsiya faqat sxema yaratadi. Deploy, hosting va real API
-- kalitlari bu bosqichda ko'rib chiqilmaydi.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- o'xshash so'zlarni topish uchun
CREATE EXTENSION IF NOT EXISTS "citext";     -- registrga befarq email

-- ---------------------------------------------------------------------
-- ENUM turlari
-- ---------------------------------------------------------------------
CREATE TYPE region_level AS ENUM ('republic', 'region', 'district', 'village', 'neighborhood');

CREATE TYPE word_status AS ENUM ('draft', 'published', 'archived');

CREATE TYPE moderation_status AS ENUM ('pending', 'approved', 'rejected', 'needs_clarification');

CREATE TYPE contribution_type AS ENUM ('word', 'audio', 'correction');

CREATE TYPE submission_location_status AS ENUM (
  'inside',
  'inside_near_boundary',
  'outside',
  'low_accuracy',
  'stale',
  'permission_denied',
  'unavailable',
  'mock_suspected',
  'not_provided',
  -- client "ichkarida" dedi, server qayta hisoblab boshqacha natija oldi
  'server_mismatch'
);

CREATE TYPE validation_verdict AS ENUM ('accepted_for_review', 'needs_manual_review', 'rejected');

CREATE TYPE validation_subject AS ENUM ('word_text', 'word_meaning', 'metadata', 'audio', 'location');

CREATE TYPE validation_origin AS ENUM ('client', 'server');

CREATE TYPE audio_analysis_status AS ENUM ('pending_analysis', 'analyzing', 'analyzed', 'failed', 'skipped');

CREATE TYPE audio_pipeline_stage AS ENUM (
  'uploaded', 'transcribing', 'dialect_detection', 'pronunciation_scoring', 'text_audio_match', 'completed'
);

CREATE TYPE integration_provider AS ENUM (
  'stt_primary', 'stt_fallback', 'dialect_model', 'pronunciation_model',
  'moderation_ai', 'object_storage', 'push_notifications'
);

CREATE TYPE integration_health AS ENUM ('unknown', 'ok', 'degraded', 'failing', 'not_configured');

CREATE TYPE audit_entity_type AS ENUM (
  'user', 'word', 'contribution_request', 'audio_submission',
  'region', 'geofence', 'dialect', 'integration_secret'
);

-- ---------------------------------------------------------------------
-- `updated_at` avtomatik yangilanishi
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 1. Foydalanuvchilar va rollar
-- =====================================================================
CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name        text        NOT NULL,
  email            citext      UNIQUE,
  phone            text        UNIQUE,
  -- argon2id/bcrypt hash. Panel foydalanuvchilarida majburiy.
  password_hash    text,
  -- TOTP siri shifrlangan holda; oddiy foydalanuvchida NULL.
  totp_secret_enc  bytea,
  is_active        boolean     NOT NULL DEFAULT true,
  -- mobil ilovadagi anonim hissa qo'shuvchilar uchun
  is_anonymous     boolean     NOT NULL DEFAULT false,
  display_name     text,
  failed_login_count integer   NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_identity_present CHECK (email IS NOT NULL OR phone IS NOT NULL OR is_anonymous)
);
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text UNIQUE NOT NULL CHECK (code IN ('admin', 'moderator', 'editor', 'user')),
  name_uz     text NOT NULL,
  description text,
  -- `packages/shared/src/contract/auth.ts` dagi Permission ro'yxati bilan bir xil
  permissions text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER roles_set_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_roles (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  granted_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_roles_role_idx ON user_roles(role_id);

-- Moderatorni ma'lum hududlarga biriktirish (bo'sh = barcha hududlar).
CREATE TABLE user_region_assignments (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  region_id uuid NOT NULL,
  PRIMARY KEY (user_id, region_id)
);

-- Refresh tokenlar faqat hash ko'rinishida saqlanadi.
CREATE TABLE admin_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  installation_id    text NOT NULL,
  platform           text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  app_version        text,
  ip_address         inet,
  user_agent         text,
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_sessions_user_idx ON admin_sessions(user_id) WHERE revoked_at IS NULL;

-- =====================================================================
-- 2. Hududlar, geofence va lahjalar
-- =====================================================================
CREATE TABLE regions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text UNIQUE NOT NULL,
  name_uz       text NOT NULL,
  name_oz       text,
  parent_id     uuid REFERENCES regions(id) ON DELETE RESTRICT,
  level         region_level NOT NULL,
  -- Shu hududdan hissa qo'shishga ruxsat berilganmi
  is_contribution_allowed boolean NOT NULL DEFAULT false,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by    uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX regions_parent_idx ON regions(parent_id);
CREATE TRIGGER regions_set_updated_at BEFORE UPDATE ON regions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE user_region_assignments
  ADD CONSTRAINT user_region_assignments_region_fk
  FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE;

CREATE TABLE geofences (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id     uuid NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  name          text NOT NULL,
  -- GeoJSON Polygon yoki MultiPolygon. Haqiqat manbai shu ustun.
  -- PostGIS mavjud bo'lsa 0003 migratsiyasi generated geometry qo'shadi.
  area_geojson  jsonb NOT NULL,
  -- {maxAccuracyM, maxSampleAgeSec, boundaryReviewBufferM, blockOnMockLocation}
  policy        jsonb NOT NULL DEFAULT
                  '{"maxAccuracyM":100,"maxSampleAgeSec":120,"boundaryReviewBufferM":1000,"blockOnMockLocation":true}'::jsonb,
  is_active     boolean NOT NULL DEFAULT true,
  -- Har tahrirda +1. validation_results shu versiyani eslab qoladi.
  version       integer NOT NULL DEFAULT 1,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT geofences_area_type CHECK (area_geojson->>'type' IN ('Polygon', 'MultiPolygon')),
  CONSTRAINT geofences_policy_shape CHECK (
    (policy->>'maxAccuracyM')::numeric BETWEEN 1 AND 5000
    AND (policy->>'maxSampleAgeSec')::numeric BETWEEN 5 AND 3600
  )
);
CREATE INDEX geofences_region_idx ON geofences(region_id) WHERE is_active;
CREATE TRIGGER geofences_set_updated_at BEFORE UPDATE ON geofences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Geofence tarixini saqlash: chegara o'zgarsa eski qaror qayta tiklanadi.
CREATE TABLE geofence_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  geofence_id  uuid NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  version      integer NOT NULL,
  area_geojson jsonb NOT NULL,
  policy       jsonb NOT NULL,
  changed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  change_reason text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (geofence_id, version)
);

CREATE TABLE dialects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text UNIQUE NOT NULL,
  name_uz      text NOT NULL,
  description  text,
  -- Matn filtri uchun belgi so'zlar
  marker_words text[] NOT NULL DEFAULT '{}',
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by   uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE TRIGGER dialects_set_updated_at BEFORE UPDATE ON dialects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dialect_regions (
  dialect_id uuid NOT NULL REFERENCES dialects(id) ON DELETE CASCADE,
  region_id  uuid NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  PRIMARY KEY (dialect_id, region_id)
);

-- =====================================================================
-- 3. Lug'at
-- =====================================================================
CREATE TABLE words (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  word           text NOT NULL,
  literary_form  text,
  meaning        text NOT NULL,
  example        text,
  category       text,
  -- packages/shared `phoneticKey()` natijasi. Dublikat va talaffuz uchun.
  phonetic_key   text NOT NULL,
  status         word_status NOT NULL DEFAULT 'draft',
  region_id      uuid REFERENCES regions(id) ON DELETE SET NULL,
  district_id    uuid REFERENCES regions(id) ON DELETE SET NULL,
  village_id     uuid REFERENCES regions(id) ON DELETE SET NULL,
  dialect_id     uuid REFERENCES dialects(id) ON DELETE SET NULL,
  clan           text,
  primary_audio_id uuid,             -- FK audio_submissions (pastda qo'shiladi)
  dialect_score  smallint CHECK (dialect_score BETWEEN 0 AND 100),
  source_request_id uuid,            -- FK contribution_requests (pastda)
  archived_at    timestamptz,
  archive_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT words_archived_consistency CHECK (
    (status = 'archived') = (archived_at IS NOT NULL)
  )
);
-- Bir hududda bir xil fonetik shakl ikki marta bo'lmasin.
CREATE UNIQUE INDEX words_unique_phonetic_per_region
  ON words(phonetic_key, COALESCE(district_id, region_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status <> 'archived';
CREATE INDEX words_search_trgm ON words USING gin (word gin_trgm_ops);
CREATE INDEX words_meaning_trgm ON words USING gin (meaning gin_trgm_ops);
CREATE INDEX words_status_idx ON words(status);
CREATE INDEX words_region_idx ON words(region_id, district_id);
CREATE INDEX words_dialect_idx ON words(dialect_id);
CREATE TRIGGER words_set_updated_at BEFORE UPDATE ON words
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE word_variants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  word_id      uuid NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  form         text NOT NULL,
  phonetic_key text NOT NULL,
  dialect_id   uuid REFERENCES dialects(id) ON DELETE SET NULL,
  region_id    uuid REFERENCES regions(id) ON DELETE SET NULL,
  audio_id     uuid,                 -- FK audio_submissions (pastda)
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (word_id, phonetic_key)
);
CREATE INDEX word_variants_word_idx ON word_variants(word_id);
CREATE TRIGGER word_variants_set_updated_at BEFORE UPDATE ON word_variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 4. Hissa qo'shish so'rovlari
-- =====================================================================
CREATE TABLE contribution_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type           contribution_type NOT NULL DEFAULT 'word',
  status         moderation_status NOT NULL DEFAULT 'pending',
  -- ContributionPayload (shared paketdagi tur bilan bir xil)
  payload        jsonb NOT NULL,

  submitted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  submitted_by_display_name text,
  device         jsonb,
  -- Takroriy yuborishni to'sish (client bergan kalit + qurilma)
  idempotency_key text NOT NULL,
  client_ip      inet,

  -- --- lokatsiya isboti ---
  latitude       double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude      double precision CHECK (longitude BETWEEN -180 AND 180),
  location_accuracy_m real CHECK (location_accuracy_m >= 0),
  -- Qurilma o'lchov olgan vaqt
  location_checked_at timestamptz,
  -- Server so'rovni qabul qilgan vaqt (soat farqini aniqlash uchun)
  location_received_at timestamptz NOT NULL DEFAULT now(),
  submission_location_status submission_location_status NOT NULL DEFAULT 'not_provided',
  matched_geofence_id uuid REFERENCES geofences(id) ON DELETE SET NULL,
  geofence_version integer,
  distance_to_boundary_m real,
  is_location_mocked boolean,

  -- --- filtr xulosasi (batafsili validation_results'da) ---
  validation_verdict validation_verdict NOT NULL DEFAULT 'needs_manual_review',
  validation_score smallint NOT NULL DEFAULT 0 CHECK (validation_score BETWEEN 0 AND 100),
  -- Avtomatik filtr moderatorga majburiy yuborishni talab qiladimi
  requires_human_review boolean NOT NULL DEFAULT true,

  clarification_note text,
  resolved_at    timestamptz,
  resolved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  result_word_id uuid REFERENCES words(id) ON DELETE SET NULL,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contribution_requests_resolved_consistency CHECK (
    (status = 'pending') OR (resolved_at IS NOT NULL) OR (status = 'needs_clarification')
  ),
  CONSTRAINT contribution_requests_coords_pair CHECK (
    (latitude IS NULL) = (longitude IS NULL)
  )
);
CREATE UNIQUE INDEX contribution_requests_idempotency
  ON contribution_requests(idempotency_key);
CREATE INDEX contribution_requests_queue_idx
  ON contribution_requests(status, created_at DESC);
CREATE INDEX contribution_requests_flagged_idx
  ON contribution_requests(submission_location_status)
  WHERE submission_location_status <> 'inside';
CREATE INDEX contribution_requests_verdict_idx ON contribution_requests(validation_verdict);
CREATE INDEX contribution_requests_device_idx ON contribution_requests((device->>'installationId'), created_at DESC);
CREATE TRIGGER contribution_requests_set_updated_at BEFORE UPDATE ON contribution_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE words
  ADD CONSTRAINT words_source_request_fk
  FOREIGN KEY (source_request_id) REFERENCES contribution_requests(id) ON DELETE SET NULL;

-- =====================================================================
-- 5. Audio
-- =====================================================================
CREATE TABLE audio_submissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_request_id uuid REFERENCES contribution_requests(id) ON DELETE CASCADE,
  word_id        uuid REFERENCES words(id) ON DELETE SET NULL,

  -- Obyekt xotirasidagi kalit. Ochiq URL hech qachon saqlanmaydi;
  -- tinglash uchun server imzolangan muddatli havola beradi.
  storage_bucket text NOT NULL,
  storage_key    text NOT NULL,
  mime_type      text NOT NULL,
  duration_ms    integer NOT NULL CHECK (duration_ms > 0),
  size_bytes     integer NOT NULL CHECK (size_bytes > 0),
  sample_rate_hz integer,
  checksum_sha256 text NOT NULL,

  expected_text  text NOT NULL,

  -- --- pipeline natijalari ---
  analysis_status audio_analysis_status NOT NULL DEFAULT 'pending_analysis',
  pipeline_stage  audio_pipeline_stage  NOT NULL DEFAULT 'uploaded',
  transcript      text,
  transcript_confidence real CHECK (transcript_confidence BETWEEN 0 AND 1),
  detected_language text,
  dialect_confidence real CHECK (dialect_confidence BETWEEN 0 AND 1),
  pronunciation_similarity smallint CHECK (pronunciation_similarity BETWEEN 0 AND 100),
  text_audio_match smallint CHECK (text_audio_match BETWEEN 0 AND 100),
  overall_score   smallint CHECK (overall_score BETWEEN 0 AND 100),
  analysis_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  requires_human_review boolean NOT NULL DEFAULT true,
  engine_name     text,
  engine_version  text,
  engine_provider text,
  analyzed_at     timestamptz,
  failure_message text,

  moderation_status moderation_status NOT NULL DEFAULT 'pending',

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_bucket, storage_key)
);
CREATE INDEX audio_submissions_queue_idx ON audio_submissions(moderation_status, created_at);
CREATE INDEX audio_submissions_pending_analysis_idx
  ON audio_submissions(analysis_status) WHERE analysis_status = 'pending_analysis';
CREATE INDEX audio_submissions_request_idx ON audio_submissions(contribution_request_id);
CREATE TRIGGER audio_submissions_set_updated_at BEFORE UPDATE ON audio_submissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE words
  ADD CONSTRAINT words_primary_audio_fk
  FOREIGN KEY (primary_audio_id) REFERENCES audio_submissions(id) ON DELETE SET NULL;
ALTER TABLE word_variants
  ADD CONSTRAINT word_variants_audio_fk
  FOREIGN KEY (audio_id) REFERENCES audio_submissions(id) ON DELETE SET NULL;

-- =====================================================================
-- 6. Validatsiya natijalari va moderator qarorlari
-- =====================================================================
CREATE TABLE validation_results (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_request_id uuid REFERENCES contribution_requests(id) ON DELETE CASCADE,
  audio_submission_id uuid REFERENCES audio_submissions(id) ON DELETE CASCADE,
  subject      validation_subject NOT NULL,
  verdict      validation_verdict NOT NULL,
  score        smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  confidence   real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  -- ValidationReason[] — kod, og'irlik, xabar, dalil
  reasons      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Qaysi qoida to'plami/model qaror chiqardi — reproduktsiya uchun
  engine_kind  text NOT NULL CHECK (engine_kind IN ('rules', 'model', 'hybrid')),
  engine_name  text NOT NULL,
  engine_version text NOT NULL,
  engine_provider text,
  -- Lokatsiya qarori qaysi geofence versiyasida chiqarilgan
  geofence_version integer,
  origin       validation_origin NOT NULL,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT validation_results_target CHECK (
    contribution_request_id IS NOT NULL OR audio_submission_id IS NOT NULL
  )
);
CREATE INDEX validation_results_request_idx ON validation_results(contribution_request_id);
CREATE INDEX validation_results_audio_idx ON validation_results(audio_submission_id);
CREATE INDEX validation_results_engine_idx ON validation_results(engine_name, engine_version);

CREATE TABLE moderation_decisions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_request_id uuid REFERENCES contribution_requests(id) ON DELETE CASCADE,
  audio_submission_id uuid REFERENCES audio_submissions(id) ON DELETE CASCADE,
  moderator_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision     moderation_status NOT NULL CHECK (decision <> 'pending'),
  reason       text,
  -- Moderator qarori avtomatik filtr xulosasidan farq qildimi
  overrode_automated_verdict boolean NOT NULL DEFAULT false,
  automated_verdict validation_verdict,
  automated_score smallint,
  decided_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderation_decisions_target CHECK (
    contribution_request_id IS NOT NULL OR audio_submission_id IS NOT NULL
  ),
  CONSTRAINT moderation_decisions_reason_required CHECK (
    decision = 'approved' OR (reason IS NOT NULL AND length(btrim(reason)) > 0)
  )
);
CREATE INDEX moderation_decisions_moderator_idx ON moderation_decisions(moderator_id, decided_at DESC);
CREATE INDEX moderation_decisions_request_idx ON moderation_decisions(contribution_request_id);

-- =====================================================================
-- 7. Audit log — har qanday admin o'zgarishi shu yerga tushadi
-- =====================================================================
CREATE TABLE audit_logs (
  id           bigserial PRIMARY KEY,
  action       text NOT NULL,
  entity_type  audit_entity_type NOT NULL,
  entity_id    text,
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_name   text NOT NULL,
  actor_roles  text[] NOT NULL DEFAULT '{}',
  -- Maskalangan IP (oxirgi oktet nolga tenglashtiriladi)
  ip_address   inet,
  user_agent   text,
  -- Maxfiy maydonlar '***' bilan almashtirilgan holda saqlanadi
  before_data  jsonb,
  after_data   jsonb,
  changed_fields text[] NOT NULL DEFAULT '{}',
  reason       text,
  request_id   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs(actor_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs(action, created_at DESC);
CREATE INDEX audit_logs_created_idx ON audit_logs(created_at DESC);

-- Audit yozuvini o'zgartirish/o'chirish taqiqlanadi (append-only).
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();

-- =====================================================================
-- 8. Integratsiya kalitlari (shifrlangan)
-- =====================================================================
-- MUHIM: `secret_ciphertext` — envelope encryption natijasi (AES-256-GCM).
-- Ochiq qiymat hech qachon saqlanmaydi va API orqali qaytarilmaydi.
-- Mobil ilova faqat `masked_hint`, `provider` va holatni ko'radi.
CREATE TABLE integration_secrets (
  provider          integration_provider PRIMARY KEY,
  display_name      text NOT NULL,
  -- AES-256-GCM shifrmatn (nonce + tag birga)
  secret_ciphertext bytea,
  secret_nonce      bytea,
  -- DEK shifrlangan holda (KMS yoki master key bilan)
  wrapped_dek       bytea,
  key_version       integer,
  -- Faqat oxirgi 4 belgi: '••••7f2a'
  masked_hint       text,
  -- Kalitni almashtirmasdan uni topish uchun (HMAC, teskari emas)
  secret_fingerprint text,
  public_config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_enabled        boolean NOT NULL DEFAULT false,
  health            integration_health NOT NULL DEFAULT 'not_configured',
  health_checked_at timestamptz,
  last_used_at      timestamptz,
  last_rotated_at   timestamptz,
  last_rotated_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_secrets_configured CHECK (
    (secret_ciphertext IS NULL) = (key_version IS NULL)
  )
);
CREATE TRIGGER integration_secrets_set_updated_at BEFORE UPDATE ON integration_secrets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Kalit tarixi (rotate qilinganda eski shifrmatn shu yerga ko'chadi).
CREATE TABLE integration_secret_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          integration_provider NOT NULL REFERENCES integration_secrets(provider) ON DELETE CASCADE,
  key_version       integer NOT NULL,
  secret_ciphertext bytea NOT NULL,
  secret_nonce      bytea NOT NULL,
  wrapped_dek       bytea NOT NULL,
  masked_hint       text,
  retired_at        timestamptz NOT NULL DEFAULT now(),
  retired_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (provider, key_version)
);

-- =====================================================================
-- 9. Yordamchi ko'rinishlar (dashboard uchun)
-- =====================================================================
CREATE VIEW v_moderation_queue AS
SELECT
  cr.id,
  cr.status,
  cr.type,
  cr.payload->>'word'    AS word,
  cr.payload->>'meaning' AS meaning,
  cr.validation_verdict,
  cr.validation_score,
  cr.submission_location_status,
  (a.id IS NOT NULL)     AS has_audio,
  a.analysis_status,
  cr.created_at
FROM contribution_requests cr
LEFT JOIN audio_submissions a ON a.contribution_request_id = cr.id
WHERE cr.status IN ('pending', 'needs_clarification');

CREATE VIEW v_region_stats AS
SELECT
  r.id   AS region_id,
  r.name_uz AS region_name,
  count(DISTINCT w.id) FILTER (WHERE w.status = 'published') AS word_count,
  count(DISTINCT a.id) AS audio_count,
  count(DISTINCT cr.id) FILTER (WHERE cr.status = 'pending') AS pending_count,
  COALESCE(round(avg(w.dialect_score)), 0) AS avg_dialect_score
FROM regions r
LEFT JOIN words w ON w.district_id = r.id OR w.region_id = r.id
LEFT JOIN audio_submissions a ON a.word_id = w.id
LEFT JOIN contribution_requests cr ON (cr.payload->>'districtId') = r.id::text
GROUP BY r.id, r.name_uz;

COMMIT;
