CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(32) NOT NULL,
  normalized_username VARCHAR(32) NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('player', 'manager')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS team_code VARCHAR(4);

DO $$
BEGIN
  ALTER TABLE users
    ADD CONSTRAINT users_team_code_format
    CHECK (team_code IS NULL OR team_code ~ '^[A-Z0-9]{4}$');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_manager_team_code_key
  ON users (team_code)
  WHERE role = 'manager' AND team_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_player_team_code_idx
  ON users (team_code)
  WHERE role = 'player';

CREATE TABLE IF NOT EXISTS target_settings (
  singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
  dm_matches_required INTEGER NOT NULL CHECK (dm_matches_required > 0),
  dm_placement_limit INTEGER NOT NULL CHECK (dm_placement_limit > 0),
  range_rounds_required INTEGER NOT NULL CHECK (range_rounds_required > 0),
  range_min_score INTEGER NOT NULL CHECK (range_min_score BETWEEN 0 AND 30),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO target_settings (
  singleton_id,
  dm_matches_required,
  dm_placement_limit,
  range_rounds_required,
  range_min_score
) VALUES (1, 2, 5, 3, 25)
ON CONFLICT (singleton_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS team_target_settings (
  team_code VARCHAR(4) PRIMARY KEY,
  dm_matches_required INTEGER NOT NULL CHECK (dm_matches_required > 0),
  dm_placement_limit INTEGER NOT NULL CHECK (dm_placement_limit > 0),
  range_rounds_required INTEGER NOT NULL CHECK (range_rounds_required > 0),
  range_min_score INTEGER NOT NULL CHECK (range_min_score BETWEEN 0 AND 30),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS submissions (
  submission_id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id VARCHAR(64) NOT NULL,
  player_name VARCHAR(32) NOT NULL,
  submission_date DATE NOT NULL,
  dm_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  range_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  requirements_snapshot JSONB NOT NULL,
  screenshot_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  screenshot_slots JSONB NOT NULL DEFAULT '{"dm":[],"range":[]}'::jsonb,
  is_attended BOOLEAN NOT NULL,
  dm_passed BOOLEAN NOT NULL,
  range_passed BOOLEAN NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, submission_date)
);

CREATE INDEX IF NOT EXISTS submissions_date_idx ON submissions (submission_date DESC);
CREATE INDEX IF NOT EXISTS submissions_player_idx ON submissions (LOWER(player_name));
