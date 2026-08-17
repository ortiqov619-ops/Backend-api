-- Bildirishnomalar va jamoa amallarini haqiqiy, saqlanadigan ma'lumotga
-- aylantirish.
--
-- 0005 da yoqtirish/izoh jadvallari yaratilgan edi, ammo ularga birorta ham
-- endpoint yozilmagan: ilova ularni qurilma xotirasida saqlab, foydalanuvchiga
-- ishlayotgandek ko'rsatardi. Bildirishnoma esa umuman yo'q edi — moderator
-- yangi taklif kelganini, foydalanuvchi esa qarorni bilmasdi.
--
-- Bu migratsiya faqat qo'shadi: mavjud ustun o'chirilmaydi va mavjud yozuv
-- yo'qotilmaydi. Eski, qurilmaga bog'langan yoqtirish/izohlar joyida qoladi.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Bildirishnomalar
-- ---------------------------------------------------------------------------

-- Tur enum sifatida saqlanadi: matn emas, qaror. Ilova har bir turga o'z
-- ikonkasi va yo'nalishini bog'laydi, shuning uchun ro'yxat cheklangan
-- bo'lishi kerak.
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'WORD_SUBMITTED',            -- moderatorga: yangi so'z taklifi keldi
    'WORD_RESUBMITTED',          -- moderatorga: aniqlashtirilgan taklif qayta keldi
    'AUDIO_SUBMITTED',           -- moderatorga: talaffuz yozuvi keldi
    'WORD_APPROVED',             -- foydalanuvchiga: so'z lug'atga kirdi
    'WORD_REVISION_REQUESTED',   -- foydalanuvchiga: aniqlashtirish so'raldi
    'WORD_REJECTED',             -- foydalanuvchiga: taklif rad etildi
    'AUDIO_APPROVED',
    'AUDIO_REVISION_REQUESTED',
    'AUDIO_REJECTED',
    'COMMENT_CREATED',           -- so'z egasiga: izoh yozildi
    'COMMENT_REPLY',             -- izoh egasiga: javob yozildi
    'LIKE_RECEIVED',
    'ACCOUNT_BLOCKED',
    'ACCOUNT_UNBLOCKED',
    'SYSTEM'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Bildirishnoma bosilganda ilova qayerga o'tishini shu ikkilik belgilaydi.
