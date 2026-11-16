import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

import { FONT_FILES } from './font-files';

let loading: Promise<void> | undefined;

/**
 * Loads Inter from public/fonts/ (no network), so text renders the same on every machine.
 * staticFile() works identically in Studio, CLI renders and the render worker.
 */
export function loadBrandFonts(): Promise<void> {
  loading ??= Promise.all(
    FONT_FILES.map(({ file, weight, unicodeRange }) =>
      loadFont({
        family: 'Inter',
        url: staticFile(`fonts/${file}`),
        weight,
        format: 'woff2',
        unicodeRange,
      }),
    ),
  ).then(() => undefined);
  return loading;
}
