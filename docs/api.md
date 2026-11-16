# Statsopedia API

Base URL: `http://127.0.0.1:4000` (local). Every request and response body is validated against
the Zod schemas in `packages/shared-schemas`; the TypeScript types in `packages/shared-types` are
the reference for every field named below.

## Conventions

- **JSON** request bodies are limited to 1 MB. CSV and media uploads send the raw file as the
  body (see their endpoints).
- **IDs** are UUIDs. Malformed IDs return `400`.
- **Timestamps** are ISO 8601 UTC strings.
- **No filesystem paths.** Responses never contain storage keys or paths. Files are downloaded
  through `downloadUrl` / `thumbnailUrl` fields, which are API paths that require authentication.
- **Errors** always have this shape:

  ```json
  {
    "error": {
      "code": "REVISION_CONFLICT",
      "message": "The project changed since you loaded it",
      "issues": []
    }
  }
  ```

  `issues` is present for validation errors (`400 VALIDATION_ERROR`) and lists Zod issues with
  their `path`.

## Authentication

```http
POST /api/auth/login
Content-Type: application/json

{ "email": "editor@example.com", "password": "…" }
```

Returns `{ token, expiresAt, user }`. Send the token on every other request:

```http
Authorization: Bearer <token>
```

| Endpoint                | Purpose                                 |
| ----------------------- | --------------------------------------- |
| `POST /api/auth/login`  | Exchange email and password for a token |
| `GET /api/auth/me`      | The signed-in user                      |
| `POST /api/auth/logout` | Revoke the current token (`204`)        |

- Tokens are opaque random strings. The server stores only their SHA-256 hash. They expire after
  `SESSION_TTL_HOURS` (default 12).
- Wrong email and wrong password both return `401 INVALID_CREDENTIALS`, and take the same time.
- Login is rate-limited to 50 attempts per IP and 10 per account in each 15-minute window.
- Passwords are hashed with scrypt (N = 2¹⁵, r = 8, p = 1, 16-byte salt).
- There is no sign-up endpoint. Users are created by the seed script (`pnpm --filter
@statsopedia/api db:seed`).

### Roles

| Role     | Can                                                                                |
| -------- | ---------------------------------------------------------------------------------- |
| `viewer` | Every `GET`, including downloads and SSE streams                                   |
| `editor` | Everything a viewer can, plus every write (create, import, upload, render, cancel) |
| `admin`  | Everything                                                                         |

A write without the required role returns `403 FORBIDDEN`.

### Limits

| Limit                        | Default                                | Error                |
| ---------------------------- | -------------------------------------- | -------------------- |
| Requests per IP and per user | 600 / minute (`RATE_LIMIT_PER_MINUTE`) | `429 RATE_LIMITED`   |
| Uploads per user             | 120 / hour (`UPLOADS_PER_HOUR`)        | `429 RATE_LIMITED`   |
| CSV size                     | 50 MB (`MAX_UPLOAD_BYTES`)             | `413 FILE_TOO_LARGE` |
| Media size                   | 25 MB (`MAX_MEDIA_BYTES`)              | `413 FILE_TOO_LARGE` |

A `429` response includes a `Retry-After` header.

## Topics and templates

| Endpoint             | Role   | Purpose                                                                               |
| -------------------- | ------ | ------------------------------------------------------------------------------------- |
| `GET /api/topics`    | viewer | `{ topics }`                                                                          |
| `POST /api/topics`   | editor | `{ name, slug?, description? }` → `201`; `409 SLUG_TAKEN`                             |
| `GET /api/templates` | viewer | `{ templates }`: active templates with `version`, `compositionId`, `supportedFormats` |

Templates are versioned: a project records the template version it was created with.

## Datasets

| Endpoint                                               | Role   | Purpose                                                            |
| ------------------------------------------------------ | ------ | ------------------------------------------------------------------ |
| `GET /api/datasets`                                    | viewer | Datasets with their latest valid version                           |
| `POST /api/datasets`                                   | editor | `{ title, slug?, topicId?, unit?, metric?, processing? }` → `201`  |
| `GET /api/datasets/:id`                                | viewer | Dataset, latest valid version, last upload                         |
| `GET /api/datasets/:id/versions`                       | viewer | Every version, newest first                                        |
| `POST /api/datasets/:id/import?filename=x.csv`         | editor | Upload a CSV as a new immutable version and process it             |
| `POST /api/datasets/:id/validate?filename=x.csv`       | editor | Validate a CSV without storing anything                            |
| `GET /api/datasets/:id/preview`                        | viewer | Summary, issues, top N for a period, stored rows (paged)           |
| `GET /api/datasets/:id/versions/:versionId/normalized` | viewer | The version's animation-ready JSON (what renders and previews use) |
| `POST /api/datasets/:id/versions/:versionId/reprocess` | editor | Process the stored original again, as a new version                |

