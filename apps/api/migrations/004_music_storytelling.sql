-- Music library and editorial storytelling.
--
-- media_assets: file format, music category, measured audio (codec, true peak, loudness) and
-- complete licensing metadata. render_manifests: the music license and the quality report as
-- they were when a render was submitted. Stored configurations gain the new fields with values
-- that keep existing videos unchanged.

-- ─── Media assets ──────────────────────────────────────────────────────────────────────────

ALTER TABLE media_assets
  ADD COLUMN file_format          text,
  ADD COLUMN category             text
    CHECK (category IN ('corporate', 'cinematic', 'technology', 'energetic', 'ambient', 'documentary')),
  ADD COLUMN audio                jsonb,
  ADD COLUMN license_type         text
    CHECK (license_type IN ('royalty_free', 'creative_commons', 'public_domain', 'commercial',
                            'original', 'other')),
  ADD COLUMN commercial_use       boolean,
  ADD COLUMN attribution_required boolean NOT NULL DEFAULT false,
  ADD COLUMN license_reference    text;

UPDATE media_assets SET file_format = CASE mime_type
  WHEN 'audio/wav'  THEN 'wav'
  WHEN 'audio/mpeg' THEN 'mp3'
  WHEN 'audio/ogg'  THEN 'ogg'
  WHEN 'audio/mp4'  THEN 'm4a'
  WHEN 'image/png'  THEN 'png'
  WHEN 'image/jpeg' THEN 'jpg'
  WHEN 'image/webp' THEN 'webp'
  WHEN 'font/woff2' THEN 'woff2'
  ELSE split_part(mime_type, '/', 2)
END;
ALTER TABLE media_assets ALTER COLUMN file_format SET NOT NULL;

-- An attribution recorded before this migration was there to be shown: keep showing it.
UPDATE media_assets SET attribution_required = true WHERE coalesce(attribution, '') <> '';

ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_category_is_music CHECK (category IS NULL OR type = 'music'),
  ADD CONSTRAINT media_assets_attribution_text
    CHECK (NOT attribution_required OR coalesce(attribution, '') <> '');
CREATE INDEX media_assets_music_category_idx ON media_assets (category, created_at DESC)
  WHERE type = 'music';

-- ─── Render manifests ──────────────────────────────────────────────────────────────────────

ALTER TABLE render_manifests
  ADD COLUMN music_license jsonb,
  ADD COLUMN quality       jsonb;

-- ─── Stored configurations ─────────────────────────────────────────────────────────────────

-- Annotations written before kinds and citations existed become captions (nothing claims a
-- source they never had); everything else keeps its behaviour.
CREATE FUNCTION pg_temp.upgrade_annotations(annotations jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object('kind', 'caption', 'sources', '[]'::jsonb, 'priority', 'normal') || a
      ORDER BY ordinality),
    '[]'::jsonb)
  FROM jsonb_array_elements(annotations) WITH ORDINALITY AS t(a, ordinality)
$$;

-- Projects: credits off (their videos stay the same length), music keeps looping as before.
UPDATE video_projects SET configuration = configuration || jsonb_build_object(
  'metricDescription', NULL::text,
  'credits', jsonb_build_object('enabled', false, 'durationSeconds', 4, 'showUrls', false),
  'music', CASE WHEN configuration->'music' = 'null'::jsonb THEN 'null'::jsonb
                ELSE (configuration->'music') || '{"loop": true}'::jsonb END,
  'annotations', pg_temp.upgrade_annotations(configuration->'annotations')
);

UPDATE render_manifests SET race_config = race_config || jsonb_build_object(
  'metricDescription', NULL::text,
  'showSourceUrls', false,
  'timing', (race_config->'timing') || '{"creditsSeconds": 0}'::jsonb,
  'music', CASE WHEN race_config->'music' = 'null'::jsonb THEN 'null'::jsonb
                ELSE (race_config->'music') || '{"durationSeconds": null, "attribution": null}'::jsonb END,
  'annotations', pg_temp.upgrade_annotations(race_config->'annotations')
);

UPDATE video_outputs SET metadata = metadata || '{"qualityChecks": []}'::jsonb
WHERE metadata IS NOT NULL;
