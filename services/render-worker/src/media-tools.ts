import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import path from 'node:path';

import { RenderInternals } from '@remotion/renderer';

/** What ffprobe reports about a rendered file. */
export interface ProbeResult {
  formatName: string;
  durationSeconds: number;
  sizeBytes: number;
  video: {
    codec: string;
    width: number;
    height: number;
    fps: number;
    frames: number | null;
    pixelFormat: string;
  } | null;
  audio: { codec: string; sampleRate: number; channels: number } | null;
}

export interface Loudness {
  /** EBU R128 integrated loudness (LUFS). */
  integratedLufs: number | null;
  truePeakDbtp: number | null;
}

/** FFmpeg operations the worker runs after Remotion. Injected so tests need no binaries. */
export interface MediaTools {
  probe(file: string, signal?: AbortSignal): Promise<ProbeResult>;
  /** True when the MP4 index (`moov`) precedes the media data, so playback can start early. */
  isFaststart(file: string): Promise<boolean>;
  /** Copies streams into a new MP4 with the index first (no re-encoding, bit-exact). */
  remuxFaststart(input: string, output: string, signal?: AbortSignal): Promise<void>;
  measureLoudness(file: string, signal?: AbortSignal): Promise<Loudness>;
  /**
   * True peak (dBTP) of `seconds` of audio at the start or the end of the file; null when
   * silent. Used to check that music fades in and out.
   */
  measureEdgePeak(
    file: string,
    edge: 'start' | 'end',
    seconds: number,
    signal?: AbortSignal,
  ): Promise<number | null>;
  /** Decodes every frame and audio sample; throws if anything is corrupt. */
  verifyDecodes(file: string, signal?: AbortSignal): Promise<void>;
}

export class FfmpegError extends Error {
  override name = 'FfmpegError';
}

/** Reads the top-level MP4 box types (a few bytes per box, never the media itself). */
export async function topLevelBoxes(file: string, limit = 16): Promise<string[]> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const header = Buffer.alloc(16);
    const boxes: string[] = [];
    let offset = 0;
    while (offset + 8 <= size && boxes.length < limit) {
      await handle.read(header, 0, 16, offset);
      let boxSize = header.readUInt32BE(0);
      boxes.push(header.toString('latin1', 4, 8));
      if (boxSize === 1) boxSize = Number(header.readBigUInt64BE(8));
      else if (boxSize === 0) break; // extends to the end of the file
      if (boxSize < 8) throw new FfmpegError(`Corrupt MP4 box at byte ${offset}`);
      offset += boxSize;
    }
    return boxes;
  } finally {
    await handle.close();
  }
}

const parseRate = (rate: string | undefined): number => {
  const [numerator, denominator] = (rate ?? '0/1').split('/').map(Number);
  return denominator ? numerator! / denominator : 0;
};

const numberOrNull = (value: unknown): number | null => {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

interface ProbeJson {
  format?: { format_name?: string; duration?: string; size?: string };
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    nb_frames?: string;
    pix_fmt?: string;
    sample_rate?: string;
    channels?: number;
  }[];
}

export function parseProbe(json: ProbeJson): ProbeResult {
  const video = json.streams?.find((stream) => stream.codec_type === 'video');
  const audio = json.streams?.find((stream) => stream.codec_type === 'audio');
  return {
    formatName: json.format?.format_name ?? '',
    durationSeconds: numberOrNull(json.format?.duration) ?? 0,
    sizeBytes: numberOrNull(json.format?.size) ?? 0,
    video: video
      ? {
          codec: video.codec_name ?? '',
          width: video.width ?? 0,
          height: video.height ?? 0,
          fps: parseRate(video.avg_frame_rate),
          frames: numberOrNull(video.nb_frames),
          pixelFormat: video.pix_fmt ?? '',
        }
      : null,
    audio: audio
      ? {
          codec: audio.codec_name ?? '',
          sampleRate: numberOrNull(audio.sample_rate) ?? 0,
          channels: audio.channels ?? 0,
        }
      : null,
  };
}