- **CSV uploads.** Send `Content-Type: text/csv` and the file as the raw body. Only `.csv` names
  and text content are accepted (`415 INVALID_FILE_TYPE`).
- **Invalid CSVs.** An import returns `201` even when the CSV is invalid. The version is recorded
  with `validationStatus: "invalid"` and its report.
- **Preview query.** `preview` accepts `entity` (rows whose entity id or name contains it), `versionId`, `period`, `top` (≤ 50),
  `issuesOffset`/`issuesLimit` and `rowsOffset`/`rowsLimit` (≤ 500).

## Media

| Endpoint                                     | Role   | Purpose                                            |
| -------------------------------------------- | ------ | -------------------------------------------------- |
| `GET /api/media?type=music&category=ambient` | viewer | `{ assets }`, newest first (both filters optional) |
| `GET /api/media/:id`                         | viewer | One asset                                          |
| `GET /api/media/:id/file`                    | viewer | The file (supports `Range`)                        |
| `POST /api/media?type=music&filename=…&…`    | editor | Upload (raw body) → `201`                          |
| `PATCH /api/media/:id`                       | editor | Correct name, category or licensing                |

- **Type detection.** The file type comes from its content, not from its name or `Content-Type`.
- **Accepted types:**
  - `music`: WAV, MP3, OGG, M4A
  - `logo` and `image`: PNG, JPEG, WebP
  - `font`: WOFF2
- **Rejected files.** SVG and anything else returns `415 INVALID_FILE_TYPE`.
- **Query parameters.**
  - `name`, `licenseType` (`royalty_free`, `creative_commons`, `public_domain`, `commercial`,
    `original`, `other`), `license`, `attribution`, `attributionRequired=true|false`,
    `licenseReference`.
  - Music also requires `category` (`corporate`, `cinematic`, `technology`, `energetic`,
    `ambient`, `documentary`), `licenseType` and `commercialUse=true|false`.
  - `attributionRequired=true` requires `attribution`.
- **Music is decoded and measured.**
  - Corrupt audio: `422 INVALID_AUDIO`.
  - Outside 5 s to 30 min: `422 INVALID_AUDIO_LENGTH`.
  - Silence: `422 SILENT_AUDIO`.
  - The asset's `audio` holds codec, sample rate, channels, `integratedLufs` and `truePeakDbtp`.
- **Asset fields.** `fileFormat`, `category`, `audio`, `licenseType`, `license`,
  `commercialUse`, `attributionRequired`, `attribution`, `licenseReference`, `uploadedAt`.
- **Licensing edits.** `PATCH` cannot change the file; the merged result must stay consistent
  (`422 ATTRIBUTION_TEXT_REQUIRED`, `CATEGORY_NOT_MUSIC`). Renders keep the license copy they
  were submitted with (`manifest.musicLicense`).
- **Older tracks.** `pnpm --filter @statsopedia/api media:analyze` measures tracks uploaded
  before analysis.

See [storytelling.md](storytelling.md) for music playback, annotations, scenes and the quality
checks.

## Video projects

A project pins one **immutable dataset version** and one **template version**, and stores the
full `VideoConfiguration`. That configuration covers:

- periods, `topN`, speed, theme
- `outputMode`: `long`, `short` or `both`
- music, intro and outro
- labels, number format
- annotations

