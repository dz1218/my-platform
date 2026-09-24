-- Preserve existing accounts and foreign keys from the Prisma application.
DO $$ BEGIN
  IF to_regclass('users') IS NULL AND to_regclass('"User"') IS NOT NULL THEN
    ALTER TABLE "User" RENAME TO users;
    ALTER TABLE users RENAME COLUMN "createdAt" TO created_at;
    ALTER TABLE users RENAME COLUMN "updatedAt" TO updated_at;
    ALTER TABLE users RENAME COLUMN "passwordHash" TO password_hash;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identities (
  id text PRIMARY KEY,
  name text NOT NULL,
  age integer NOT NULL CHECK (age >= 18),
  avatar_url text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  background text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE matches (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  identity_id text NOT NULL REFERENCES identities(id),
  status text NOT NULL DEFAULT 'matched' CHECK (status IN ('matched','talking','dating','relationship','distant','ended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, identity_id)
);
CREATE TABLE conversations (
  id text PRIMARY KEY,
  match_id text NOT NULL UNIQUE REFERENCES matches(id),
  user_id text NOT NULL REFERENCES users(id),
  identity_id text NOT NULL REFERENCES identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_user ON conversations(user_id);
CREATE TABLE messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id),
  identity_id text NOT NULL REFERENCES identities(id),
  sender_type text NOT NULL CHECK (sender_type IN ('user','identity')),
  driver_type text CHECK (driver_type IN ('ai','human')),
  content text NOT NULL,
  request_id text,
  status text NOT NULL DEFAULT 'complete' CHECK (status IN ('pending','complete','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((sender_type = 'user' AND driver_type IS NULL) OR (sender_type = 'identity' AND driver_type IS NOT NULL))
);
CREATE INDEX messages_history ON messages(conversation_id, id DESC);
CREATE UNIQUE INDEX messages_request ON messages(conversation_id, request_id) WHERE sender_type = 'user';

INSERT INTO identities (id,name,age,city,background) VALUES
  ('identity_linwan','林晚',27,'上海','在上海生活，愿意慢慢认识一个人。'),
  ('identity_suhe','苏禾',25,'杭州','在杭州生活，珍惜日常里的小事。'),
  ('identity_chennian','陈念',28,'成都','在成都生活，喜欢认真听人说话。');

-- Phase 1 retains the existing novel UI and its Prisma repository.
CREATE TABLE IF NOT EXISTS "Novel" (
  id text PRIMARY KEY, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL, title text NOT NULL, description text,
  "coverUrl" text, status text NOT NULL DEFAULT 'ongoing',
  "authorId" text NOT NULL REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS "Chapter" (
  id text PRIMARY KEY, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL, title text NOT NULL, content text NOT NULL,
  "orderIndex" integer NOT NULL, published boolean NOT NULL DEFAULT false,
  "novelId" text NOT NULL REFERENCES "Novel"(id) ON DELETE CASCADE,
  UNIQUE ("novelId", "orderIndex")
);
