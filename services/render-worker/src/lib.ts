/** Library entry: lets the API's integration tests run the real worker in-process. */
export {
  JobSupersededError,
  RenderError,
  classifyError,
  permanentError,
  retryableError,
} from './errors.js';
export {
  CLIP_DBTP,
  EDGE_SECONDS,
  HOT_DBTP,
  audioQualityChecks,
  type AudioMeasurements,
} from './audio-checks.js';
export { prepareTempDirectory, publishFile, sweepTempDirectories } from './files.js';
export {
  createFfmpegTools,
  parseLoudnorm,
  parseProbe,
  topLevelBoxes,
  type Loudness,
  type MediaTools,
  type ProbeResult,
} from './media-tools.js';
export {
  outputProblems,
  runRenderJob,
  type Attempt,
  type PipelineDependencies,
} from './pipeline.js';
export { CANCELLED_MESSAGE, USER_CANCEL_REASON, createRenderProcessor } from './processor.js';
export {
  REMOTION_VERSION,
  createRemotionRenderer,
  glFor,
  type FrameProgress,
  type GlBackend,
  type SelectedComposition,
  type VideoRenderer,
} from './renderer.js';
export { startWorkerRuntime, type WorkerRuntime, type WorkerRuntimeOptions } from './runtime.js';
export { orphanedBrowsers, parseProcessList, reapOrphanedBrowsers } from './browsers.js';
