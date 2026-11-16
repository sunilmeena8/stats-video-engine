import { spawn } from 'node:child_process';
import path from 'node:path';

import { RenderInternals } from '@remotion/renderer';
import type { AudioAnalysis } from '@statsopedia/shared-types';

/** An audio file the library can use, measured from its decoded samples. */
export interface AudioReport extends AudioAnalysis {
  durationSeconds: number;
}

export class AudioAnalysisError extends Error {
  override name = 'AudioAnalysisError';
}

/** Measures uploads. Injected so tests can run without FFmpeg. */
export interface AudioAnalyzer {
  /** Decodes the whole file (corrupt files are refused) and measures it. */
  analyze(file: string, signal?: AbortSignal): Promise<AudioReport>;
}

interface ProbeJson {
  format?: { duration?: string };
  streams?: { codec_type?: string; codec_name?: string; sample_rate?: string; channels?: number }[];
}

/** Parses the JSON block `loudnorm=print_format=json` writes to stderr ("-inf" = silence). */
export function parseLoudnormBlock(stderr: string): {
  integratedLufs: number | null;
  truePeakDbtp: number | null;
} {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end < start) return { integratedLufs: null, truePeakDbtp: null };
  try {
    const json = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
    const finite = (value: string | undefined, floor: number) => {
      const parsed = Number(value);
      // loudnorm reports silence as -inf, or as its measurement floor.
      return Number.isFinite(parsed) && parsed > floor ? parsed : null;
    };
    return {
      integratedLufs: finite(json.input_i, -70),
      truePeakDbtp: finite(json.input_tp, -99),
    };
  } catch {
    return { integratedLufs: null, truePeakDbtp: null };
  }
}

/** FFmpeg and ffprobe from Remotion's compositor package: no system FFmpeg is needed. */
export function createAudioAnalyzer({
  binariesDirectory = null,
  timeoutMs = 120_000,
}: { binariesDirectory?: string | null; timeoutMs?: number } = {}): AudioAnalyzer {
  const run = (type: 'ffmpeg' | 'ffprobe', args: string[], signal: AbortSignal) =>
    new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const bin = RenderInternals.getExecutablePath({
        type,
        indent: false,
        logLevel: 'warn',
        binariesDirectory,
      });
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
      child.on('close', (code) =>
        code === 0
          ? resolve({ stdout, stderr })
          : reject(
              new AudioAnalysisError(stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300)),
            ),
      );
    });

  return {
    async analyze(file, outer) {
      const signal = outer
        ? AbortSignal.any([outer, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs);
      const { stdout } = await run(
        'ffprobe',
        ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
        signal,
      );
      const probe = JSON.parse(stdout) as ProbeJson;
      const audio = probe.streams?.find((stream) => stream.codec_type === 'audio');
      if (!audio) throw new AudioAnalysisError('The file has no audio stream');
      const duration = Number(probe.format?.duration);
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new AudioAnalysisError('The length of the audio could not be read');
      }
      // One pass decodes every sample (-xerror stops at the first corrupt packet) and
      // measures loudness and true peak.
      const { stderr } = await run(
        'ffmpeg',
        [
          '-hide_banner',
          '-nostats',
          '-xerror',
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
      return {
        durationSeconds: Math.round(duration * 1000) / 1000,
        codec: audio.codec_name ?? 'unknown',
        sampleRate: Number(audio.sample_rate) || 0,
        channels: audio.channels ?? 0,
        ...parseLoudnormBlock(stderr),
      };
    },
  };
}
