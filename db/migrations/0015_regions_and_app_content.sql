-- =====================================================================
-- Migratsiya: 0015_regions_and_app_content
--
-- Uch mustaqil, lekin bitta relizga tegishli o'zgarish:
--
--   1. Hudud katalogini kengaytirish — respublika/davlat darajasidagi
--      yozuvlar (Turkmaniston, Qoraqalpog'iston, Afg'oniston) va
--      hududning eski (tarixiy) nomi uchun ustun. Mavjud Xorazm
--      ma'lumoti va uning `is_contribution_allowed` holati tegilmaydi.
--
--   2. «Ilova haqida / Biz haqimizda» matni va havolalarini admin
--      boshqaradigan qilish.
--
--   3. Yangi `content:*` ruxsatlarini rollarga qo'shish.
--
-- Migratsiya faqat qo'shadi: birorta ustun ham, yozuv ham o'chirilmaydi.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Hudud katalogi
-- ---------------------------------------------------------------------

-- Eski nom faqat ma'lumot uchun: FK ham, unikal indeks ham bunga
-- tayanmaydi, shuning uchun uni keyin bemalol tozalash mumkin.
ALTER TABLE regions ADD COLUMN IF NOT EXISTS former_name text;

COMMENT ON COLUMN regions.former_name IS
  'Hududning eski/tarixiy nomi (masalan jamoa xo''jaligi nomi). Faqat ko''rsatish uchun.';

-- Respublika/davlat darajasidagi hududlar. Hammasi YOPIQ holatda
-- yaratiladi: hissa qabulini faqat loyiha egasi admin paneldan yoqadi.
-- Bu O'zbekiston (`uz`) va Xorazm yozuvlariga tegmaydi.
INSERT INTO regions (id, code, name_uz, level, is_contribution_allowed, sort_order) VALUES
  ('00000000-0000-4000-8000-000000000010', 'turkmaniston',    'Turkmaniston',      'republic', false, 10),
  ('00000000-0000-4000-8000-000000000011', 'qoraqalpogiston', 'Qoraqalpog‘iston',  'republic', false, 11),
  ('00000000-0000-4000-8000-000000000012', 'afgoniston',      'Afg‘oniston',       'republic', false, 12)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Ilova matni
-- ---------------------------------------------------------------------

-- Bitta qatorli jadval: sahifa bitta va u har doim mavjud bo'lishi kerak.
-- `key` ustuni kelajakda ikkinchi sahifa qo'shilsa migratsiyasiz
-- kengaytirish imkonini beradi, lekin hozir faqat `about` ishlatiladi.
CREATE TABLE IF NOT EXISTS app_content (
  key         text PRIMARY KEY,
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  body        text NOT NULL CHECK (char_length(body) <= 4000),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL
);

-- Audit yozuvi uchun yangi obyekt turi. Qiymat shu tranzaksiyada
-- ISHLATILMAYDI — PostgreSQL buni taqiqlaydi; u keyingi so'rovlardan
-- boshlab mavjud bo'ladi.
ALTER TYPE audit_entity_type ADD VALUE IF NOT EXISTS 'app_content';

DO $$ BEGIN
  CREATE TYPE app_content_link_kind AS ENUM (
    'telegram_channel', 'telegram_group', 'phone', 'website', 'instagram', 'link'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS app_content_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_key text NOT NULL REFERENCES app_content(key) ON DELETE CASCADE,
  kind        app_content_link_kind NOT NULL,
  label       text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 80),
  -- Admin kiritgan xom qiymat (`@kanal`, `+998…`, `https://…`).
  value       text NOT NULL CHECK (char_length(btrim(value)) BETWEEN 1 AND 300),
  -- Serverda hisoblangan, ochishga tayyor manzil. Faqat `https:` va
  -- `tel:` saqlanadi: boshqa sxema ilovaga hech qachon yetib bormaydi.
  url         text NOT NULL CHECK (url ~* '^(https://|tel:)'),
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_content_links_order_idx
  ON app_content_links(content_key, sort_order, created_at);

DROP TRIGGER IF EXISTS app_content_links_set_updated_at ON app_content_links;
CREATE TRIGGER app_content_links_set_updated_at BEFORE UPDATE ON app_content_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Boshlang'ich matn — ilovada hozir qattiq yozilgan matn bilan bir xil,
-- shuning uchun deploydan keyin sahifa o'zgarmaydi.
INSERT INTO app_content (key, title, body) VALUES (
  'about',
  'Til — meros.',
  'Xorazm Shevalari Xorazmning tirik lug‘atini saqlash, o‘rganish va avlodlarga yetkazish uchun yaratilgan.'
) ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. Ruxsatlar
-- ---------------------------------------------------------------------
-- `packages/shared` dagi ROLE_PERMISSIONS bilan bir xil bo'lishi shart.
UPDATE roles
   SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['content:read', 'content:write']))
 WHERE code = 'admin';

UPDATE roles
   SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['content:read']))
 WHERE code IN ('moderator', 'editor');

COMMIT;
