-- Audio mavjudligini haqiqatga moslashtirish va so'z egaligini aniqlashtirish.
--
-- MUAMMO
-- ------
-- Render'ning bepul tarifida doimiy disk yo'q. `AUDIO_UPLOAD_DIR` ko'rsatgan
-- papka oddiy konteyner papkasi bo'lib, har deployda konteyner bilan birga
-- o'chadi. Bazadagi yozuv esa qoladi.
--
-- Natijada tizim o'zi bilmagan holda yolg'on gapiradi:
--   * admin ro'yxati "3.8 soniya audio bor" deydi, lekin tinglab bo'lmaydi;
--   * foydalanuvchi ilovasi "talaffuz yo'q" deydi;
--   * ikkalasi bir xil qatorni turlicha talqin qiladi.
--
-- Bu migratsiya faylning haqiqiy holatini BAZAGA yozadi, shunda ikkala
-- ilova bir xil haqiqatni ko'radi. Fayllarni tiklamaydi — yo'qolgan fayl
-- qaytarib bo'lmaydi — lekin uni ochiq "yo'qolgan" deb belgilash imkonini
-- beradi.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Audio yozuvining saqlash holati
-- ---------------------------------------------------------------------------

-- Qaysi provayderda saqlangani. Ilgari bu faqat `storage_bucket` matnidan
-- taxmin qilinardi ('local' yoki bucket nomi), bu esa yangi provayder
-- qo'shilganda chalkashlikka olib kelardi.
DO $$ BEGIN
  CREATE TYPE audio_storage_provider AS ENUM ('local', 'supabase');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE audio_submissions
  ADD COLUMN IF NOT EXISTS storage_provider audio_storage_provider NOT NULL DEFAULT 'local',
  -- `false` — fayl saqlashda topilmadi. Yozuv o'chirilmaydi: u moderatsiya
  -- tarixining bir qismi va "qayta yozish kerak" holatini ko'rsatadi.
  ADD COLUMN IF NOT EXISTS storage_available boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS storage_checked_at timestamptz;

-- Mavjud yozuvlar uchun provayderni bucket nomidan aniqlaymiz.
UPDATE audio_submissions
   SET storage_provider = CASE WHEN storage_bucket = 'local' THEN 'local'::audio_storage_provider
                               ELSE 'supabase'::audio_storage_provider END
 WHERE storage_provider IS NULL OR storage_provider = 'local';

-- Yo'qolgan yozuvlarni tez topish uchun (admin ro'yxati va tuzatish skripti).
CREATE INDEX IF NOT EXISTS audio_submissions_missing_idx
  ON audio_submissions(created_at DESC)
  WHERE NOT storage_available;

-- ---------------------------------------------------------------------------
-- 2. So'zning kelib chiqishi va egasi
-- ---------------------------------------------------------------------------
-- Lug'atdagi har bir so'z qayerdan kelganini aytib bera olishi kerak.
-- Ilgari buni faqat `source_request_id` va `created_by` kombinatsiyasidan
-- taxmin qilish mumkin edi va ikkalasi ham bo'sh bo'lishi mumkin edi.

DO $$ BEGIN
  CREATE TYPE word_source_type AS ENUM ('SYSTEM', 'ADMIN', 'USER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE words
  ADD COLUMN IF NOT EXISTS source_type word_source_type NOT NULL DEFAULT 'SYSTEM';

-- Hissa so'rovidan chiqqan va egasi ma'lum bo'lgan so'zlar — jamoa so'zlari.
UPDATE words w
   SET source_type = 'USER'
  FROM contribution_requests cr
 WHERE w.source_request_id = cr.id
   AND cr.submitted_by_user_id IS NOT NULL;

-- Administrator bevosita kiritgan so'zlar (so'rovsiz, lekin muallifi bor).
UPDATE words
   SET source_type = 'ADMIN'
 WHERE source_request_id IS NULL
   AND created_by IS NOT NULL
   AND source_type = 'SYSTEM';

-- Qolgani seed/tahririy yozuvlar bo'lib qoladi: ular hisob tizimi paydo
-- bo'lishidan oldin yaratilgan va ularga sun'iy egalik biriktirilmaydi.

CREATE INDEX IF NOT EXISTS words_source_type_idx ON words(source_type);

COMMIT;
