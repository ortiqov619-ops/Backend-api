-- =====================================================================
-- Migratsiya: 0021_proposed_region_levels
--
-- MUAMMO: «Boshqa davlat» yoki «Boshqa viloyat» tanlab yuborilgan so'z
-- moderatsiya navbatiga UMUMAN tushmasdi.
--
-- 0008 migratsiyasi `proposedRegion` shaklini tekshiradigan constraint
-- qo'shgan va o'sha paytda taklif qilish mumkin bo'lgan darajalar faqat
-- `district`, `village`, `neighborhood` edi. Keyinroq server va ilova
-- davlat (`republic`) va viloyat (`region`) taklifini ham qo'llab-
-- quvvatlaydigan bo'ldi — `parseRegionSuggestion`, `isAboveRegionProposal`
-- va `createRegionChain` hammasi tayyor — lekin constraint eski holicha
-- qoldi.
--
-- Natijada INSERT `23514` bilan yiqilar, `db-errors.ts` uni 422
-- «Taklif qilingan hudud ma'lumoti noto'g'ri» deb ko'rsatardi va so'z
-- hech qayerga saqlanmasdi: foydalanuvchi ham, moderator ham uni
-- boshqa ko'rmasdi.
--
-- YECHIM: constraint KENGAYTIRILADI.
--   * ruxsat etilgan darajalar ro'yxatiga `republic` va `region` qo'shiladi;
--   * `republic` uchun `parentRegionId` bo'lmasligi (JSON `null` yoki
--     kalitning o'zi yo'qligi) to'g'ri hisoblanadi — davlat ierarxiyaning
--     ildizi, uning ustida hudud bo'lmaydi. `parseRegionSuggestion` aynan
--     `null` qaytaradi;
--   * qolgan darajalar uchun eski talab o'zgarishsiz: `parentRegionId`
--     matn va UUID shaklida bo'lishi shart.
--
-- Yangi qoida eskisidan faqat KENGROQ: eski constraint qabul qilgan
-- har bir qiymatni u ham qabul qiladi. Shuning uchun birorta mavjud
-- yozuv yaroqsiz bo'lib qolmaydi.
--
-- Migratsiya ma'lumotga TEGMAYDI: birorta jadval, ustun yoki qator
-- o'chirilmaydi. Faqat cheklovning o'zi almashtiriladi — CHECK ni
-- yumshatishning boshqa yo'li yo'q, PostgreSQL uni joyida tahrirlay
-- olmaydi.
--
-- Takroran ishga tushirilsa ham xavfsiz: `DROP ... IF EXISTS` dan keyin
-- constraint qayta yaratiladi.
-- =====================================================================

BEGIN;

ALTER TABLE contribution_requests
  DROP CONSTRAINT IF EXISTS contribution_requests_proposed_region_shape;

ALTER TABLE contribution_requests
  ADD CONSTRAINT contribution_requests_proposed_region_shape CHECK (
    NOT (payload ? 'proposedRegion')
    OR COALESCE((
      jsonb_typeof(payload->'proposedRegion') = 'object'
      AND jsonb_typeof(payload->'proposedRegion'->'nameUz') = 'string'
      AND length(btrim(payload->'proposedRegion'->>'nameUz')) BETWEEN 2 AND 80
      AND jsonb_typeof(payload->'proposedRegion'->'level') = 'string'
      AND payload->'proposedRegion'->>'level' IN (
        'republic', 'region', 'district', 'village', 'neighborhood'
      )
      AND CASE
        -- Davlat: ota-hudud YO'Q. Kalit umuman bo'lmasligi ham,
        -- ochiq `null` bo'lishi ham bir xil to'g'ri.
        WHEN payload->'proposedRegion'->>'level' = 'republic'
          THEN COALESCE(jsonb_typeof(payload->'proposedRegion'->'parentRegionId'), 'null') = 'null'
        -- Qolganlari har doim mavjud hududning ichiga taklif qilinadi.
        ELSE jsonb_typeof(payload->'proposedRegion'->'parentRegionId') = 'string'
          AND payload->'proposedRegion'->>'parentRegionId'
            ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      END
    ), false)
  ) NOT VALID;

-- NOT VALID — 0008 dagi sabab bilan bir xil: mavjud qatorlar qayta
-- tekshirilmaydi (jadvalni to'liq o'qish shart emas va 0008 dan oldingi
-- eski payloadlar audit dalili sifatida qoladi). Yangi INSERT/UPDATE
-- uchun PostgreSQL uni baribir darhol qo'llaydi.

COMMIT;
