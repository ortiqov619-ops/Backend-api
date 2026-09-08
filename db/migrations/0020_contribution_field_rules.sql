-- =====================================================================
-- Migratsiya: 0020_contribution_field_rules
--
-- Hissa qo'shish formasidagi maydonlardan qaysi biri MAJBURIY ekanini
-- loyiha egasi admin paneldan belgilaydi.
--
-- NEGA: talab lug'atning bosqichiga qarab o'zgaradi. Boshida ko'p
-- maydon so'ralsa odam so'z qo'shmay ketadi; keyinroq sifatni oshirish
-- uchun, masalan, adabiy shakl yoki talaffuz majburiy qilinishi mumkin.
-- Buni har safar yangi mobil reliz chiqarmasdan o'zgartirish kerak.
--
-- `word`, `meaning` va hudud bu jadvalda YO'Q va ataylab: ularsiz
-- yozuvning o'zi ma'nosiz, shuning uchun ular kod darajasida har doim
-- majburiy.
--
-- Migratsiya faqat qo'shadi.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS contribution_field_rules (
  field       text PRIMARY KEY,
  is_required boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL
);

COMMENT ON TABLE contribution_field_rules IS
  'Hissa formasidagi ixtiyoriy maydonlardan qaysi biri majburiy. Faqat admin o''zgartiradi.';

-- Sukut: hech biri majburiy emas — bu hozirgi xulq, ya'ni migratsiya
-- ishlab turgan ilovaning talabini o'zgartirmaydi.
-- Ro'yxat hissa formasida HAQIQATAN bor maydonlardan iborat: formada
-- yo'q maydonni majburiy qilish yuborishni butunlay to'xtatib qo'yardi.
INSERT INTO contribution_field_rules (field, is_required) VALUES
  ('clan',      false),
  ('dialectId', false),
  ('audio',     false)
ON CONFLICT (field) DO NOTHING;

COMMIT;