/** Parses the JSON block `loudnorm=print_format=json` writes to stderr. */
export function parseLoudnorm(stderr: string): Loudness {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end < start) return { integratedLufs: null, truePeakDbtp: null };
  try {
    const json = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
    const finite = (value: string | undefined) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null; // silence reports "-inf"
    };
    return { integratedLufs: finite(json.input_i), truePeakDbtp: finite(json.input_tp) };
  } catch {
    return { integratedLufs: null, truePeakDbtp: null };
  }
}

/**
 * FFmpeg and ffprobe from Remotion's compositor package (no system FFmpeg needed), or from
 * `binariesDirectory` when set. Processes are killed when `signal` aborts.
 */
export function createFfmpegTools({
  binariesDirectory = null,
}: { binariesDirectory?: string | null } = {}): MediaTools {
  const executable = (type: 'ffmpeg' | 'ffprobe') =>
    RenderInternals.getExecutablePath({ type, indent: false, logLevel: 'warn', binariesDirectory });

  const run = (
    type: 'ffmpeg' | 'ffprobe',
    args: string[],
    signal: AbortSignal | undefined,
  ): Promise<{ stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      const bin = executable(type);
      const cwd = path.dirname(bin);
      const child = spawn(bin, args, {
        cwd,
        // Remotion's macOS binaries load their libraries from their own directory.
        env:
          process.platform === 'darwin' ? { ...process.env, DYLD_LIBRARY_PATH: cwd } : process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        if (stderr.length < 1_000_000) stderr += chunk;
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new FfmpegError(`${type} exited with ${code}: ${stderr.trim().slice(-500)}`));
      });
    });

  return {
    async probe(file, signal) {
      const { stdout } = await run(
        'ffprobe',
        ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
        signal,
      );
      return parseProbe(JSON.parse(stdout) as ProbeJson);
    },

    async isFaststart(file) {
      const boxes = await topLevelBoxes(file);
      const moov = boxes.indexOf('moov');
      const mdat = boxes.indexOf('mdat');
      return moov >= 0 && (mdat < 0 || moov < mdat);
    },

    async remuxFaststart(input, output, signal) {
      await run(
        'ffmpeg',
        [
          '-v',
          'error',
          '-y',
          '-i',
          input,
          '-map',
          '0',
          '-c',
          'copy',
          '-movflags',
          '+faststart',
          // No encoder version or timestamps in the output: the same input gives the same bytes.
          '-fflags',
          '+bitexact',
          '-flags:v',
          '+bitexact',
          '-flags:a',
          '+bitexact',
          output,
        ],
        signal,
      );
    },

    async measureLoudness(file, signal) {
      const { stderr } = await run(
        'ffmpeg',
        [
          '-hide_banner',
          '-nostats',
          '-i',
          file,
          '-map',
          '0:a:0',
          '-af',
          'loudnorm=print_format=json',
          '-f',
          'null',
          '-',
        ],
        signal,
      );
      return parseLoudnorm(stderr);
    },

    async measureEdgePeak(file, edge, seconds, signal) {
      // Input options, so only the window is decoded: as an output option `loudnorm` would
      // still read (and measure) the audio after it.
      const window = edge === 'start' ? ['-t', String(seconds)] : ['-sseof', `-${seconds}`];
      const { stderr } = await run(
        'ffmpeg',
        [
          '-hide_banner',
          '-nostats',
          ...window,
          '-i',
          file,
          '-map',
          '0:a:0',
          '-af',
          'loudnorm=print_format=json',
          '-f',
          'null',
          '-',
        ],
        signal,
      );
      const peak = parseLoudnorm(stderr).truePeakDbtp;
      return peak !== null && peak > -99 ? peak : null;
    },

    async verifyDecodes(file, signal) {
      const { stderr } = await run(
        'ffmpeg',
        [
          '-v',
          'error',
          '-xerror',
          '-i',
          file,
          '-map',
          '0',
          '-c:v',
          'rawvideo',
          '-c:a',
          'pcm_s16le',
          '-f',
          'null',
          '-',
        ],
        signal,
      );
      if (stderr.trim())
        throw new FfmpegError(`Decoding reported errors: ${stderr.trim().slice(0, 500)}`);
    },
  };
}
