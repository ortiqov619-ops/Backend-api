-- Talaffuz yozuvlarini bazada saqlash.
--
-- NEGA
-- ----
-- Render'ning bepul tarifida doimiy disk yo'q, shuning uchun fayl tizimiga
-- yozilgan audio har deployda yo'qolardi. Tashqi obyekt xotirasi (Supabase)
-- to'g'ri yechim, lekin u yangi hisob va kalit talab qiladi.
--
-- Talaffuz yozuvlari kichik: 3–4 soniyalik m4a ≈ 60 KB, chegara esa 8 MB.
-- Bazaning bepul hajmi 1 GB — bu minglab yozuvga yetadi. Sinov bosqichi
-- uchun bu eng ishonchli variant: yangi xizmat ham, kalit ham kerak emas
-- va yozuvlar deploydan keyin ham joyida qoladi.
--
-- Saqlash qatlami almashtiriladigan bo'lib qoladi: Supabase sozlangach
-- yangi yozuvlar o'sha yerga tushadi, bazadagilari esa o'qilaverad.

BEGIN;

-- Yangi provayder qiymati. `ALTER TYPE ... ADD VALUE` mavjud qiymatlarga
-- tegmaydi, shuning uchun eski yozuvlar o'z joyida qoladi.
ALTER TYPE audio_storage_provider ADD VALUE IF NOT EXISTS 'database';

-- Bayt massivi alohida jadvalda: `audio_submissions` moderatsiya
-- so'rovlarida tez-tez o'qiladi va uni og'ir ustun bilan sekinlashtirish
-- kerak emas. PostgreSQL katta qiymatlarni avtomatik siqib, alohida
-- saqlaydi (TOAST), shuning uchun asosiy jadval yengil qoladi.
CREATE TABLE IF NOT EXISTS audio_blobs (
  audio_submission_id uuid PRIMARY KEY REFERENCES audio_submissions(id) ON DELETE CASCADE,
  content    bytea NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  mime_type  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
