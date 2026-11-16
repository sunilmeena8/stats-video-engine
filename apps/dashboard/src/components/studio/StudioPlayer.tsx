'use client';

import { Player, type PlayerRef } from '@remotion/player';
import {
  BarChartRace,
  buildRaceData,
  computeRaceLayout,
  planAnnotations,
} from '@statsopedia/chart-components';
import type { BarChartRaceConfig, NormalizedDataset } from '@statsopedia/shared-types';
import { raceScenes, raceStateAtFrame, type RaceRenderPlan } from '@statsopedia/video-config';
import { Pause, Play, SkipBack } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';

import { Button, Range } from '@/components/ui';
import { formatDuration } from '@/lib/format';

import styles from './studio.module.css';

/**
 * Remotion requires composition props to be a type alias assignable to Record<string, unknown>;
 * this is exactly `BarChartRaceProps`, rendered by the same component production renders.
 */
type RaceProps = { dataset: NormalizedDataset; config: BarChartRaceConfig };

function Race(props: RaceProps): ReactElement {
  return <BarChartRace dataset={props.dataset} config={props.config} />;
}

const SCENE_COLOR = {
  intro: '#7aa7ff',
  chart: '#3d8bff',
  outro: '#b48cff',
  credits: '#5fd3b0',
} as const;

/**
 * The real composition in the Remotion Player, with the exact props a render would get, and
 * its music. Play, pause and scrub with the controls, the frame slider or the scene timeline,
 * which also marks where each annotation appears.
 */
export default function StudioPlayer({ props, plan }: { props: RaceProps; plan: RaceRenderPlan }) {
  const player = useRef<PlayerRef>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const last = plan.durationInFrames - 1;
  const portrait = plan.height > plan.width;

  useEffect(() => {
    const current = player.current;
    if (!current) return;
    const onFrame = ({ detail }: { detail: { frame: number } }) => setFrame(detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    current.addEventListener('frameupdate', onFrame);
    current.addEventListener('seeked', onFrame);
    current.addEventListener('play', onPlay);
    current.addEventListener('pause', onPause);
    return () => {
      current.removeEventListener('frameupdate', onFrame);
      current.removeEventListener('seeked', onFrame);
      current.removeEventListener('play', onPlay);
      current.removeEventListener('pause', onPause);
    };
  }, []);

  // A shorter video after an edit: keep the playhead inside it.
  useEffect(() => {
    if (frame > last) player.current?.seekTo(last);
  }, [frame, last]);

  const scenes = raceScenes(plan.timeline);
  // Where the composition will show each annotation (same planning as the render).
  const annotations = useMemo(() => {
    const { dataset, config } = props;
    return planAnnotations({
      annotations: config.annotations,
      data: buildRaceData(dataset, config, () => '#000000'),
      timeline: plan.timeline,
      layout: computeRaceLayout({ width: plan.width, height: plan.height, topN: config.topN }),
      topN: config.topN,
    }).placed;
  }, [props, plan]);

  const current = Math.min(frame, last);
  const state = raceStateAtFrame(plan.timeline, current);
  const periods = props.dataset.timeRange.periods;
  const startIndex = props.config.startPeriod ? periods.indexOf(props.config.startPeriod) : 0;
  const period = periods[startIndex + Math.round(state.position)] ?? '';
  const scene = scenes.find((s) => current >= s.from && current < s.from + s.durationInFrames);
  const showing = annotations.filter(
    (a) => current >= a.from && current < a.from + a.durationInFrames,
  );
  const at = (value: number) => `${(value / plan.durationInFrames) * 100}%`;
  const seek = (target: number) => player.current?.seekTo(Math.max(0, Math.min(last, target)));

  return (
    <div className={styles.playerWrap}>
      <div className={portrait ? styles.stagePortrait : styles.stage}>
        <Player
          ref={player}
          component={Race}
          inputProps={props}
          durationInFrames={plan.durationInFrames}
          compositionWidth={plan.width}
          compositionHeight={plan.height}
          fps={plan.fps}
          controls
          loop
          clickToPlay
          spaceKeyToPlayOrPause
          doubleClickToFullscreen
          showVolumeControls
          style={{ width: '100%', aspectRatio: `${plan.width} / ${plan.height}` }}
          errorFallback={({ error }) => (
            <div className={styles.playerError}>Preview failed: {error.message}</div>
          )}
        />
      </div>
      <div className={styles.scrubber}>
        <Button
          size="sm"
          variant="ghost"
          icon={SkipBack}
          aria-label="Back to start"
          onClick={() => seek(0)}
        />
        <Button
          size="sm"
          variant="secondary"
          icon={playing ? Pause : Play}
          onClick={() => player.current?.toggle()}
        >
          {playing ? 'Pause' : 'Play'}
        </Button>
        <Range
          aria-label="Frame"
          min={0}
          max={last}
          value={current}
          onChange={(event) => seek(Number(event.target.value))}
        />
        <span className={styles.timecode}>
          {formatDuration(current / plan.fps)} / {formatDuration(plan.durationInFrames / plan.fps)}
        </span>
      </div>

      <div
        className={styles.timeline}
        role="slider"
        tabIndex={0}
        aria-label="Scenes"
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={current}
        aria-valuetext={`${scene?.label ?? ''} ${formatDuration(current / plan.fps)}`}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          seek(Math.round(((event.clientX - box.left) / box.width) * plan.durationInFrames));
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? plan.fps * 5 : plan.fps;
          if (event.key === 'ArrowRight') seek(current + step);
          if (event.key === 'ArrowLeft') seek(current - step);
        }}
      >
        {scenes.map((item) => (
          <div
            key={item.id}
            className={styles.scene}
            style={
              {
                width: at(item.durationInFrames),
                '--scene': SCENE_COLOR[item.id],
              } as CSSProperties
            }
            title={`${item.label}: ${formatDuration(item.durationInFrames / plan.fps)}`}
          >
            {item.label}
          </div>
        ))}
        {annotations.map((placed) => (
          <span
            key={placed.annotation.id}
            className={`${styles.marker} ${placed.coveredRanks.length || placed.deferredFrames ? styles.markerWarn : ''}`}
            style={{ left: at(placed.from), width: at(placed.durationInFrames) }}
            title={placed.annotation.title}
          />
        ))}
        <span className={styles.playhead} style={{ left: at(current) }} />
      </div>

      <div className={styles.sceneButtons}>
        {scenes.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={scene?.id === item.id ? 'secondary' : 'ghost'}
            onClick={() =>
              seek(item.id === 'chart' ? item.from : item.from + Math.round(plan.fps * 0.8))
            }
          >
            {item.label}
          </Button>
        ))}
        <span className={styles.estimate}>
          Estimated duration <strong>{formatDuration(plan.durationInFrames / plan.fps)}</strong>
        </span>
      </div>

      <div className={styles.readout}>
        <span>
          Frame <strong>{current}</strong> of {last}
        </span>
        <span>
          {state.phase === 'chart' ? (
            <>
              Period <strong>{period}</strong>
            </>
          ) : (
            <strong>{scene?.label}</strong>
          )}
          {showing.length ? (
            <> · {showing.map((a) => `“${a.annotation.title}”`).join(', ')}</>
          ) : null}
        </span>
        <span>
          {plan.width}×{plan.height} · {plan.fps} fps
          {props.config.music ? ' · with music' : ''}
        </span>
      </div>
    </div>
  );
}
