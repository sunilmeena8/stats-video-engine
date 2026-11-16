'use client';

import type { OutputFormat, QualityReport, QualityStatus } from '@statsopedia/shared-types';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

import { StatusPill } from '@/components/ui';
import { FORMAT_LABEL } from '@/lib/status';

import styles from './studio.module.css';

const ICON = { pass: CheckCircle2, warn: AlertTriangle, fail: XCircle } as const;
const COLOR: Record<QualityStatus, string> = {
  pass: 'var(--sp-color-status-good)',
  warn: 'var(--sp-color-status-warning)',
  fail: 'var(--sp-color-status-critical)',
};
const TONE = { pass: 'good', warn: 'warning', fail: 'critical' } as const;

export function summary(report: QualityReport): string {
  const fails = report.checks.filter((check) => check.status === 'fail').length;
  const warns = report.checks.filter((check) => check.status === 'warn').length;
  if (fails) return `${fails} problem${fails === 1 ? '' : 's'} block rendering`;
  if (warns) return `${warns} warning${warns === 1 ? '' : 's'}`;
  return 'All checks pass';
}

/**
 * The quality checks the API runs before rendering, live for the previewed format; other
 * output formats of the project are summarised above them.
 */
export function QualityPanel({
  format,
  reports,
}: {
  format: OutputFormat;
  reports: Partial<Record<OutputFormat, QualityReport>>;
}) {
  const report = reports[format];
  if (!report) return null;
  const others = (Object.entries(reports) as [OutputFormat, QualityReport][]).filter(
    ([other]) => other !== format,
  );
  return (
    <div>
      {others.length ? (
        <div className={styles.formatStatus}>
          {others.map(([other, otherReport]) => (
            <StatusPill
              key={other}
              tone={TONE[otherReport.status]}
              label={`${FORMAT_LABEL[other]}: ${summary(otherReport)}`}
            />
          ))}
        </div>
      ) : null}
      <div className={styles.checks}>
        {report.checks.map((check) => {
          const Icon = ICON[check.status];
          return (
            <div key={check.id} className={styles.check}>
              <Icon size={16} color={COLOR[check.status]} aria-label={check.status} />
              <div>
                <strong>{check.title}</strong>
                <p>{check.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
