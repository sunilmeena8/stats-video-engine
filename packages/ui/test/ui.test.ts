import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Card, StatusBadge, toCssVariables, tokens } from '../src/index.js';

describe('toCssVariables', () => {
  it('flattens tokens into kebab-case custom properties', () => {
    const variables = toCssVariables();
    expect(variables['--sp-color-text-primary']).toBe(tokens.color.textPrimary);
    expect(variables['--sp-radius-lg']).toBe(tokens.radius.lg);
    expect(variables['--sp-font-sans']).toBe(tokens.font.sans);
  });
});

describe('components', () => {
  it('renders a card with its title, description and children', () => {
    const html = renderToStaticMarkup(
      createElement(Card, { title: 'API', description: 'Express backend' }, 'body'),
    );
    expect(html).toContain('API');
    expect(html).toContain('Express backend');
    expect(html).toContain('body');
  });

  it('always renders a text label on status badges', () => {
    const html = renderToStaticMarkup(
      createElement(StatusBadge, { tone: 'critical', label: 'Down' }),
    );
    expect(html).toContain('Down');
  });
});
