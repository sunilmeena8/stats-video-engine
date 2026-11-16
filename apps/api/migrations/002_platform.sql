-- Users and sessions, topics, templates, media assets, video projects, and persistent render
-- orchestration (manifests, jobs, job logs, outputs). PostgreSQL is the record of every job;
-- Redis/BullMQ is only the execution queue.

-- ─── Accounts ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id            uuid PRIMARY KEY,
  email         text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  name          text COLLATE "und-x-icu" NOT NULL,
  -- scrypt$N$r$p$salt$hash (see src/auth/passwords.ts); never the password itself.
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (email);

-- Opaque bearer tokens; only their SHA-256 is stored, so a database leak exposes no sessions.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   char(64) NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

-- ─── Catalogue ────────────────────────────────────────────────────────────────────────────

CREATE TABLE topics (
  id          uuid PRIMARY KEY,
  slug        text NOT NULL UNIQUE,
  name        text COLLATE "und-x-icu" NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE datasets
  ADD COLUMN topic_id   uuid REFERENCES topics (id) ON DELETE SET NULL,
  ADD COLUMN created_by uuid REFERENCES users (id) ON DELETE SET NULL;
CREATE INDEX datasets_topic_idx ON datasets (topic_id);

ALTER TABLE dataset_versions
  ADD COLUMN created_by uuid REFERENCES users (id) ON DELETE SET NULL;

-- Template rows are immutable; a change is a new (slug, version) row.
CREATE TABLE templates (
  id                uuid PRIMARY KEY,
  slug              text NOT NULL,
  version           integer NOT NULL CHECK (version >= 1),
  name              text NOT NULL,
  description       text,
  composition_id    text NOT NULL CHECK (composition_id ~ '^[A-Za-z0-9-]+$'),
  supported_formats text[] NOT NULL
    CHECK (cardinality(supported_formats) >= 1 AND supported_formats <@ ARRAY['long', 'short']),
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug, version)
);

