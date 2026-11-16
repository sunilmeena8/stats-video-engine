/**
 * Copies the Inter files the renderer uses from @fontsource/inter into public/fonts/, where
 * Studio, CLI renders and the render worker all serve them via staticFile(). (Importing the
 * .woff2 files from node_modules works in bundled renders but not in the Studio dev server.)
 *
 *   pnpm --filter @statsopedia/renderer fonts:sync
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FONT_FILES } from '../src/font-files';

const require = createRequire(import.meta.url);
const source = path.dirname(require.resolve('@fontsource/inter/package.json'));
const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/fonts');
mkdirSync(target, { recursive: true });
for (const { file } of FONT_FILES)
  copyFileSync(path.join(source, 'files', file), path.join(target, file));
copyFileSync(path.join(source, 'LICENSE'), path.join(target, 'Inter-LICENSE.txt'));
process.stdout.write(`Copied ${FONT_FILES.length} font files and the licence to ${target}\n`);
