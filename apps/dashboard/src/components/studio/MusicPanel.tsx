'use client';

import {
  MUSIC_CATEGORIES,
  type MediaAsset,
  type MusicCategory,
  type MusicConfiguration,
} from '@statsopedia/shared-types';
import { planMusic, safeMusicGain } from '@statsopedia/video-config';
import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Checkbox, Field, Input, Range, Segmented, StatusPill, Tag } from '@/components/ui';
import { backendUrl } from '@/lib/api/client';
import { formatDuration } from '@/lib/format';
import { MUSIC_CATEGORY_LABEL, commercialUse, loudnessLabel } from '@/lib/media';

import styles from './studio.module.css';

const DEFAULT_MUSIC = { volume: 0.6, fadeInSeconds: 2, fadeOutSeconds: 3, loop: true };
const percent = (value: number) => `${Math.round(value * 100)}%`;

/** Plays one track at a time for previewing in the list. */
function usePreviewAudio() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = (asset: MediaAsset) => {
    if (playing === asset.id) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const element = new Audio(backendUrl(`/media/${asset.id}/file`));
    element.addEventListener('ended', () => setPlaying(null));
    audio.current = element;
    setPlaying(asset.id);
    element.play().catch(() => setPlaying(null));
  };
  return { playing, toggle };
}

/**
 * Background music: choose a track by mood and preview it, then set volume, fades and looping.
 * Shows what the render will do: how the track covers the video and whether its volume is
 * lowered to avoid clipping. The full preview plays it in the Player.
 */
