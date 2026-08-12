-- Community funksiyalari: so‘zlarni yoqtirish, izoh va hissa qo‘shuvchini kuzatish.
-- Foydalanuvchi hisob tizimi yo‘q holatda qurilma installation_id pseudonim sifatida ishlatiladi.

BEGIN;

CREATE TABLE word_likes (
  word_id         uuid NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  installation_id text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (word_id, installation_id)
);

CREATE TABLE word_comments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  word_id                 uuid NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  author_installation_id  text NOT NULL,
  body                    text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 800),
  status                  moderation_status NOT NULL DEFAULT 'pending',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX word_comments_word_idx ON word_comments(word_id, created_at DESC);
CREATE TRIGGER word_comments_set_updated_at BEFORE UPDATE ON word_comments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE contributor_follows (
  contributor_user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  follower_installation_id text NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contributor_user_id, follower_installation_id)
);

COMMIT;
