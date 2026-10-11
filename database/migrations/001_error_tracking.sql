-- Error tracking v1 — see docs/CONTRACT.md §3. Runs once, after init.sql, on a fresh database.

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS projects (
    id          SERIAL PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{1,64}$'),
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
    id               SERIAL PRIMARY KEY,
    project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind             TEXT NOT NULL CHECK (kind IN ('secret', 'public')),
    key_prefix       TEXT NOT NULL,
    key_hash         TEXT NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
    allowed_origins  TEXT[] NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at     TIMESTAMPTZ,
    revoked_at       TIMESTAMPTZ,
    -- A public key without allowed origins would accept any website.
    CHECK (kind = 'secret' OR cardinality(allowed_origins) > 0)
);

CREATE TABLE IF NOT EXISTS users (
    id             SERIAL PRIMARY KEY,
    email          TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
    password_hash  TEXT NOT NULL,
    role           TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    disabled_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash    TEXT PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL,
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS issues (
    id            BIGSERIAL PRIMARY KEY,
    project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    fingerprint   TEXT NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    source        TEXT NOT NULL CHECK (source IN ('browser', 'server')),
    error_type    TEXT NOT NULL,
    title         TEXT NOT NULL,
    culprit       TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'unresolved'
                  CHECK (status IN ('unresolved', 'resolved', 'ignored')),
    first_seen    TIMESTAMPTZ NOT NULL,
    last_seen     TIMESTAMPTZ NOT NULL,
    event_count   BIGINT NOT NULL DEFAULT 0,
    last_release  TEXT,
    resolved_at   TIMESTAMPTZ,
    UNIQUE (project_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_issues_project_last_seen ON issues(project_id, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_issues_project_status ON issues(project_id, status);

CREATE TABLE IF NOT EXISTS error_events (
    event_id          UUID NOT NULL,
    occurred_at       TIMESTAMPTZ NOT NULL,
    received_at       TIMESTAMPTZ NOT NULL,
    project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    issue_id          BIGINT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    source            TEXT NOT NULL CHECK (source IN ('browser', 'server')),
    environment       TEXT NOT NULL CHECK (environment IN ('production', 'preview', 'development')),
    level             TEXT NOT NULL CHECK (level IN ('fatal', 'error', 'warning')),
    error_type        TEXT NOT NULL,
    message           TEXT NOT NULL,
    stack             TEXT,
    release           TEXT,
    url_path          TEXT,
    http_method       TEXT,
    http_status       SMALLINT,
    http_route        TEXT,
    runtime           TEXT,
    tags              JSONB NOT NULL DEFAULT '{}',
    ml_score          REAL,
    ml_model_version  TEXT,
    PRIMARY KEY (event_id, occurred_at)
);
SELECT create_hypertable('error_events', 'occurred_at', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_error_events_issue ON error_events(issue_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_events_project ON error_events(project_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS issue_alerts (
    id                BIGSERIAL PRIMARY KEY,
    project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    issue_id          BIGINT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    kind              TEXT NOT NULL CHECK (kind IN ('new_issue', 'spike', 'regression')),
    details           JSONB NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at   TIMESTAMPTZ,
    acknowledged_by   INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_issue_alerts_open ON issue_alerts(project_id, created_at DESC)
    WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_issue_alerts_issue_kind ON issue_alerts(issue_id, kind, created_at DESC);

-- The first real project.
INSERT INTO projects (slug, name)
VALUES ('education-enlightened', 'Education Enlightened')
ON CONFLICT (slug) DO NOTHING;
