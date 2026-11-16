/**
 * Statsopedia dashboard design tokens (dark theme). Single source of truth: the dashboard turns
 * these into CSS custom properties with `toCssVariables`, and the React primitives here read
 * them directly. Video themes are separate (see `@statsopedia/video-config`).
 */
export const tokens = {
  color: {
    // Deep navy, layered: canvas < surface < raised. Elevation comes from tone, not shadows.
    canvas: '#060a14',
    surface: '#0b1222',
    surfaceRaised: '#111a2f',
    surfaceSunken: '#080e1b',
    border: 'rgba(148, 170, 255, 0.09)',
    borderStrong: 'rgba(148, 170, 255, 0.18)',
    textPrimary: '#f3f6fd',
    textSecondary: '#a7b1c8',
    textMuted: '#6c7893',
    // Electric blue: actions, focus and the active state. Used sparingly.
    accent: '#3d8bff',
    accentStrong: '#62a2ff',
    accentSoft: 'rgba(61, 139, 255, 0.14)',
    accentGlow: 'rgba(61, 139, 255, 0.35)',
    // Status colors are reserved for state and always paired with an icon and a text label.
    statusGood: '#22b573',
    statusWarning: '#f5b324',
    statusCritical: '#f0525a',
    statusInfo: '#7aa7ff',
  },
  font: {
    sans: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  },
  radius: {
    sm: '6px',
    md: '10px',
    lg: '14px',
    xl: '20px',
  },
  space: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '40px',
  },
} as const;

export type Tokens = typeof tokens;

function kebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

/** Flattens tokens into CSS custom properties, e.g. `color.textPrimary` → `--sp-color-text-primary`. */
export function toCssVariables(source: Tokens = tokens): Record<`--sp-${string}`, string> {
  const variables: Record<`--sp-${string}`, string> = {};
  for (const [group, values] of Object.entries(source)) {
    for (const [name, value] of Object.entries(values as Record<string, string>)) {
      variables[`--sp-${kebabCase(group)}-${kebabCase(name)}`] = value;
    }
  }
  return variables;
}
