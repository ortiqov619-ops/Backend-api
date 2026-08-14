-- Foydalanuvchi hisoblari: grafik (naqsh) parol bilan ro'yxatdan o'tish,
-- profil rasmi va admin tomonidan bloklash.
--
-- Hisoblar mavjud `users` jadvaliga qo'shiladi, alohida jadvalga emas. Sabab:
-- `contribution_requests.submitted_by_user_id` va
-- `contributor_follows.contributor_user_id` allaqachon `users(id)` ga ishora
-- qiladi, ya'ni hissa qo'shgan odamni hisobiga bog'lash uchun u shu jadvalda
-- bo'lishi shart. Jadvalda `is_anonymous` va `display_name` ustunlari ham
-- boshidan shu maqsad uchun qo'yilgan.

BEGIN;

-- Xodim (moderator/admin) va ilova foydalanuvchisini ajratadi. Bu ajratish
-- muhim: xodim parol bilan, foydalanuvchi naqsh bilan kiradi va ular hech
-- qachon bir-birining kirish yo'lidan foydalana olmasligi kerak.
DO $$ BEGIN
  CREATE TYPE account_kind AS ENUM ('staff', 'app');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS kind account_kind NOT NULL DEFAULT 'staff',
  ADD COLUMN IF NOT EXISTS username citext,
  ADD COLUMN IF NOT EXISTS pattern_hash text,
  ADD COLUMN IF NOT EXISTS avatar_path text,
  -- Rasm turi saqlanadi, chunki uni fayl nomidan taxmin qilish ishonchsiz:
  -- PNG rasmni `image/jpeg` deb berish brauzer va React Native tomonida
  -- turlicha xatoga olib keladi.
  ADD COLUMN IF NOT EXISTS avatar_mime text,
  ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS blocked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS installation_id text,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- Foydalanuvchi nomi faqat ilova hisoblarida bo'ladi va takrorlanmaydi.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users(username) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_kind_created_idx ON users(kind, created_at DESC);

-- Ilova hisobi naqshsiz bo'lishi mumkin emas, xodim hisobida esa naqsh
-- bo'lmasligi kerak. Bu cheklov ikkala kirish yo'lini bir-biridan ajratib
-- turadi: naqsh bilan admin panelga, parol bilan ilovaga kirib bo'lmaydi.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_kind_credentials;
ALTER TABLE users ADD CONSTRAINT users_account_kind_credentials CHECK (
  (kind = 'app'   AND pattern_hash IS NOT NULL AND username IS NOT NULL)
  OR
  (kind = 'staff' AND pattern_hash IS NULL     AND username IS NULL)
);

-- Mavjud `users_identity_present` cheklovi email yoki telefon talab qilardi.
-- Ilova hisobi ikkalasini ham so'ramaydi: ro'yxatdan o'tish bepul va yengil
-- bo'lishi kerak, SMS yoki email tasdiqlash esa ham pul, ham to'siq. Bu
-- yerda foydalanuvchi nomi ham to'liq huquqli shaxs belgisi sifatida
-- qabul qilinadi.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_identity_present;
ALTER TABLE users ADD CONSTRAINT users_identity_present CHECK (
  email IS NOT NULL OR phone IS NOT NULL OR username IS NOT NULL OR is_anonymous
);

-- Bloklash sababi bo'lmasa qaror auditga tushmaydi, shuning uchun majburiy.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_blocked_reason_required;
ALTER TABLE users ADD CONSTRAINT users_blocked_reason_required CHECK (
  blocked_at IS NULL OR blocked_reason IS NOT NULL
);

-- ---------------------------------------------------------------------------
-- Community yozuvlarini hisobga bog'lash
-- ---------------------------------------------------------------------------
-- 0005 da yoqtirish/izoh qurilmaning `installation_id` siga bog'langan edi,
-- chunki hisob tizimi yo'q edi. Endi hisob bor: yangi yozuvlar hisobga
-- bog'lanadi, eski yozuvlar esa `installation_id` bilan joyida qoladi —
-- shuning uchun ustunlar NULL bo'lishi mumkin.

ALTER TABLE word_likes ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE word_comments ADD COLUMN IF NOT EXISTS author_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS word_likes_user_idx ON word_likes(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS word_comments_author_idx ON word_comments(author_user_id) WHERE author_user_id IS NOT NULL;

-- Bir hisob bitta so'zni bir marta yoqtiradi. `installation_id` bo'yicha
-- birlamchi kalit joyida qoladi (eski yozuvlar uchun), bu esa hisob uchun
-- qo'shimcha kafolat.
CREATE UNIQUE INDEX IF NOT EXISTS word_likes_user_word_key ON word_likes(word_id, user_id) WHERE user_id IS NOT NULL;

COMMIT;
