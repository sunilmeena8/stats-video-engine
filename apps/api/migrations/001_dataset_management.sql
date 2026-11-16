-- Dataset management: datasets, immutable versions, and the entities, data points and sources
-- imported from each valid version. Applied by `pnpm --filter @statsopedia/api db:migrate`.
--
-- Names use ICU root collation so ORDER BY sorts "Åland" next to "Albania" instead of after
-- "zambia" (the Alpine image's libc locale sorts by code point).

CREATE TABLE data_sources (
  id          uuid PRIMARY KEY,
  key         text NOT NULL UNIQUE CHECK (length(key) BETWEEN 1 AND 120),
  name        text COLLATE "und-x-icu" NOT NULL,
  publisher   text,
  url         text,
  license     text,
  accessed_at timestamptz,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE datasets (
  id                uuid PRIMARY KEY,
  slug              text NOT NULL UNIQUE,
  title             text COLLATE "und-x-icu" NOT NULL,
  description       text,
  unit              text,
  metric            jsonb NOT NULL,
  processing        jsonb NOT NULL,
  latest_version_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dataset_versions (
  id                  uuid PRIMARY KEY,
  dataset_id          uuid NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
  version             integer NOT NULL CHECK (version >= 1),
  status              text NOT NULL CHECK (status IN ('uploaded', 'processing', 'ready', 'failed')),
  validation_status   text NOT NULL
    CHECK (validation_status IN ('pending', 'valid', 'valid_with_warnings', 'invalid')),
  source_version_id   uuid REFERENCES dataset_versions (id),
  original_filename   text NOT NULL,
  source_file_path    text NOT NULL,
  size_bytes          bigint NOT NULL CHECK (size_bytes >= 0),
  processed_file_path text,
  report_file_path    text,
  checksum_sha256     char(64) NOT NULL,
  metric              jsonb NOT NULL,
  processing          jsonb NOT NULL,
  row_count           integer,
  entity_count        integer,
  period_start        text,
  period_end          text,
  start_year          integer,
  end_year            integer,
  error_count         integer,
  warning_count       integer,
  summary             jsonb,
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz,
  -- Version numbers are unique per dataset; creation also locks the dataset row.
  UNIQUE (dataset_id, version)
);

CREATE INDEX dataset_versions_dataset_created_idx ON dataset_versions (dataset_id, created_at DESC);
CREATE INDEX dataset_versions_processing_idx ON dataset_versions (created_at)
  WHERE status = 'processing';

ALTER TABLE datasets
  ADD CONSTRAINT datasets_latest_version_fk
  FOREIGN KEY (latest_version_id) REFERENCES dataset_versions (id) ON DELETE SET NULL;

-- Dataset.dataSourceIds: every source any of the dataset's valid versions cited.
CREATE TABLE dataset_sources (
  dataset_id     uuid NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
  data_source_id uuid NOT NULL REFERENCES data_sources (id) ON DELETE RESTRICT,
  PRIMARY KEY (dataset_id, data_source_id)
);

CREATE TABLE data_entities (
  id                 uuid PRIMARY KEY,
  dataset_version_id uuid NOT NULL REFERENCES dataset_versions (id) ON DELETE CASCADE,
  key                text NOT NULL,
  name               text COLLATE "und-x-icu" NOT NULL,
  type               text NOT NULL
    CHECK (type IN ('country', 'region', 'company', 'person', 'organization', 'other')),
  category           text,
  image_url          text,
  iso_code           char(3),
  color              char(7),
  logo_asset_id      uuid,
  UNIQUE (dataset_version_id, key)
);

-- Original observations only. Interpolated values are never stored.
CREATE TABLE data_points (
  dataset_version_id uuid NOT NULL REFERENCES dataset_versions (id) ON DELETE CASCADE,
  entity_id          uuid NOT NULL REFERENCES data_entities (id) ON DELETE CASCADE,
  period             text NOT NULL,
  -- Position of `period` in the version's calendar (0-based), for ordering.
  period_position    integer NOT NULL,
  year               integer NOT NULL,
  value              double precision,
  data_source_id     uuid NOT NULL REFERENCES data_sources (id),
  source_row         integer NOT NULL CHECK (source_row >= 2),
  notes              text,
  PRIMARY KEY (dataset_version_id, entity_id, period)
);

CREATE INDEX data_points_version_row_idx ON data_points (dataset_version_id, source_row);
CREATE INDEX data_points_version_period_idx ON data_points (dataset_version_id, period_position);
