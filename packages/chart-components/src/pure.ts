/**
 * The parts of the bar chart race without React or Remotion: data model, layout, annotation
 * planning, credits and quality checks. Servers import this entry
 * (`@statsopedia/chart-components/pure`), so they can run the checks without a renderer.
 */
export * from './race/model.js';
export * from './race/layout.js';
export * from './race/annotations.js';
export * from './race/credits.js';
export * from './race/quality.js';
export * from './ranking.js';
export * from './race/suggestions.js';
