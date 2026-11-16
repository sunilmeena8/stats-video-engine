import { createRequire } from 'node:module';

import { bundle } from '@remotion/bundler';
import {
  ensureBrowser,
  makeCancelSignal,
  renderMedia,
  renderStill,
  selectComposition,
} from '@remotion/renderer';
import type { RenderKind } from '@statsopedia/shared-types';
import type { Logger } from '@statsopedia/utils/node';

export const REMOTION_VERSION = (
  createRequire(import.meta.url)('@remotion/renderer/package.json') as { version: string }
).version;

/**
 * GL backend: software (`swangle`) for final renders, which is byte-for-byte reproducible;
 * Chrome's default for previews, which is ~3.5× faster but may differ in a few edge pixels.
 */
export type GlBackend = 'swangle' | null;

export function glFor(kind: RenderKind): GlBackend {
  return kind === 'final' ? 'swangle' : null;
}

export interface SelectedComposition {
  id: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  /** Remotion's own composition object, passed back unchanged when rendering. */
  readonly handle: unknown;
}

export interface FrameProgress {
  renderedFrames: number;
  /** Remotion's overall progress (rendering and encoding), 0–1. */
  progress: number;
}

/** What the pipeline needs from Remotion. Injected so tests run without Chrome. */
export interface VideoRenderer {
  /** Downloads Chrome Headless Shell if needed and bundles the renderer. */
  warmUp(): Promise<void>;
  selectComposition(options: {
    compositionId: string;
    inputProps: Record<string, unknown>;
    gl: GlBackend;
    signal: AbortSignal;
  }): Promise<SelectedComposition>;
  renderVideo(options: {
    composition: SelectedComposition;
    inputProps: Record<string, unknown>;
    output: string;
    kind: RenderKind;
    gl: GlBackend;
    onProgress: (progress: FrameProgress) => void;
    signal: AbortSignal;
  }): Promise<void>;
  renderThumbnail(options: {
    composition: SelectedComposition;
    inputProps: Record<string, unknown>;
    frame: number;
    output: string;
    gl: GlBackend;
    signal: AbortSignal;
  }): Promise<void>;
}

/** Encoder settings. Fixed per kind, so a final render is reproducible. */
const ENCODING: Record<RenderKind, { crf: number; x264Preset: 'veryfast' | 'medium' }> = {
  preview: { crf: 23, x264Preset: 'veryfast' },
  final: { crf: 18, x264Preset: 'medium' },
};

/** Bridges an AbortSignal to Remotion's cancel signal. */
function remotionCancel(signal: AbortSignal) {
  const { cancelSignal, cancel } = makeCancelSignal();
  if (signal.aborted) cancel();
  signal.addEventListener('abort', cancel, { once: true });
  return { cancelSignal, dispose: () => signal.removeEventListener('abort', cancel) };
}

export interface RemotionRendererOptions {
  entryPoint: string;
  logger: Logger;
  /** Browser tabs rendering frames in parallel; null lets Remotion choose (half the CPUs). */
  concurrency: number | null;
  /** How long a single frame may wait on `delayRender` (fonts, images, audio). */
  frameTimeoutMs: number;
  /** FFmpeg/compositor binaries; null uses Remotion's bundled ones. */
  binariesDirectory: string | null;
}

/**
 * Remotion rendering from one bundle built at first use and cached for the process lifetime,
 * so restart the worker after changing renderer code.
 */
export function createRemotionRenderer({
  entryPoint,
  logger,
  concurrency,
  frameTimeoutMs,
  binariesDirectory,
}: RemotionRendererOptions): VideoRenderer {
  let serveUrl: Promise<string> | undefined;
  let browser: Promise<unknown> | undefined;

  const getServeUrl = (): Promise<string> => {
    serveUrl ??= (async () => {
      const started = performance.now();
      logger.info({ entryPoint }, 'Bundling renderer');
      const url = await bundle({ entryPoint });
      logger.info({ durationMs: Math.round(performance.now() - started) }, 'Renderer bundled');
      return url;
    })().catch((error: unknown) => {
      serveUrl = undefined; // let the next job retry
      throw error;
    });
    return serveUrl;
  };
  const getBrowser = () => {
    browser ??= ensureBrowser({ logLevel: 'warn' }).catch((error: unknown) => {
      browser = undefined;
      throw error;
    });
    return browser;
  };
  const chromium = (gl: GlBackend) => (gl ? { gl } : {});
  type RemotionComposition = Awaited<ReturnType<typeof selectComposition>>;

  return {
    async warmUp() {
      await getBrowser();
      await getServeUrl();
    },

    async selectComposition({ compositionId, inputProps, gl, signal }) {
      await getBrowser();
      const url = await getServeUrl();
      signal.throwIfAborted();
      const composition = await selectComposition({
        serveUrl: url,
        id: compositionId,
        inputProps,
        logLevel: 'warn',
        timeoutInMilliseconds: frameTimeoutMs,
        chromiumOptions: chromium(gl),
        binariesDirectory,
      });
      signal.throwIfAborted();
      return {
        id: composition.id,
        width: composition.width,
        height: composition.height,
        fps: composition.fps,
        durationInFrames: composition.durationInFrames,
        handle: composition,
      };
    },

    async renderVideo({ composition, inputProps, output, kind, gl, onProgress, signal }) {
      const { cancelSignal, dispose } = remotionCancel(signal);
      try {
        await renderMedia({
          serveUrl: await getServeUrl(),
          composition: composition.handle as RemotionComposition,
          inputProps,
          outputLocation: output,
          codec: 'h264',
          pixelFormat: 'yuv420p',
          audioCodec: 'aac',
          audioBitrate: '192k',
          ...ENCODING[kind],
          concurrency,
          timeoutInMilliseconds: frameTimeoutMs,
          overwrite: true,
          logLevel: 'warn',
          cancelSignal,
          chromiumOptions: chromium(gl),
          binariesDirectory,
          onProgress: ({ progress, renderedFrames }) => onProgress({ progress, renderedFrames }),
        });
      } finally {
        dispose();
      }
    },

    async renderThumbnail({ composition, inputProps, frame, output, gl, signal }) {
      const { cancelSignal, dispose } = remotionCancel(signal);
      try {
        await renderStill({
          serveUrl: await getServeUrl(),
          composition: composition.handle as RemotionComposition,
          inputProps,
          frame,
          output,
          imageFormat: 'jpeg',
          jpegQuality: 85,
          overwrite: true,
          logLevel: 'warn',
          cancelSignal,
          timeoutInMilliseconds: frameTimeoutMs,
          chromiumOptions: chromium(gl),
          binariesDirectory,
        });
      } finally {
        dispose();
      }
    },
  };
}