DO $$ BEGIN
  CREATE TYPE notification_entity_type AS ENUM (
    'word', 'contribution_request', 'audio_submission', 'word_comment', 'user', 'none'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS notifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Qabul qiluvchi ham ilova foydalanuvchisi, ham xodim bo'lishi mumkin:
  -- ikkalasi ham `users` jadvalida yashaydi, shuning uchun alohida jadval
  -- kerak emas va bitta inbox mantiqi ikkala ilovaga xizmat qiladi.
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Amalni bajargan odam. Tizim yozuvlarida bo'sh.
  actor_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  type              notification_type NOT NULL,
  title             text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  body              text NOT NULL CHECK (char_length(body) <= 600),
  entity_type       notification_entity_type NOT NULL DEFAULT 'none',
  -- `text`, chunki `audit_logs.entity_id` ham shunday: entity har doim uuid
  -- emas (masalan integratsiya provideri).
  entity_id         text,
  -- Deep-link uchun qo'shimcha: so'z matni, taklif id'si va h.k.
  data              jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Inbox har doim "eng yangisi ustida" tartibida o'qiladi.
CREATE INDEX IF NOT EXISTS notifications_recipient_idx
  ON notifications(recipient_user_id, created_at DESC);
-- O'qilmaganlar soni har ekranda so'raladi, shuning uchun alohida qisman indeks.
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON notifications(recipient_user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_entity_idx
  ON notifications(entity_type, entity_id);

DO $$ BEGIN
  CREATE TRIGGER notifications_set_updated_at BEFORE UPDATE ON notifications
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Yoqtirish tugmasi ketma-ket bosilsa (yoqtirdim → bekor qildim → yoqtirdim)
-- egasiga har safar yangi bildirishnoma bormasligi kerak. Bitta odam bitta
-- so'z uchun bir marta xabar qiladi.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_like_once
  ON notifications(recipient_user_id, actor_user_id, entity_id)
  WHERE type = 'LIKE_RECEIVED';

-- ---------------------------------------------------------------------------
-- 2. Saqlangan so'zlar
-- ---------------------------------------------------------------------------
-- Ilgari saqlash faqat qurilmaning Keychain xotirasida edi: telefon
-- almashtirilsa yoki ilova qayta o'rnatilsa ro'yxat yo'qolardi. Hisob bor
-- ekan, saqlash ham hisobga tegishli bo'lishi kerak.

CREATE TABLE IF NOT EXISTS word_saves (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_id    uuid NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Birlamchi kalitning o'zi takroriy saqlashni bazada to'sadi: ilova ikki
  -- marta bosilsa ham ikkinchi yozuv paydo bo'lmaydi.
  PRIMARY KEY (user_id, word_id)
);
CREATE INDEX IF NOT EXISTS word_saves_user_idx ON word_saves(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS word_saves_word_idx ON word_saves(word_id);

-- ---------------------------------------------------------------------------
-- 3. Yoqtirish: qurilmadan hisobga
-- ---------------------------------------------------------------------------
-- 0005 da birlamchi kalit `(word_id, installation_id)` edi, chunki hisob
-- tizimi yo'q edi va yoqtirish qurilmaga bog'langandi. Hisob paydo bo'lgach
-- bu ikki muammo tug'diradi: hisob bilan yoqtirgan odam uchun qurilma
-- identifikatori majburiy bo'lib qoladi, va bir odamning ikki telefoni ikki
-- kishi bo'lib sanaladi.
--
-- Yechim: sun'iy birlamchi kalit, va noyoblik ikkita qisman indeks bilan —
-- hisob uchun bittasi (0010 da yaratilgan), eski qurilma yozuvlari uchun
-- ikkinchisi. Eski yozuvlar o'z joyida qoladi va hisoblanishda davom etadi.
ALTER TABLE word_likes ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();

DO $$ BEGIN
  ALTER TABLE word_likes DROP CONSTRAINT word_likes_pkey;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE word_likes ADD CONSTRAINT word_likes_pkey PRIMARY KEY (id);
EXCEPTION
  WHEN invalid_table_definition THEN NULL;  -- birlamchi kalit allaqachon bor
  WHEN duplicate_object THEN NULL;          -- shu nomdagi cheklov allaqachon bor
  WHEN duplicate_table THEN NULL;           -- indeks nomi band
END $$;

ALTER TABLE word_likes ALTER COLUMN installation_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS word_likes_installation_word_key
  ON word_likes(word_id, installation_id) WHERE installation_id IS NOT NULL;

-- Egasiz yoqtirish yozuvi bo'lmasligi kerak: u na hisoblanadi, na bekor
-- qilinadi.
ALTER TABLE word_likes DROP CONSTRAINT IF EXISTS word_likes_actor_present;
ALTER TABLE word_likes ADD CONSTRAINT word_likes_actor_present CHECK (
  user_id IS NOT NULL OR installation_id IS NOT NULL
);

CREATE INDEX IF NOT EXISTS word_likes_word_idx ON word_likes(word_id);

-- ---------------------------------------------------------------------------
-- 4. Izohlar: javoblar va o'chirish
-- ---------------------------------------------------------------------------

ALTER TABLE word_comments
  ADD COLUMN IF NOT EXISTS parent_comment_id uuid REFERENCES word_comments(id) ON DELETE CASCADE,
  -- Izoh jismonan o'chirilmaydi: javoblar zanjiri uzilmasligi va moderator
  -- nima bo'lganini ko'ra olishi uchun faqat belgilanadi.
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS word_comments_parent_idx
  ON word_comments(parent_comment_id, created_at) WHERE parent_comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS word_comments_visible_idx
  ON word_comments(word_id, created_at DESC) WHERE deleted_at IS NULL;

-- 0005 da izoh muallifi qurilma edi, chunki hisob tizimi yo'q edi. Endi izoh
-- hisob bilan yoziladi va qurilma identifikatori talab qilinmaydi. Eski
-- yozuvlar buzilmasligi uchun ustun saqlanadi, faqat majburiyligi olinadi.
ALTER TABLE word_comments ALTER COLUMN author_installation_id DROP NOT NULL;
ALTER TABLE word_comments DROP CONSTRAINT IF EXISTS word_comments_author_present;
ALTER TABLE word_comments ADD CONSTRAINT word_comments_author_present CHECK (
  author_user_id IS NOT NULL OR author_installation_id IS NOT NULL
);

-- ---------------------------------------------------------------------------
-- 5. So'z egasini tiklash
-- ---------------------------------------------------------------------------
-- Yoqtirish va izoh haqida kimga xabar berishni bilish uchun so'zning muallifi
-- kerak. `words.created_by` boshidan shu maqsad uchun turgan, lekin taklif
-- tasdiqlanganda hech qachon to'ldirilmagan. Mavjud yozuvlar uchun uni
-- manba taklifdan tiklaymiz — bu ma'lumotni ko'chirish emas, mavjud
-- munosabatni tiklashdir.
UPDATE words w
   SET created_by = cr.submitted_by_user_id
  FROM contribution_requests cr
 WHERE w.source_request_id = cr.id
   AND w.created_by IS NULL
   AND cr.submitted_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS words_created_by_idx ON words(created_by) WHERE created_by IS NOT NULL;

-- Moderator navbatini kimning yuborgani bo'yicha ochish uchun.
CREATE INDEX IF NOT EXISTS contribution_requests_submitter_idx
  ON contribution_requests(submitted_by_user_id, created_at DESC)
  WHERE submitted_by_user_id IS NOT NULL;

-- Lug'at ro'yxati har bir so'z uchun "tasdiqlangan talaffuz bormi" deb
-- so'raydi. `contribution_request_id` bo'yicha indeks 0001 da bor edi,
-- `word_id` bo'yicha esa yo'q — u holda har so'rov to'liq skanerga tushardi.
CREATE INDEX IF NOT EXISTS audio_submissions_word_idx
  ON audio_submissions(word_id) WHERE word_id IS NOT NULL;

COMMIT;
