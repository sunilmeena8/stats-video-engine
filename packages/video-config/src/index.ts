export {
  DEFAULT_VIDEO_CONFIGURATION,
  createVideoConfiguration,
  formatsForMode,
  type VideoConfigurationDefaults,
  type VideoConfigurationInput,
} from './defaults.js';
export { ASPECT_RATIOS, resolveDimensions, type Dimensions } from './dimensions.js';
export { VIDEO_THEMES, paletteColor, type VideoTheme } from './themes.js';
export {
  FINAL_YEAR_HOLD_SECONDS,
  SECONDS_PER_YEAR,
  computeTimeline,
  yearPositionAtFrame,
  type TimelineInput,
  type VideoTimeline,
  type YearPosition,
} from './timeline.js';
export { EASINGS, ease } from './easing.js';
export {
  computeRaceTimeline,
  frameForPeriod,
  raceScenes,
  raceStateAtFrame,
  type RacePhase,
  type RaceScene,
  type RaceState,
  type RaceTimeline,
} from './race-timeline.js';
export {
  FINAL_HOLD_SECONDS,
  PREVIEW_RESOLUTION,
  TRANSITION_SHARE,
  buildRaceConfig,
  referencedImageAssets,
  type RaceConfigOptions,
} from './race-config.js';
export { planRaceRender, racePeriodCount, type RaceRenderPlan } from './race-plan.js';
export {
  FADE_EDGE_MAX_DBTP,
  LOOP_CROSSFADE_SECONDS,
  MUSIC_MIN_LUFS,
  MUSIC_QUIET_LUFS,
  MUSIC_TRUE_PEAK_CEILING_DBTP,
  crossfadeGain,
  effectiveLoudness,
  planMusic,
  resolveMusicAsset,
  safeMusicGain,
  type MusicCoverage,
  type MusicPlan,
  type MusicSegment,
  type ResolvedMusic,
} from './music.js';