export function MusicPanel({
  music,
  assets,
  video,
  onChange,
}: {
  music: MusicConfiguration | null;
  assets: MediaAsset[];
  /** The previewed video, to show how the track covers it. */
  video: { fps: number; durationInFrames: number } | null;
  onChange: (music: MusicConfiguration | null) => void;
}) {
  const selected = assets.find((asset) => asset.id === music?.assetId) ?? null;
  const [category, setCategory] = useState<MusicCategory | 'all'>(selected?.category ?? 'all');
  const preview = usePreviewAudio();
  const categories = MUSIC_CATEGORIES.filter((item) =>
    assets.some((asset) => asset.category === item),
  );
  const shown = assets.filter((asset) => category === 'all' || asset.category === category);

  const choose = (asset: MediaAsset | null) =>
    onChange(asset ? { ...DEFAULT_MUSIC, ...music, assetId: asset.id } : null);
  const set = (patch: Partial<MusicConfiguration>) => music && onChange({ ...music, ...patch });

  const gain = safeMusicGain(selected?.audio?.truePeakDbtp ?? null);
  const plan =
    music && selected && video
      ? planMusic({ durationSeconds: selected.durationSeconds, loop: music.loop }, video)
      : null;
  const videoSeconds = video ? video.durationInFrames / video.fps : null;

  return (
    <>
      {assets.length === 0 ? (
        <span className={styles.note}>
          No tracks yet. Upload one in the <a href="/media">Media Library</a>.
        </span>
      ) : (
        <>
          {categories.length > 1 ? (
            <div style={{ overflowX: 'auto' }}>
              <Segmented<MusicCategory | 'all'>
                label="Mood"
                value={category}
                onChange={setCategory}
                options={[
                  { value: 'all', label: 'All' },
                  ...categories.map((value) => ({ value, label: MUSIC_CATEGORY_LABEL[value] })),
                ]}
              />
            </div>
          ) : null}
          <div className={styles.trackList} role="radiogroup" aria-label="Track">
            <button
              type="button"
              role="radio"
              aria-checked={!music}
              className={`${styles.track} ${!music ? styles.trackSelected : ''}`}
              onClick={() => choose(null)}
            >
              <span style={{ width: 28 }} />
              <span className={styles.trackName}>No music</span>
              <span />
            </button>
            {shown.map((asset) => {
              const use = commercialUse(asset);
              const isSelected = asset.id === music?.assetId;
              return (
                <div
                  key={asset.id}
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={0}
                  className={`${styles.track} ${isSelected ? styles.trackSelected : ''}`}
                  onClick={() => choose(asset)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      choose(asset);
                    }
                  }}
                >
                  <button
                    type="button"
                    aria-label={
                      preview.playing === asset.id ? `Stop ${asset.name}` : `Play ${asset.name}`
                    }
                    title="Preview"
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      border: '1px solid var(--sp-color-border-strong)',
                      background: 'transparent',
                      color: 'var(--sp-color-accent-strong)',
                      cursor: 'pointer',
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      preview.toggle(asset);
                    }}
                  >
                    {preview.playing === asset.id ? <Pause size={13} /> : <Play size={13} />}
                  </button>
                  <span style={{ minWidth: 0 }}>
                    <span className={styles.trackName} style={{ display: 'block' }}>
                      {asset.name}
                    </span>
                    <span className={styles.trackMeta}>
                      {[
                        asset.category ? MUSIC_CATEGORY_LABEL[asset.category] : 'Uncategorized',
                        asset.durationSeconds ? formatDuration(asset.durationSeconds) : null,
                        loudnessLabel(asset),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <StatusPill tone={use.tone} label={use.label} />
                </div>
              );
            })}
          </div>
        </>
      )}

      {music && selected ? (
        <>
          <Field
            label="Volume"
            aside={
              music.volume > gain
                ? `${percent(music.volume)} → ${percent(gain)}`
                : percent(music.volume)
            }
            hint={
              music.volume > gain
                ? `This track is mastered at ${selected.audio!.truePeakDbtp!.toFixed(1)} dBTP, so it plays at ${percent(gain)} to stay below −1 dBTP.`
                : 'Never amplified: 100% is the track as mastered.'
            }
          >
            {(id) => (
              <Range
                id={id}
                min={0}
                max={1}
                step={0.05}
                value={music.volume}
                onChange={(e) => set({ volume: Number(e.target.value) })}
              />
            )}
          </Field>
          <div className={styles.row}>
            <Field label="Fade in (s)">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={30}
                  step={0.5}
                  value={music.fadeInSeconds}
                  onChange={(e) => set({ fadeInSeconds: Number(e.target.value) })}
                />
              )}
            </Field>
            <Field label="Fade out (s)">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={30}
                  step={0.5}
                  value={music.fadeOutSeconds}
                  onChange={(e) => set({ fadeOutSeconds: Number(e.target.value) })}
                />
              )}
            </Field>
          </div>
          <Checkbox
            label="Loop the track (with crossfades) if it is shorter than the video"
            checked={music.loop}
            onChange={(loop) => set({ loop })}
          />
          {plan && videoSeconds !== null ? (
            <span
              className={`${styles.note} ${plan.coverage === 'too_short' ? styles.noteCritical : plan.coverage === 'unknown' ? styles.noteWarn : ''}`}
            >
              {plan.coverage === 'full'
                ? `The ${formatDuration(selected.durationSeconds!)} track covers the ${formatDuration(videoSeconds)} video and is faded out at the end.`
                : plan.coverage === 'looped'
                  ? `The ${formatDuration(selected.durationSeconds!)} track plays ${plan.plays} times, crossfaded, to cover ${formatDuration(videoSeconds)}.`
                  : plan.coverage === 'too_short'
                    ? `The ${formatDuration(selected.durationSeconds!)} track is shorter than the ${formatDuration(videoSeconds)} video. Turn on looping or choose a longer track.`
                    : 'This track’s length was not measured; run media:analyze or re-upload it.'}
            </span>
          ) : null}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {selected.license ? <Tag>{selected.license}</Tag> : null}
            {selected.attributionRequired ? (
              <span className={styles.note}>Credited in the video: “{selected.attribution}”</span>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
