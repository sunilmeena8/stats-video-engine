import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { Logger } from '@statsopedia/utils/node';

const run = promisify(execFile);

/** Remotion's Chrome Headless Shell, as installed by `ensureBrowser`. */
const REMOTION_CHROME = /[/\\]\.remotion[/\\]chrome-headless-shell[/\\]/;

export interface ProcessInfo {
  pid: number;
  ppid: number;
  pgid: number;
  command: string;
}

/** Parses `ps -eo pid=,ppid=,pgid=,command=`. */
export function parseProcessList(output: string): ProcessInfo[] {
  return output
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line))
    .filter((match) => match !== null)
    .map(([, pid, ppid, pgid, command]) => ({
      pid: Number(pid),
      ppid: Number(ppid),
      pgid: Number(pgid),
      command: command!,
    }));
}

/**
 * Remotion browsers whose worker is gone: a live browser's parent is the process rendering
 * with it, so a Remotion Chrome adopted by init (parent PID 1) was left behind by a worker that
 * was killed (OOM, `kill -9`, power loss) and will never be used again.
 */
export function orphanedBrowsers(processes: readonly ProcessInfo[]): ProcessInfo[] {
  return processes.filter((process) => process.ppid === 1 && REMOTION_CHROME.test(process.command));
}

/**
 * Kills orphaned Remotion browsers (and their helper processes). Run at start-up, before this
 * worker opens a browser. Skipped where it cannot be decided safely: on Windows, and when this
 * worker is PID 1 itself (a container), where its own browsers would also have parent PID 1.
 */
export async function reapOrphanedBrowsers(logger: Logger): Promise<number> {
  if (process.platform === 'win32' || process.pid === 1) return 0;
  let output: string;
  try {
    ({ stdout: output } = await run('ps', ['-eo', 'pid=,ppid=,pgid=,command='], {
      maxBuffer: 16 * 1024 * 1024,
    }));
  } catch (error) {
    logger.warn({ err: error }, 'Could not list processes to find orphaned browsers');
    return 0;
  }
  const orphans = orphanedBrowsers(parseProcessList(output));
  for (const orphan of orphans) {
    try {
      // Chrome leads its own process group; killing the group takes its helpers with it.
      process.kill(orphan.pgid === orphan.pid ? -orphan.pid : orphan.pid, 'SIGKILL');
    } catch {
      // Exited meanwhile.
    }
  }
  if (orphans.length) {
    logger.warn({ pids: orphans.map((orphan) => orphan.pid) }, 'Killed orphaned render browsers');
  }
  return orphans.length;
}