| Endpoint                           | Role   | Purpose                                                                                                                                |
| ---------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/projects`                | viewer | `{ projects }`; filters `topicId`, `status`                                                                                            |
| `POST /api/projects`               | editor | Create → `201`                                                                                                                         |
| `GET /api/projects/:id`            | viewer | `{ project, renders, jobs, outputs }`                                                                                                  |
| `POST /api/projects/:id/duplicate` | editor | Copy name, topic and configuration into a new draft → `201`                                                                            |
| `DELETE /api/projects/:id`         | editor | Delete a draft (no final renders, nothing running) and its previews → `204`; otherwise `409 PROJECT_NOT_DRAFT` / `RENDERS_IN_PROGRESS` |
| `PUT /api/projects/:id`            | editor | Replace name, topic and configuration                                                                                                  |
| `POST /api/projects/:id/preview`   | editor | Queue 720p preview renders                                                                                                             |
| `POST /api/projects/:id/render`    | editor | Queue final renders                                                                                                                    |

### Create

```json
{
  "name": "Richest people 2000–2024",
  "topicId": "…",
  "configuration": {
    "datasetVersionId": "…",
    "templateId": "…",
    "outputMode": "both",
    "music": { "assetId": "…", "volume": 0.6, "fadeInSeconds": 2, "fadeOutSeconds": 3 }
  }
}
```

- **Required fields.** Only `datasetVersionId` and `templateId` are required. Everything else
  takes a default; the title and unit label default from the dataset.
- **Checks inside the creating transaction:**
  - the version is `ready`
  - the template is active and supports the formats of `outputMode`
  - the periods and annotation periods exist in the version
  - the music asset exists and is of type `music`
- **Check errors** return `422` with these codes: `UNKNOWN_DATASET_VERSION`,
  `VERSION_NOT_READY`, `UNKNOWN_TEMPLATE`, `FORMAT_NOT_SUPPORTED`, `UNKNOWN_PERIOD`,
  `INVALID_PERIOD_RANGE`, `UNKNOWN_MUSIC` and `UNKNOWN_TOPIC`.

### Update (optimistic locking)

`PUT` takes `{ revision, name, topicId, configuration }` with the **complete** configuration.

- If `revision` is not the current one, the update returns `409 REVISION_CONFLICT`, with the
  current revision in `issues`.
- A successful update increments `revision`.
- Renders already queued keep the configuration they were submitted with.

### Status

A project's `status` is derived from its final render jobs. The first matching rule wins:

| Status      | When                                                    |
| ----------- | ------------------------------------------------------- |
| `archived`  | The project is archived (kept as is)                    |
| `rendering` | A final job is queued or rendering                      |
| `failed`    | The most recent final job that was not cancelled failed |
| `rendered`  | At least one final video exists                         |
| `draft`     | Otherwise                                               |

Previews never change the status.

## Renders

`POST /api/projects/:id/preview` and `POST /api/projects/:id/render` take an optional body
`{ "formats": ["long"] }`. Each submission creates a **render request**:

| Request `type` | From                                       | Jobs                                                |
| -------------- | ------------------------------------------ | --------------------------------------------------- |
| `preview`      | `/preview`                                 | One per format, at 720p                             |
| `long_form`    | `/render` with `formats: ["long"]`         | One long-form (16:9) job                            |
| `short`        | `/render` with `formats: ["short"]`        | One Shorts (9:16) job                               |
| `both`         | `/render` on an `outputMode: both` project | A long-form and a Shorts job, tracked independently |

- **Formats.** The default is every format of the project's `outputMode`. A format outside the
  mode returns `422 FORMAT_NOT_IN_MODE`.
- **Final renders** run at the configured resolution with deterministic software GL: the same
  input renders to the same bytes. Previews use Chrome's faster default GL.
- **Render version.** Every request gets the project's next render version. Output files are
  named from the project id, format and version (`<projectId>_long_v3.mp4`), never from a title,
  and a finished file is never overwritten.

The response is `{ request, replayed }` with status `202` (new) or `200` (replayed). `request`
is a `RenderRequest`: `{ id, type, kind, formats, renderVersion, status, percent, jobs, … }`.

### What a submission does

1. Validates the project and builds the exact renderer input (`BarChartRaceProps`) with the
   shared `buildRaceConfig`. Invalid input returns `422 INVALID_RENDER_INPUT`; nothing is
   queued.
2. Records, in one transaction, the request, one **render manifest** per format (template
   version, dataset version, music asset, race config, SHA-256 of the input props), one job per
   format and their first log entries.
3. Adds the jobs to the preview or production queue. The queue carries only identifiers: the
   worker loads everything from PostgreSQL and refuses to render if the input props no longer
   match the manifest's checksum. If Redis is unreachable the jobs are marked `failed`
   (`QUEUE_UNAVAILABLE`) and the call returns `503 QUEUE_UNAVAILABLE`; submit again later.

### Idempotency

Send `Idempotency-Key: <8–128 chars of A-Z a-z 0-9 _ . : ->` to make retries safe.

- **Same key, same request.** Repeating the request (same kind, formats and project revision)
  returns the original request with `replayed: true`, even for concurrent requests.
- **Same key, different request.** Returns `409 IDEMPOTENCY_KEY_REUSED`.
- **No key.** An identical request that is still unfinished is returned instead of queuing a
  duplicate.

### Render requests

| Endpoint                       | Role   | Purpose                                                 |
| ------------------------------ | ------ | ------------------------------------------------------- |
| `GET /api/renders/:id`         | viewer | `{ request, outputs }`                                  |
| `POST /api/renders/:id/cancel` | editor | Cancels every unfinished job of the request             |
| `GET /api/renders/:id/events`  | viewer | Server-Sent Events: aggregate state and both jobs' logs |

**Aggregate status and progress.** `percent` is the average of the jobs (finished jobs count as
100), so it only grows. `status` is:

| Status        | When                                                 |
| ------------- | ---------------------------------------------------- |
| `pending`     | No job has started                                   |
| `in_progress` | Any job is unfinished                                |
| `completed`   | Every job completed                                  |
| `partial`     | Some jobs completed, others failed or were cancelled |
| `failed`      | No job completed and at least one failed             |
| `cancelled`   | Every job was cancelled                              |

### Jobs

| Endpoint                    | Role   | Purpose                                                                                                                                                  |
| --------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/jobs`             | viewer | `{ jobs }`; filters `projectId`, `status`, `limit` (≤ 200)                                                                                               |
| `GET /api/jobs/events`      | viewer | Server-Sent Events for the whole queue: a `job` event whenever any job changes (coalesced per 250 ms)                                                    |
| `GET /api/jobs/:id`         | viewer | `{ job, manifest, output, events }` (last 100 log entries)                                                                                               |
| `POST /api/jobs/:id/retry`  | editor | Render a failed or cancelled job's format again as a new request (current project configuration, next render version); `409 JOB_NOT_RETRYABLE` otherwise |
| `POST /api/jobs/:id/cancel` | editor | Cancel; `409 JOB_FINISHED` if already completed or failed                                                                                                |
| `GET /api/jobs/:id/events`  | viewer | Server-Sent Events progress stream                                                                                                                       |