CREATE TABLE media_assets (
  id               uuid PRIMARY KEY,
  type             text NOT NULL CHECK (type IN ('logo', 'music', 'font', 'image', 'thumbnail')),
  name             text COLLATE "und-x-icu" NOT NULL,
  storage_key      text NOT NULL UNIQUE,
  mime_type        text NOT NULL,
  size_bytes       bigint NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256  char(64) NOT NULL,
  duration_seconds double precision,
  width            integer,
  height           integer,
  attribution      text,
  license          text,
  uploaded_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_assets_type_idx ON media_assets (type, created_at DESC);

-- ─── Projects ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE video_projects (
  id                 uuid PRIMARY KEY,
  name               text COLLATE "und-x-icu" NOT NULL,
  topic_id           uuid REFERENCES topics (id) ON DELETE SET NULL,
  status             text NOT NULL
    CHECK (status IN ('draft', 'ready', 'rendering', 'rendered', 'failed', 'archived')),
  dataset_id         uuid NOT NULL REFERENCES datasets (id) ON DELETE RESTRICT,
  -- A project always points at one specific, immutable dataset version.
  dataset_version_id uuid NOT NULL REFERENCES dataset_versions (id) ON DELETE RESTRICT,
  template_id        uuid NOT NULL REFERENCES templates (id) ON DELETE RESTRICT,
  template_version   integer NOT NULL,
  music_asset_id     uuid REFERENCES media_assets (id) ON DELETE RESTRICT,
  configuration      jsonb NOT NULL,
  revision           integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX video_projects_updated_idx ON video_projects (updated_at DESC);
CREATE INDEX video_projects_dataset_version_idx ON video_projects (dataset_version_id);
CREATE INDEX video_projects_topic_idx ON video_projects (topic_id);

-- ─── Rendering ────────────────────────────────────────────────────────────────────────────

-- Exactly what one render used. The full input props live in storage under props_key.
CREATE TABLE render_manifests (
  id                 uuid PRIMARY KEY,
  project_id         uuid NOT NULL REFERENCES video_projects (id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('preview', 'final')),
  output_format      text NOT NULL CHECK (output_format IN ('long', 'short')),
  composition_id     text NOT NULL,
  template_id        uuid NOT NULL REFERENCES templates (id) ON DELETE RESTRICT,
  template_version   integer NOT NULL,
  dataset_version_id uuid NOT NULL REFERENCES dataset_versions (id) ON DELETE RESTRICT,
  music_asset_id     uuid REFERENCES media_assets (id) ON DELETE RESTRICT,
  race_config        jsonb NOT NULL,
  props_key          text NOT NULL UNIQUE,
  props_checksum     char(64) NOT NULL,
  -- Frame captured as the thumbnail (the last chart frame), so a job can be re-queued exactly.
  thumbnail_frame    integer CHECK (thumbnail_frame >= 0),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX render_manifests_project_idx ON render_manifests (project_id, created_at DESC);

CREATE TABLE render_jobs (
  id                  uuid PRIMARY KEY, -- also the BullMQ job id
  project_id          uuid NOT NULL REFERENCES video_projects (id) ON DELETE CASCADE,
  manifest_id         uuid NOT NULL REFERENCES render_manifests (id) ON DELETE RESTRICT,
  kind                text NOT NULL CHECK (kind IN ('preview', 'final')),
  output_format       text NOT NULL CHECK (output_format IN ('long', 'short')),
  queue_name          text NOT NULL,
  status              text NOT NULL
    CHECK (status IN ('queued', 'rendering', 'completed', 'failed', 'cancelled')),
  stage               text NOT NULL,
  percent             real NOT NULL DEFAULT 0 CHECK (percent BETWEEN 0 AND 100),
  message             text,
  attempts            integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts        integer NOT NULL CHECK (max_attempts >= 1),
  idempotency_key     text,
  -- SHA-256 of the submission (project revision + kind + formats): same key, different
  -- request is rejected instead of silently returning the old jobs.
  request_fingerprint char(64),
  error_message       text,
  cancel_requested_at timestamptz,
  created_by          uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  finished_at         timestamptz
);
-- One job per (project, kind, key, format): a retried submission cannot create duplicates.
CREATE UNIQUE INDEX render_jobs_idempotency_key
  ON render_jobs (project_id, kind, idempotency_key, output_format)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX render_jobs_project_idx ON render_jobs (project_id, created_at DESC);
CREATE INDEX render_jobs_active_idx ON render_jobs (created_at)
  WHERE status IN ('queued', 'rendering');

-- Render log. Ids are monotonic, so they double as Server-Sent Event ids for reconnection.
CREATE TABLE render_job_events (
  id            bigserial PRIMARY KEY,
  render_job_id uuid NOT NULL REFERENCES render_jobs (id) ON DELETE CASCADE,
  at            timestamptz NOT NULL DEFAULT now(),
  level         text NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  stage         text NOT NULL,
  percent       real NOT NULL CHECK (percent BETWEEN 0 AND 100),
  message       text NOT NULL
);
CREATE INDEX render_job_events_job_idx ON render_job_events (render_job_id, id);

CREATE TABLE video_outputs (
  id               uuid PRIMARY KEY,
  render_job_id    uuid NOT NULL UNIQUE REFERENCES render_jobs (id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES video_projects (id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('preview', 'final')),
  format           text NOT NULL CHECK (format IN ('long', 'short')),
  storage_key      text NOT NULL UNIQUE,
  thumbnail_key    text,
  width            integer NOT NULL CHECK (width > 0),
  height           integer NOT NULL CHECK (height > 0),
  fps              double precision NOT NULL CHECK (fps > 0),
  duration_seconds double precision NOT NULL CHECK (duration_seconds > 0),
  size_bytes       bigint NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256  char(64) NOT NULL,
  codec            text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX video_outputs_project_idx ON video_outputs (project_id, created_at DESC);
