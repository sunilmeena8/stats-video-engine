import type { VideoThemeId } from '@statsopedia/shared-types';

export interface VideoTheme {
  id: VideoThemeId;
  name: string;
  mode: 'dark' | 'light';
  background: string;
  /** Slightly lifted plane for cards and the intro/outro panels. */
  surface: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  gridLine: string;
  accent: string;
  fontFamily: string;
  /**
   * Categorical bar colors, assigned to entities in this fixed order (never by rank).
   * Each palette was validated against its own background with the dataviz palette checker
   * (lightness band, chroma, adjacent CVD ΔE ≥ 8, normal-vision ΔE ≥ 15). The `daylight`
   * palette has three hues below 3:1 contrast, which is acceptable only because every bar
   * carries a direct text label — keep labels on when using it.
   */
  barPalette: readonly string[];
}

const SYSTEM_SANS = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const DARK_BAR_PALETTE = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
] as const;

const LIGHT_BAR_PALETTE = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#6250d6',
  '#e34948',
] as const;

export const VIDEO_THEMES: Record<VideoThemeId, VideoTheme> = {
  midnight: {
    id: 'midnight',
    name: 'Midnight',
    mode: 'dark',
    background: '#0b1020',
    surface: '#141b2e',
    textPrimary: '#f0efec',
    textSecondary: '#c3c2b7',
    textMuted: '#898781',
    gridLine: 'rgba(255, 255, 255, 0.08)',
    accent: '#3987e5',
    fontFamily: SYSTEM_SANS,
    barPalette: DARK_BAR_PALETTE,
  },
  graphite: {
    id: 'graphite',
    name: 'Graphite',
    mode: 'dark',
    background: '#1a1a19',
    surface: '#242423',
    textPrimary: '#f0efec',
    textSecondary: '#c3c2b7',
    textMuted: '#898781',
    gridLine: '#2c2c2a',
    accent: '#c98500',
    fontFamily: SYSTEM_SANS,
    barPalette: DARK_BAR_PALETTE,
  },
  daylight: {
    id: 'daylight',
    name: 'Daylight',
    mode: 'light',
    background: '#fcfcfb',
    surface: '#f3f2ee',
    textPrimary: '#0b0b0b',
    textSecondary: '#52514e',
    textMuted: '#898781',
    gridLine: '#e1e0d9',
    accent: '#2a78d6',
    fontFamily: SYSTEM_SANS,
    barPalette: LIGHT_BAR_PALETTE,
  },
};

/**
 * Color for the entity at `entityIndex` (its stable position in the dataset, NOT its rank),
 * so an entity keeps its color as rankings change. Indexes past the palette length repeat
 * colors; identity then relies on the bar's text label, so prefer explicit
 * `DatasetEntity.color` values for datasets with many entities.
 */
export function paletteColor(theme: VideoTheme, entityIndex: number): string {
  const palette = theme.barPalette;
  const color = palette[((entityIndex % palette.length) + palette.length) % palette.length];
  if (color === undefined) throw new Error(`Theme "${theme.id}" has an empty bar palette`);
  return color;
}
