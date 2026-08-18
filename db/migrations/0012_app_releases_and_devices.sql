-- Ilova relizlari va qurilma ro'yxati.
--
-- Maqsad: har bir kichik tuzatishdan keyin APK'ni qo'lda qurib, qo'lda
-- yuborish o'rniga ilovaning o'zi yangi versiyani bilib olsin.
--
-- USER va ADMIN ilovalari mutlaqo alohida yo'llarda yuradi: ularning
-- versiyalari hech qachon aralashmasligi kerak, shuning uchun deyarli har
-- bir so'rov `app_type` bo'yicha filtrlanadi.

BEGIN;

DO $$ BEGIN
  CREATE TYPE app_type AS ENUM ('USER', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- iOS hozir ishlatilmaydi, lekin model uni boshidan qo'llab-quvvatlaydi:
-- keyinchalik App Store yo'li qo'shilganda sxemani o'zgartirish shart emas.
DO $$ BEGIN
  CREATE TYPE app_platform AS ENUM ('ANDROID', 'IOS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE app_update_type AS ENUM ('OPTIONAL', 'RECOMMENDED', 'REQUIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Audit yozuvi uchun yangi obyekt turi. `ALTER TYPE ... ADD VALUE` mavjud
-- qiymatlarga tegmaydi, shuning uchun eski audit yozuvlari o'z joyida qoladi.
ALTER TYPE audit_entity_type ADD VALUE IF NOT EXISTS 'app_release';

-- ---------------------------------------------------------------------------
-- Relizlar
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_releases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_type      app_type NOT NULL,
  platform      app_platform NOT NULL DEFAULT 'ANDROID',

  -- `version_name` faqat ko'rsatish uchun. Taqqoslash HAR DOIM `version_code`
  -- bo'yicha: matnli versiyalarni solishtirish ("1.10" < "1.9") xato beradi.
  version_name  text NOT NULL CHECK (char_length(btrim(version_name)) BETWEEN 1 AND 40),
  version_code  integer NOT NULL CHECK (version_code > 0),

  -- Shu qiymatdan past versiyalar bloklanadi.
  minimum_supported_version_code integer NOT NULL DEFAULT 0 CHECK (minimum_supported_version_code >= 0),
  update_type   app_update_type NOT NULL DEFAULT 'OPTIONAL',

  -- Android: backend orqali beriladigan APK. iOS: do'kon havolasi.
  download_url  text,
  -- Diskdagi fayl kaliti (faqat Android, backend saqlaganda).
  storage_key   text,
  file_size     bigint CHECK (file_size IS NULL OR file_size > 0),
  sha256        text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),

  release_notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active     boolean NOT NULL DEFAULT true,
  published_at  timestamptz NOT NULL DEFAULT now(),
  published_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  -- CI yuborganmi yoki odam qo'lda yaratganmi.
  published_via text NOT NULL DEFAULT 'ci',

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Bitta ilova+platforma uchun bitta versiya kodi bir marta. CI xuddi shu
  -- relizni ikki marta yuborsa (qayta ishga tushirilgan workflow) yangi
  -- yozuv paydo bo'lmaydi.
  CONSTRAINT app_releases_version_unique UNIQUE (app_type, platform, version_code),

  -- Android relizini o'rnatib bo'lishi uchun fayl, hajm va checksum shart.
  -- Ularsiz ilova yuklab olgan faylni tekshira olmaydi.
  CONSTRAINT app_releases_android_artifact CHECK (
    platform <> 'ANDROID' OR NOT is_active
    OR (download_url IS NOT NULL AND sha256 IS NOT NULL AND file_size IS NOT NULL)
  )
);

-- "Shu ilova uchun eng yangi faol reliz" — eng tez-tez bajariladigan so'rov.
CREATE INDEX IF NOT EXISTS app_releases_lookup_idx
  ON app_releases(app_type, platform, version_code DESC) WHERE is_active;
CREATE INDEX IF NOT EXISTS app_releases_history_idx
  ON app_releases(app_type, platform, published_at DESC);

DO $$ BEGIN
  CREATE TRIGGER app_releases_set_updated_at BEFORE UPDATE ON app_releases
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Qurilmalar
-- ---------------------------------------------------------------------------
-- Qurilma identifikatori ilovaning o'zi yaratgan tasodifiy qiymat
-- (`installation_id`). IMEI, seriya raqami yoki boshqa cheklangan apparat
-- identifikatorlari ishlatilmaydi va ular kerak ham emas.
CREATE TABLE IF NOT EXISTS app_devices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id  text NOT NULL CHECK (char_length(installation_id) BETWEEN 4 AND 160),
  app_type         app_type NOT NULL,
  platform         app_platform NOT NULL DEFAULT 'ANDROID',
  app_version_name text,
  app_version_code integer,
  fcm_token        text,
  user_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  device_model     text,
  os_version       text,
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- Bitta telefonda ikkala ilova ham bo'lishi mumkin, shuning uchun
  -- noyoblik qurilma + ilova turi bo'yicha.
  CONSTRAINT app_devices_identity UNIQUE (installation_id, app_type)
);

CREATE INDEX IF NOT EXISTS app_devices_installation_idx ON app_devices(installation_id);
CREATE INDEX IF NOT EXISTS app_devices_target_idx ON app_devices(app_type, platform);
CREATE INDEX IF NOT EXISTS app_devices_last_seen_idx ON app_devices(last_seen_at DESC);
-- Push yuborishda faqat tokeni bor qurilmalar tanlanadi.
CREATE INDEX IF NOT EXISTS app_devices_fcm_idx ON app_devices(fcm_token) WHERE fcm_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS app_devices_user_idx ON app_devices(user_id) WHERE user_id IS NOT NULL;

DO $$ BEGIN
  CREATE TRIGGER app_devices_set_updated_at BEFORE UPDATE ON app_devices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Ruxsatlar
-- ---------------------------------------------------------------------------
-- Reliz nashr qilish — xavfli amal: u barcha o'rnatilgan ilovalarga ta'sir
-- qiladi. Shuning uchun yozish huquqi faqat `admin` rolida bo'ladi;
-- moderator va muharrir ro'yxatni ko'ra oladi, lekin o'zgartira olmaydi.
UPDATE roles
   SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['releases:read', 'releases:write']))
 WHERE code = 'admin';

UPDATE roles
   SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['releases:read']))
 WHERE code IN ('moderator', 'editor');

COMMIT;
