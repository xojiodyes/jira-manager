-- Initial schema for jira-manager PostgreSQL storage
-- Schema: jiradashboard_owner

CREATE SCHEMA IF NOT EXISTS jiradashboard_owner;

-- Per-issue local data (status, confidence, etc.)
CREATE TABLE IF NOT EXISTS jiradashboard_owner.issues (
  issue_key   VARCHAR(32)  PRIMARY KEY,
  data        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Change history for local data edits
CREATE TABLE IF NOT EXISTS jiradashboard_owner.issue_history (
  id          SERIAL       PRIMARY KEY,
  issue_key   VARCHAR(32)  NOT NULL,
  field       VARCHAR(64)  NOT NULL,
  old_value   JSONB,
  new_value   JSONB,
  username    VARCHAR(255) NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_issue_history_key
  ON jiradashboard_owner.issue_history (issue_key, created_at);

-- Daily progress snapshots (one row per date per issue)
CREATE TABLE IF NOT EXISTS jiradashboard_owner.progress_snapshots (
  snapshot_date  DATE         NOT NULL,
  issue_key      VARCHAR(32)  NOT NULL,
  progress       SMALLINT     NOT NULL,
  PRIMARY KEY (snapshot_date, issue_key)
);
CREATE INDEX IF NOT EXISTS idx_snapshots_key
  ON jiradashboard_owner.progress_snapshots (issue_key, snapshot_date);

-- Git activity per issue (replaced on each snapshot)
CREATE TABLE IF NOT EXISTS jiradashboard_owner.git_activity (
  issue_key      VARCHAR(32)  PRIMARY KEY,
  last_activity  DATE,
  pr_count       INTEGER      NOT NULL DEFAULT 0,
  pr_merged      INTEGER      NOT NULL DEFAULT 0,
  pr_open        INTEGER      NOT NULL DEFAULT 0,
  repo_count     INTEGER      NOT NULL DEFAULT 0,
  commit_count   INTEGER      NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Developers per issue grouped by role (replaced on each snapshot)
CREATE TABLE IF NOT EXISTS jiradashboard_owner.issue_developers (
  issue_key  VARCHAR(32) NOT NULL,
  role       VARCHAR(16) NOT NULL,
  developers JSONB       NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (issue_key, role)
);

-- Key-value metadata (lastRun, etc.)
CREATE TABLE IF NOT EXISTS jiradashboard_owner.progress_metadata (
  key    VARCHAR(64) PRIMARY KEY,
  value  JSONB       NOT NULL
);
