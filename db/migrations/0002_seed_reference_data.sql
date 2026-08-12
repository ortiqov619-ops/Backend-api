-- =====================================================================
-- Migratsiya: 0002_seed_reference_data
-- Rollar, Xorazm hududlari, taxminiy geofence va lahjalar.
--
-- Geofence koordinatalari TAXMINIY. Aniq chegara admin paneldan
-- `PUT /admin/geofences/:id` orqali yuklanishi kerak.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Rollar (permissions ro'yxati shared paketdagi ROLE_PERMISSIONS bilan bir xil)
-- ---------------------------------------------------------------------
INSERT INTO roles (code, name_uz, description, permissions) VALUES
  ('admin', 'Administrator', 'To‘liq huquq: sozlamalar, kalitlar, arxivlash.', ARRAY[
    'dashboard:read','words:read','words:write','words:archive','requests:read','requests:moderate',
    'audio:read','audio:moderate','regions:read','regions:write','geofences:write','dialects:write',
    'audit:read','integrations:read','integrations:write','users:manage']),
  ('moderator', 'Moderator', 'Takliflar va audio moderatsiyasi.', ARRAY[
    'dashboard:read','words:read','requests:read','requests:moderate','audio:read','audio:moderate',
    'regions:read','audit:read']),
  ('editor', 'Muharrir', 'Lug‘atni tahrirlash, arxivlashsiz.', ARRAY[
    'dashboard:read','words:read','words:write','requests:read','regions:read']),
  ('user', 'Foydalanuvchi', 'Mobil ilova foydalanuvchisi.', ARRAY[]::text[])
ON CONFLICT (code) DO UPDATE SET permissions = EXCLUDED.permissions, name_uz = EXCLUDED.name_uz;

-- ---------------------------------------------------------------------
-- Hududlar
-- ---------------------------------------------------------------------
INSERT INTO regions (id, code, name_uz, level, is_contribution_allowed, sort_order) VALUES
  ('00000000-0000-4000-8000-000000000000', 'uz', 'O‘zbekiston', 'republic', false, 0),
  ('00000000-0000-4000-8000-000000000001', 'xorazm', 'Xorazm viloyati', 'region', true, 1)
ON CONFLICT (id) DO NOTHING;

UPDATE regions SET parent_id = '00000000-0000-4000-8000-000000000000'
  WHERE id = '00000000-0000-4000-8000-000000000001';

INSERT INTO regions (code, name_uz, parent_id, level, is_contribution_allowed, sort_order)
SELECT v.code, v.name_uz, '00000000-0000-4000-8000-000000000001', 'district', true, v.sort_order
FROM (VALUES
  ('urganch',    'Urganch tumani',     1),
  ('xiva',       'Xiva tumani',        2),
  ('bogot',      'Bog‘ot tumani',      3),
  ('gurlan',     'Gurlan tumani',      4),
  ('qoshkopir',  'Qo‘shko‘pir tumani', 5),
  ('shovot',     'Shovot tumani',      6),
  ('xonqa',      'Xonqa tumani',       7),
  ('hazorasp',   'Hazorasp tumani',    8),
  ('yangiariq',  'Yangiariq tumani',   9),
  ('yangibozor', 'Yangibozor tumani',  10),
  ('tuproqqala', 'Tuproqqal’a tumani', 11)
) AS v(code, name_uz, sort_order)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------
-- Geofence (taxminiy chegara)
-- ---------------------------------------------------------------------
INSERT INTO geofences (id, region_id, name, area_geojson, is_active, version, note) VALUES (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  'Xorazm viloyati (taxminiy)',
  '{"type":"Polygon","coordinates":[[
      [60.05,41.95],[60.32,42.18],[60.62,42.30],[61.05,42.11],[61.28,41.86],
      [61.52,41.60],[61.62,41.36],[61.50,41.11],[61.18,40.90],[60.83,40.76],
      [60.50,40.83],[60.22,41.06],[59.98,41.36],[59.90,41.66],[60.05,41.95]
    ]]}'::jsonb,
  true,
  1,
  'Seed qiymat. Aniq chegara admin panel orqali yangilanishi kerak.'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO geofence_versions (geofence_id, version, area_geojson, policy, change_reason)
SELECT id, version, area_geojson, policy, 'Boshlang‘ich seed'
FROM geofences WHERE id = '00000000-0000-4000-8000-000000000101'
ON CONFLICT (geofence_id, version) DO NOTHING;

-- ---------------------------------------------------------------------
-- Lahjalar
-- ---------------------------------------------------------------------
INSERT INTO dialects (code, name_uz, description, marker_words) VALUES
  ('oguz', 'O‘g‘uz', 'Xiva–Urganch o‘qi bo‘ylab keng tarqalgan.',
   ARRAY['gel','geldi','gelyatir','git','gitti','qarpiz','gavun']),
  ('qipchoq', 'Qipchoq', 'Shimoliy tumanlarda uchraydi.',
   ARRAY['jol','jaxshi','paqir','yanga']),
  ('oguz_qipchoq', 'O‘g‘uz-Qipchoq', 'Chegaradosh hududlardagi aralash shakllar.',
   ARRAY['nema','qanda'])
ON CONFLICT (code) DO NOTHING;

INSERT INTO dialect_regions (dialect_id, region_id)
SELECT d.id, r.id FROM dialects d, regions r
WHERE (d.code = 'oguz' AND r.code IN ('xiva','urganch','yangiariq'))
   OR (d.code = 'qipchoq' AND r.code IN ('shovot','gurlan','qoshkopir'))
   OR (d.code = 'oguz_qipchoq' AND r.code IN ('xonqa','hazorasp','bogot','yangibozor','tuproqqala'))
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- Integratsiya kalitlari — bo'sh yozuvlar (qiymatlar keyin, server orqali)
-- ---------------------------------------------------------------------
INSERT INTO integration_secrets (provider, display_name, public_config) VALUES
  ('stt_primary',         'Asosiy STT (nutq → matn)',  '{"language":"uz"}'::jsonb),
  ('stt_fallback',        'Zaxira STT',                '{}'::jsonb),
  ('dialect_model',       'Sheva aniqlash modeli',     '{}'::jsonb),
  ('pronunciation_model', 'Talaffuz baholash',         '{}'::jsonb),
  ('moderation_ai',       'Matn moderatsiyasi (AI)',   '{}'::jsonb),
  ('object_storage',      'Audio saqlash (S3)',        '{}'::jsonb),
  ('push_notifications',  'Push bildirishnomalar',     '{}'::jsonb)
ON CONFLICT (provider) DO NOTHING;

COMMIT;
