export { BarChartRace } from './BarChartRace.js';
export { computeRaceLayout, type RaceLayout } from './layout.js';
export {
  ANNOTATION_KIND_LABEL,
  ANNOTATION_MAX_LINES,
  annotationHeight,
  annotationOverflow,
  annotationTypography,
  chartContentRects,
  estimateLines,
  planAnnotations,
  slotRect,
  type AnnotationPlan,
  type AnnotationSlot,
  type PlacedAnnotation,
  type Rect,
  type SkippedAnnotation,
} from './annotations.js';
export { suggestAnnotations } from './suggestions.js';
export { buildCredits, compactSourceLabel, displayUrl, type RaceCredits } from './credits.js';
export {
  MIN_TEXT_PX,
  SHORTS_MAX_SECONDS,
  checkRaceQuality,
  contrastRatio,
  worstStatus,
  type QualityInput,
  type QualityMusicAsset,
} from './quality.js';
export {
  CreditsScene,
  EndCard,
  FinalRankingScene,
  OUTRO_SPLIT_MIN_SECONDS,
  OutroFooter,
  OutroScene,
  endCardFrames,
  type Standing,
} from './scenes.js';
export {
  axisTicks,
  barFraction,
  buildRaceData,
  computeRaceFrame,
  finalStandings,
  fitFontSize,
  formatPeriodLabel,
  initials,
  musicVolumeAt,
  readableTextColor,
  resolveAnnotationTiming,
  resolveAnnotationWindows,
  type AnnotationTimingResult,
  type AnnotationWindow,
  type AxisTick,
  type RaceBar,
  type RaceData,
  type RaceEntity,
  type RaceFrame,
  type RaceKeyframe,
  type RaceValue,
} from './model.js';
export { BackgroundMusic, EditorialAnnotation, IntroCard } from './overlays.js';
export {
  AnimatedBar,
  AnimatedValue,
  BRAND_NAME,
  BRAND_TAGLINE,
  Background,
  EntityLogo,
  EntityName,
  MetricLabel,
  RankNumber,
  SourceCredits,
  StatsopediaBranding,
  StatsopediaMark,
  VideoHeader,
  resolveMediaSrc,
} from './parts.js';
export { RankingContainer, RankingRow } from './ranking-container.js';
export { TimelineProgress, YearIndicator } from './year-indicator.js';
