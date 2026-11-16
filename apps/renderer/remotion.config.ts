// Applies to the Remotion CLI only (`remotion studio`, `remotion render`).
// Programmatic renders (services/render-worker) pass their options explicitly.
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);

// Software rendering (SwiftShader via ANGLE): the default GPU backend anti-aliases a few edge
// pixels differently between runs; swangle produces byte-identical frames every time.
Config.setChromiumOpenGlRenderer('swangle');
