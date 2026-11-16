import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';

import { toCssVariables } from '@statsopedia/ui';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'Statsopedia', template: '%s · Statsopedia' },
  description: 'The World, By The Numbers — data-driven ranking videos from historical datasets.',
};

export const viewport: Viewport = {
  themeColor: '#060a14',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={toCssVariables()}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