**Lifecycle.** A job's `status` is one of:

```
pending → validating → preparing → rendering → post_processing → completed
```

plus `failed` and `cancelled`. An unfinished job may also go back to `pending` (waiting for a
retry, or returned by a stopping worker) or restart at `validating` (a new attempt). Finished
jobs never change: PostgreSQL rejects any other transition, and a job cannot complete without
a stored output.

| Status            | The worker is…                                                                |
| ----------------- | ----------------------------------------------------------------------------- |
| `validating`      | Loading the job and checking the dataset version, manifest and assets         |
| `preparing`       | Rebuilding the input props, checking their checksum, choosing the composition |
| `rendering`       | Rendering frames with Remotion (progress follows the frames)                  |
| `post_processing` | Encoding checks, faststart, loudness, full decode test, thumbnail, metadata   |

**Other job fields:** `percent` (0–100), `message`, `attempts` / `maxAttempts`, `errorCode`,
`errorMessage`, `cancelRequestedAt`, `renderVersion`, `requestId`, `outputId`.

**Error codes** (`errorCode`): retryable ones are retried while attempts remain; the others
fail at once.

| Retryable                                                                                            | Permanent                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RENDER_FAILED`, `RENDER_TIMEOUT`, `OUTPUT_INVALID`, `STORAGE_FAILED` (disk full), `DATABASE_FAILED` | `INVALID_PAYLOAD`, `JOB_NOT_FOUND`, `DATASET_NOT_READY`, `DATASET_MISSING`, `ASSET_MISSING`, `INVALID_PROPS`, `PROPS_MISMATCH`, `COMPOSITION_MISMATCH`, `OUTPUT_EXISTS` |

`WORKER_CRASHED` (a worker stopped responding twice), `QUEUE_LOST`, `QUEUE_UNAVAILABLE` and
`CANCELLED` are recorded by the API.

**Retries.**

- Final renders: 3 attempts, with exponential backoff starting at 30 s.
- Previews: 2 attempts, 10 s apart.
- A worker crash does not use up an attempt: the job is recovered by another worker once the
  crashed worker's lock expires (about 90 s with the default settings). A second crash fails it.

**Cancellation.**

- A queued job is removed from the queue at once.
- An active job is stopped by its worker, which records `cancelled` and deletes its temporary
  and partial files.
- A cancelled job never runs again, even if it was already back in the queue for a retry.

**Manifest.** `manifest.raceConfig` is the renderer configuration. Its music appears as
`{ volume, fadeInSeconds, fadeOutSeconds, loop, downloadUrl }`.

### Progress streams (SSE)

```http
GET /api/jobs/:id/events        (one job)
GET /api/renders/:id/events     (a request: aggregate state, every job's log)
Authorization: Bearer <token>
Accept: text/event-stream
```

| Event   | `id`         | `data`                                                              |
| ------- | ------------ | ------------------------------------------------------------------- |
| `state` | —            | The job or request (sent first, and whenever it changes)            |
| `log`   | log entry id | `{ id, renderJobId, at, level, status, percent, message }`          |
| `end`   | —            | `{ job, output }` or `{ request, outputs }`; then the stream closes |

- **Delivery.** Workers write progress to PostgreSQL, which notifies the API
  (`NOTIFY render_changes`); every API instance streams from the database.
- **Reconnecting.** Send `Last-Event-ID` with the last `log` id you received. Only the entries
  you missed are sent, without duplicates.
- **Finished jobs.** Connecting to a finished job sends its state, the log and `end`
  immediately.
- **Heartbeat.** A comment line every 15 s keeps proxies from closing the connection.
- **Browsers.** `EventSource` cannot send an `Authorization` header. Proxy the stream through a
  server, as the dashboard does.

### Outputs

| Endpoint                         | Role   | Purpose                                                                                                                                     |
| -------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/outputs`               | viewer | Generated videos, newest first, with `title`, `projectName`, `datasetTitle`, `datasetVersion`; filters `kind`, `projectId`, `limit` (≤ 500) |
| `GET /api/outputs/:id`           | viewer | Video metadata                                                                                                                              |
| `GET /api/outputs/:id/download`  | viewer | The MP4 (supports `Range`, for seeking)                                                                                                     |
| `GET /api/outputs/:id/thumbnail` | viewer | JPEG frame from just before the outro                                                                                                       |

An output has `width`, `height`, `durationSeconds`, `fps`, `codec`, `fileSizeBytes`,
`checksumSha256`, `renderVersion`, `downloadUrl`, `thumbnailUrl` and `metadata`:

- `timingsMs`: validating, preparing, rendering, post-processing and total
- `resources`: CPU time and peak memory of the worker process (Chrome runs in its own
  processes and is not included)
- `audio`: codec, sample rate, channels, integrated loudness (LUFS) and true peak (dBTP)
- `faststart`, `pixelFormat`, `gl`, `concurrency`, `attempt`, `workerId`, `remotionVersion`
- what was rendered: `compositionId`, `durationInFrames`, `datasetVersionId`,
  `templateVersion`, `propsChecksum`

## Overview stats

`GET /api/stats` (viewer): dataset and project counts, render jobs by outcome (`completed`, `pending` = unfinished, `failed`, `cancelled`), stored videos, and storage usage per area (`datasets`, `processed`, `assets`, `renders`, `thumbnails`, `logs`, `temp`) with the volume's size and free space. Storage is measured at most once a minute.

## Health

These endpoints need no authentication.

- `GET /health`: liveness.
- `GET /health/ready`: PostgreSQL and Redis. Returns `503` when either is down.

## Error codes

| Status | Codes                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`, `BAD_REQUEST`, `EMPTY_FILE`, `UNKNOWN_PERIOD` (dataset preview)                                                                                                                                                                                                   |
| 401    | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`                                                                                                                                                                                                                                              |
| 403    | `FORBIDDEN`                                                                                                                                                                                                                                                                           |
| 404    | `NOT_FOUND`                                                                                                                                                                                                                                                                           |
| 409    | `SLUG_TAKEN`, `REVISION_CONFLICT`, `IDEMPOTENCY_KEY_REUSED`, `JOB_FINISHED`, `ORIGINAL_FILE_CHANGED`                                                                                                                                                                                  |
| 413    | `FILE_TOO_LARGE`                                                                                                                                                                                                                                                                      |
| 415    | `INVALID_FILE_TYPE`, `UNSUPPORTED_MEDIA_TYPE`                                                                                                                                                                                                                                         |
| 422    | `UNKNOWN_*`, `VERSION_NOT_READY`, `FORMAT_NOT_SUPPORTED`, `FORMAT_NOT_IN_MODE`, `INVALID_PERIOD_RANGE`, `INVALID_RENDER_INPUT`, `QUALITY_CHECK_FAILED` (`details.checks`), `INVALID_AUDIO`, `INVALID_AUDIO_LENGTH`, `SILENT_AUDIO`, `ATTRIBUTION_TEXT_REQUIRED`, `CATEGORY_NOT_MUSIC` |
| 429    | `RATE_LIMITED`                                                                                                                                                                                                                                                                        |
| 503    | `QUEUE_UNAVAILABLE`, `PROCESSOR_UNAVAILABLE`, `DATABASE_NOT_MIGRATED`                                                                                                                                                                                                                 |
| 500    | `INTERNAL_ERROR`; details are logged, never returned                                                                                                                                                                                                                                  |
