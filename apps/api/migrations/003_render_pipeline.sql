-- Production render pipeline.
--
-- * render_requests group the jobs of one submission (preview, long_form, short or both), so a
--   "both" request tracks its long-form and Shorts outputs independently.
-- * Jobs follow an 8-state lifecycle; a trigger refuses invalid transitions, so a failed or
--   cancelled job can never be marked completed, and completed requires a stored output.
-- * Output files are named from the project id, format and a per-project render version.
-- * Every job change and log entry is announced with NOTIFY render_changes (payload: job id),
--   which the API turns into Server-Sent Events.

-- ─── Render versions and requests ──────────────────────────────────────────────────────────

ALTER TABLE video_projects
  ADD COLUMN last_render_version integer NOT NULL DEFAULT 0 CHECK (last_render_version >= 0);

CREATE TABLE render_requests (
  id                  uuid PRIMARY KEY,
  project_id          uuid NOT NULL REFERENCES video_projects (id) ON DELETE CASCADE,
  type                text NOT NULL CHECK (type IN ('preview', 'long_form', 'short', 'both')),
  kind                text NOT NULL CHECK (kind IN ('preview', 'final')),
  formats             text[] NOT NULL
    CHECK (cardinality(formats) BETWEEN 1 AND 2 AND formats <@ ARRAY['long', 'short']),
  render_version      integer NOT NULL CHECK (render_version >= 1),
  idempotency_key     text,
  -- SHA-256 of the submission (project revision + kind + formats): the same key with a
  -- different request is rejected instead of silently returning the old jobs.
  request_fingerprint char(64),
  created_by          uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, render_version)
);
CREATE UNIQUE INDEX render_requests_idempotency_key
  ON render_requests (project_id, kind, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX render_requests_project_idx ON render_requests (project_id, created_at DESC);

-- ─── Jobs: backfill requests and versions for existing rows ────────────────────────────────

ALTER TABLE render_jobs
  ADD COLUMN request_id     uuid REFERENCES render_requests (id) ON DELETE CASCADE,
  ADD COLUMN render_version integer,
  ADD COLUMN output_key     text,
  ADD COLUMN error_code     text,
  ADD COLUMN worker_id      text;

CREATE TEMPORARY TABLE render_backfill ON COMMIT DROP AS
  SELECT j.id AS job_id, j.project_id, j.kind, j.output_format, j.created_by, j.created_at,
         gen_random_uuid() AS request_id,
         row_number() OVER (PARTITION BY j.project_id ORDER BY j.created_at, j.id)::int AS version
    FROM render_jobs j;

INSERT INTO render_requests (id, project_id, type, kind, formats, render_version, created_by,
                             created_at)
SELECT request_id, project_id,
       CASE WHEN kind = 'preview' THEN 'preview'
            WHEN output_format = 'long' THEN 'long_form' ELSE 'short' END,
       kind, ARRAY[output_format], version, created_by, created_at
  FROM render_backfill;

UPDATE render_jobs j
   SET request_id = b.request_id,
       render_version = b.version,
       output_key = COALESCE(
         (SELECT o.storage_key FROM video_outputs o WHERE o.render_job_id = j.id),
         CASE WHEN j.kind = 'preview' THEN 'renders/previews/'
              WHEN j.output_format = 'long' THEN 'renders/long/' ELSE 'renders/shorts/' END
           || j.project_id || '_' || j.output_format || '_v' || b.version
           || CASE WHEN j.kind = 'preview' THEN '_preview' ELSE '' END || '.mp4')
  FROM render_backfill b
 WHERE b.job_id = j.id;

UPDATE video_projects p
   SET last_render_version = COALESCE(
     (SELECT max(render_version) FROM render_requests r WHERE r.project_id = p.id), 0);

-- Jobs queued under the previous payload format cannot be rendered by the new worker.
UPDATE render_jobs
   SET status = 'failed', error_code = 'QUEUE_LOST', finished_at = now(), updated_at = now(),
       error_message = 'Superseded by the render pipeline upgrade; submit the render again',
       message = 'Superseded by the render pipeline upgrade'
 WHERE status IN ('queued', 'rendering');

-- ─── Jobs: the 8-state lifecycle ───────────────────────────────────────────────────────────

DROP INDEX render_jobs_active_idx;
ALTER TABLE render_jobs DROP CONSTRAINT render_jobs_status_check;
ALTER TABLE render_jobs
  DROP COLUMN stage,
  DROP COLUMN idempotency_key,
  DROP COLUMN request_fingerprint,
  ALTER COLUMN request_id SET NOT NULL,
  ALTER COLUMN render_version SET NOT NULL,
  ALTER COLUMN output_key SET NOT NULL,
  ADD CONSTRAINT render_jobs_output_key_unique UNIQUE (output_key),
  ADD CONSTRAINT render_jobs_request_format_unique UNIQUE (request_id, output_format),
  ADD CONSTRAINT render_jobs_status_check CHECK (status IN (
    'pending', 'validating', 'preparing', 'rendering', 'post_processing',
    'completed', 'failed', 'cancelled'));
CREATE INDEX render_jobs_active_idx ON render_jobs (created_at)
  WHERE status NOT IN ('completed', 'failed', 'cancelled');
CREATE INDEX render_jobs_request_idx ON render_jobs (request_id);

ALTER TABLE render_job_events RENAME COLUMN stage TO status;
UPDATE render_job_events SET status = CASE status
    WHEN 'queued' THEN 'pending'
    WHEN 'encoding' THEN 'post_processing'
    WHEN 'finalizing' THEN 'post_processing'
    ELSE status END;
ALTER TABLE render_job_events ADD CONSTRAINT render_job_events_status_check CHECK (status IN (
  'pending', 'validating', 'preparing', 'rendering', 'post_processing',
  'completed', 'failed', 'cancelled'));

-- The worker now builds input props from the database; props files are no longer written.
ALTER TABLE render_manifests ALTER COLUMN props_key DROP NOT NULL;

ALTER TABLE video_outputs
  ADD COLUMN render_version integer,
  ADD COLUMN metadata jsonb;
UPDATE video_outputs o SET render_version = j.render_version
  FROM render_jobs j WHERE j.id = o.render_job_id;
ALTER TABLE video_outputs ALTER COLUMN render_version SET NOT NULL;

-- ─── Transition guard ──────────────────────────────────────────────────────────────────────

-- Same rule as canTransitionRenderJob in @statsopedia/shared-types (tested for parity).
CREATE FUNCTION render_job_transition_allowed(from_status text, to_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN from_status IN ('completed', 'failed', 'cancelled') THEN false
    WHEN from_status = to_status THEN true
    WHEN to_status IN ('failed', 'cancelled', 'pending', 'validating') THEN true
    ELSE (from_status, to_status) IN (
      ('validating', 'preparing'), ('preparing', 'rendering'),
      ('rendering', 'post_processing'), ('post_processing', 'completed'))
  END
$$;

CREATE FUNCTION render_jobs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'render job % is already %', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT render_job_transition_allowed(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'invalid render job transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'completed'
     AND NOT EXISTS (SELECT 1 FROM video_outputs WHERE render_job_id = NEW.id) THEN
    RAISE EXCEPTION 'render job % cannot complete without an output', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER render_jobs_guard BEFORE UPDATE ON render_jobs
  FOR EACH ROW EXECUTE FUNCTION render_jobs_guard();

-- ─── Change notifications ──────────────────────────────────────────────────────────────────

CREATE FUNCTION render_jobs_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('render_changes', NEW.id::text);
  RETURN NULL;
END
$$;

CREATE FUNCTION render_job_events_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('render_changes', NEW.render_job_id::text);
  RETURN NULL;
END
$$;

CREATE TRIGGER render_jobs_notify AFTER INSERT OR UPDATE ON render_jobs
  FOR EACH ROW EXECUTE FUNCTION render_jobs_notify();
CREATE TRIGGER render_job_events_notify AFTER INSERT ON render_job_events
  FOR EACH ROW EXECUTE FUNCTION render_job_events_notify();
