import { BarChartRace } from '@statsopedia/chart-components';
import { useState, type ReactElement } from 'react';
import { cancelRender, continueRender, delayRender } from 'remotion';

import { loadBrandFonts } from '../../fonts';
import type { RaceCompositionProps } from './schema';

/** Composition wrapper: waits for the bundled fonts, then renders the reusable component. */
export function BarChartRaceComposition(props: RaceCompositionProps): ReactElement {
  const [handle] = useState(() => {
    const id = delayRender('Loading Inter');
    loadBrandFonts()
      .then(() => continueRender(id))
      .catch((error: unknown) => cancelRender(error));
    return id;
  });
  void handle;
  return <BarChartRace dataset={props.dataset} config={props.config} />;
}
