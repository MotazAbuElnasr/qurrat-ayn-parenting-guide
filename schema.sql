-- قُرّة عين — community schema (Cloudflare D1)

CREATE TABLE IF NOT EXISTS users (
  visitor_id TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id  TEXT NOT NULL,
  author_name TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('موقف','قصة','قيمة')),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  -- what it teaches, as pipe-wrapped tags: '|الصبر|ضبط الغضب|'
  -- the wrapping pipes let LIKE '%|tag|%' match a whole tag and never a fragment
  tags        TEXT NOT NULL DEFAULT '',
  age_min     INTEGER NOT NULL,
  age_max     INTEGER NOT NULL,
  -- 'live' shows publicly, 'pending' waits for a human, 'hidden' is taken down
  status      TEXT NOT NULL DEFAULT 'live',
  -- why the moderator was asked to look (see src/moderation.js)
  flags       TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_feed ON posts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_author ON posts (visitor_id, created_at DESC);

-- one row per (target, visitor). target_type: 'post' | 'sit'
CREATE TABLE IF NOT EXISTS likes (
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  visitor_id  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (target_type, target_id, visitor_id)
);
CREATE INDEX IF NOT EXISTS likes_target ON likes (target_type, target_id);
