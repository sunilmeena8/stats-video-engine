import type { ReactElement, ReactNode } from 'react';

import { tokens } from './tokens.js';

export interface CardProps {
  title: string;
  description?: string;
  /** Rendered at the top-right, e.g. a status badge. */
  aside?: ReactNode;
  children?: ReactNode;
}

/** Bordered surface used for every dashboard panel. Server-component safe (no hooks). */
export function Card({ title, description, aside, children }: CardProps): ReactElement {
  return (
    <section
      style={{
        background: tokens.color.surface,
        border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.lg,
        padding: tokens.space.lg,
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.md,
        minWidth: 0,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: tokens.space.md }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3
            style={{
              margin: 0,
              fontSize: '15px',
              fontWeight: 600,
              color: tokens.color.textPrimary,
            }}
          >
            {title}
          </h3>
          {description ? (
            <p
              style={{
                margin: `${tokens.space.xs} 0 0`,
                fontSize: '13px',
                lineHeight: 1.5,
                color: tokens.color.textSecondary,
              }}
            >
              {description}
            </p>
          ) : null}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

export type StatusTone = 'good' | 'warning' | 'critical' | 'neutral';

const TONE_STYLE: Record<StatusTone, { color: string; icon: string }> = {
  good: { color: tokens.color.statusGood, icon: '●' },
  warning: { color: tokens.color.statusWarning, icon: '▲' },
  critical: { color: tokens.color.statusCritical, icon: '✕' },
  neutral: { color: tokens.color.textMuted, icon: '○' },
};

export interface StatusBadgeProps {
  tone: StatusTone;
  /** Always shown: status is never communicated by color alone. */
  label: string;
}

export function StatusBadge({ tone, label }: StatusBadgeProps): ReactElement {
  const { color, icon } = TONE_STYLE[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 10px',
        borderRadius: '999px',
        border: `1px solid ${tokens.color.borderStrong}`,
        background: tokens.color.surfaceRaised,
        color: tokens.color.textPrimary,
        fontSize: '12px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true" style={{ color, fontSize: '10px', lineHeight: 1 }}>
        {icon}
      </span>
      {label}
    </span>
  );
}
