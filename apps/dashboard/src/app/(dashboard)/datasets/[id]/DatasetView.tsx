'use client';

import type { DatasetVersion, ValidationIssue, ValidationReport } from '@statsopedia/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clapperboard,
  FileUp,
  History,
  ListChecks,
  Search,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';

import { useBreadcrumb } from '@/components/shell/Shell';
import {
  Banner,
  Button,
  ButtonLink,
  DefinitionList,
  EmptyState,
  ErrorBanner,
  Field,
  Grid,
  Input,
  PageHeader,
  Panel,
  QueryState,
  Range,
  Select,
  SkeletonRows,
  StatTile,
  StatusPill,
  Tabs,
  Tag,
  table,
  useToast,
} from '@/components/ui';
import { endpoints } from '@/lib/api/endpoints';
import { keys, useDataset, useNormalized, useVersions } from '@/lib/api/queries';
import {
  VALIDATION_STATUS,
  VERSION_STATUS,
  formatBytes,
  formatCount,
  formatRank,
  formatTimestamp,
  formatValue,
} from '@/lib/format';

type Tab = 'overview' | 'upload' | 'ranking' | 'issues' | 'versions';

export function DatasetView() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const detail = useDataset(id);
  const versions = useVersions(id);
  useBreadcrumb(`/datasets/${id}`, detail.data?.dataset.title);

  const tab = (params.get('tab') as Tab | null) ?? 'overview';
  const selectedId =
    params.get('version') ?? detail.data?.latestVersion?.id ?? detail.data?.lastUpload?.id;
  const selected = versions.data?.find((version) => version.id === selectedId) ?? null;
  const navigate = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <QueryState query={detail}>
      {({ dataset, latestVersion, versionCount }) => (
        <>
          <PageHeader
            title={dataset.title}
            description={
              dataset.description ?? `Unit: ${dataset.unit ?? 'set by the first valid import'}`
            }
            actions={
              <>
                <Button icon={Upload} onClick={() => navigate({ tab: 'upload' })}>
                  Upload CSV
                </Button>
                {latestVersion ? (
                  <ButtonLink
                    href={`/projects/new?dataset=${dataset.id}&version=${latestVersion.id}`}
                    variant="primary"
                    icon={Clapperboard}
                  >
                    Create video project
                  </ButtonLink>
                ) : null}
              </>
            }
          />
          <div
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              marginBottom: 6,
              flexWrap: 'wrap',
            }}
          >
            <Select
              aria-label="Version"
              value={selected?.id ?? ''}
              onChange={(event) => navigate({ version: event.target.value })}
              style={{ width: 280 }}
              disabled={!versions.data?.length}
            >
              {versions.data?.length ? null : <option value="">No versions yet</option>}
              {versions.data?.map((version) => (
                <option key={version.id} value={version.id}>
                  v{version.version} · {VERSION_STATUS[version.status].label} ·{' '}
                  {version.originalFilename}
                  {version.id === latestVersion?.id ? ' (latest valid)' : ''}
                </option>
              ))}
            </Select>
            {selected ? (
              <>
                <StatusPill {...VERSION_STATUS[selected.status]} />
                <StatusPill {...VALIDATION_STATUS[selected.validationStatus]} />
              </>
            ) : null}
          </div>
          <Tabs
            value={tab}
            onChange={(value) => navigate({ tab: value })}
            tabs={[
              { value: 'overview', label: 'Overview' },
              { value: 'ranking', label: 'Ranking preview' },
              {
                value: 'issues',
                label: 'Validation issues',
                count: selected
                  ? (selected.errorCount ?? 0) + (selected.warningCount ?? 0)
                  : undefined,
              },
              { value: 'versions', label: 'Version history', count: versionCount },
              { value: 'upload', label: 'Upload & validate' },
            ]}
          />
          {tab === 'upload' ? (
            <UploadPanel
              datasetId={dataset.id}
              onImported={(version) => navigate({ tab: 'overview', version: version.id })}
            />
          ) : tab === 'versions' ? (
            <VersionsPanel
              versions={versions}
              latestId={latestVersion?.id}
              onSelect={(version) => navigate({ tab: 'overview', version })}
            />
          ) : !selected ? (
            versions.isPending ? (
              <SkeletonRows />
            ) : (
              <Panel>
                <EmptyState
                  icon={FileUp}
                  title="No versions yet"
                  action={
                    <Button
                      variant="primary"
                      size="sm"
                      icon={Upload}
                      onClick={() => navigate({ tab: 'upload' })}
                    >
                      Upload a CSV
                    </Button>
                  }
                >
                  Upload a CSV to create the first version.
                </EmptyState>
              </Panel>
            )
          ) : tab === 'overview' ? (
            <VersionOverview version={selected} />
          ) : tab === 'ranking' ? (
            <RankingPanel datasetId={dataset.id} version={selected} />
          ) : (
            <IssuesPanel datasetId={dataset.id} version={selected} />
          )}
        </>
      )}
    </QueryState>
  );
}

// ─── Overview ────────────────────────────────────────────────────────────────────────────

function VersionOverview({ version }: { version: DatasetVersion }) {
  const summary = version.summary;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {version.status === 'failed' ? (
        <Banner tone="critical" title="Processing failed">
          {version.errorMessage}
        </Banner>
      ) : null}
      {version.validationStatus === 'invalid' ? (
        <Banner tone="critical" title="This version is invalid and cannot be used for videos">
          See the validation issues for row-level details, fix the CSV and upload it again.
        </Banner>
      ) : null}
      <Grid columns="repeat(auto-fit, minmax(150px, 1fr))">
        <StatTile
          icon={ListChecks}
          label="Rows"
          value={formatCount(summary?.rowCount ?? version.rowCount)}
          hint={summary ? `${formatCount(summary.validRowCount)} valid` : undefined}
        />
        <StatTile icon={CheckCircle2} label="Entities" value={formatCount(version.entityCount)} />
        <StatTile
          icon={History}
          label="Periods"
          value={formatCount(summary?.periodCount)}
          hint={
            version.periodRange
              ? `${version.periodRange.start}–${version.periodRange.end}`
              : undefined
          }
        />
        <StatTile
          icon={ShieldCheck}
          tone={version.errorCount ? 'critical' : 'good'}
          label="Errors"
          value={formatCount(version.errorCount)}
        />
        <StatTile
          icon={ShieldCheck}
          tone={version.warningCount ? 'warning' : 'good'}
          label="Warnings"
          value={formatCount(version.warningCount)}
          hint={summary ? `${formatCount(summary.missingValueCount)} missing values` : undefined}
        />
      </Grid>
      <Panel title={`Version ${version.version}`}>
        <DefinitionList
          items={[
            ['File', version.originalFilename],
            ['Size', formatBytes(version.sizeBytes)],
            ['SHA-256', <code key="c">{version.checksumSha256.slice(0, 16)}…</code>],
            ['Uploaded', formatTimestamp(version.createdAt)],
            ['Processed', formatTimestamp(version.processedAt)],
            [
              'Ranking',
              version.metric.rankingOrder === 'asc' ? 'Lowest value first' : 'Highest value first',
            ],
            [
              'Animation data',
              version.hasNormalizedOutput ? 'Ready for video projects' : 'Not available',
            ],
            ...(version.sourceVersionId
              ? ([['Reprocessed from', 'An earlier version']] as [string, string][])
              : []),
          ]}
        />
      </Panel>
    </div>
  );
}

// ─── Upload & validate ───────────────────────────────────────────────────────────────────

function UploadPanel({
  datasetId,
  onImported,
}: {
  datasetId: string;
  onImported: (version: DatasetVersion) => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [report, setReport] = useState<{
    kind: 'validated' | 'imported';
    report: ValidationReport;
  } | null>(null);

  const validate = useMutation({
    mutationFn: (selected: File) => endpoints.validateCsv(datasetId, selected),
    onSuccess: (result) => setReport({ kind: 'validated', report: result.report }),
  });
  const importCsv = useMutation({
    mutationFn: (selected: File) => endpoints.importCsv(datasetId, selected),
    onSuccess: (result) => {
      setReport({ kind: 'imported', report: result.report });
      void client.invalidateQueries({ queryKey: keys.dataset(datasetId) });
      void client.invalidateQueries({ queryKey: keys.datasets });
      if (result.version.validationStatus === 'invalid') {
        toast({
          tone: 'critical',
          title: `Version ${result.version.version} is invalid`,
          detail: 'Its issues are listed below.',
        });
      } else {
        toast({ tone: 'good', title: `Version ${result.version.version} imported` });
        onImported(result.version);
      }
    },
  });
  const choose = (selected: File | undefined) => {
    if (!selected) return;
    setFile(selected);
    setReport(null);
    validate.reset();
    importCsv.reset();
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Panel
        title="Upload a CSV"
        description="Validate first to see problems without creating a version, or import it as the next version."
      >
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            choose(event.dataTransfer.files[0]);
          }}
          style={{
            display: 'grid',
            justifyItems: 'center',
            gap: 10,
            padding: '34px 20px',
            borderRadius: 14,
            border: `1.5px dashed ${dragging ? 'var(--sp-color-accent)' : 'var(--sp-color-border-strong)'}`,
            background: dragging ? 'var(--sp-color-accent-soft)' : 'var(--sp-color-surface-sunken)',
            textAlign: 'center',
          }}
        >
          <FileUp size={26} color="var(--sp-color-accent-strong)" aria-hidden />
          <div style={{ fontWeight: 600 }}>{file ? file.name : 'Drop a CSV file here'}</div>
          <div style={{ color: 'var(--sp-color-text-muted)', fontSize: 12.5 }}>
            {file
              ? formatBytes(file.size)
              : 'Columns: entity_id, entity_name, year, value, unit, source_id (notes optional)'}
          </div>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(event) => choose(event.target.files?.[0])}
          />
          <Button size="sm" onClick={() => input.current?.click()}>
            {file ? 'Choose another file' : 'Choose file'}
          </Button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <Button
            icon={ShieldCheck}
            disabled={!file || importCsv.isPending}
            loading={validate.isPending}
            onClick={() => file && validate.mutate(file)}
          >
            Validate only
          </Button>
          <Button
            variant="primary"
            icon={Upload}
            disabled={!file || validate.isPending}
            loading={importCsv.isPending}
            onClick={() => file && importCsv.mutate(file)}
          >
            Import as new version
          </Button>
        </div>
        <div style={{ marginTop: 12 }}>
          <ErrorBanner error={validate.error ?? importCsv.error} />
        </div>
      </Panel>
      {report ? <ReportView kind={report.kind} report={report.report} /> : null}
    </div>
  );
}

function ReportView({
  kind,
  report,
}: {
  kind: 'validated' | 'imported';
  report: ValidationReport;
}) {
  const status = VALIDATION_STATUS[report.status];
  const { summary } = report;
  return (
    <Panel
      title={kind === 'validated' ? 'Validation result (nothing was stored)' : 'Import result'}
      actions={<StatusPill tone={status.tone} label={status.label} />}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <Grid columns="repeat(auto-fit, minmax(130px, 1fr))">
          {[
            ['Rows', summary.rowCount],
            ['Valid rows', summary.validRowCount],
            ['Entities', summary.entityCount],
            ['Periods', summary.periodCount],
            ['Errors', summary.errorCount],
            ['Warnings', summary.warningCount],
          ].map(([label, value]) => (
            <div key={label as string}>
              <div style={{ fontSize: 12, color: 'var(--sp-color-text-muted)' }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
                {formatCount(value as number)}
              </div>
            </div>
          ))}
        </Grid>
        {report.columns.missing.length ? (
          <Banner tone="critical" title={`Missing columns: ${report.columns.missing.join(', ')}`} />
        ) : null}
        {report.columns.unexpected.length ? (
          <Banner
            tone="warning"
            title={`Ignored columns: ${report.columns.unexpected.join(', ')}`}
          />
        ) : null}
        {report.issues.length ? (
          <IssueTable issues={report.issues} />
        ) : (
          <Banner tone="good" title="No issues found" />
        )}
        {report.issuesTruncated ? (
          <span style={{ fontSize: 12, color: 'var(--sp-color-text-muted)' }}>
            Only the first {report.issues.length} issues are shown; the counts above are complete.
          </span>
        ) : null}
      </div>
    </Panel>
  );
}

function IssueTable({ issues }: { issues: ValidationIssue[] }) {
  return (
    <div className={table.wrap}>
      <table className={table.table}>
        <thead>
          <tr>
            <th>Severity</th>
            <th className={table.num}>Row</th>
            <th>Column</th>
            <th>Issue</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue, index) => (
            <tr key={`${issue.row}-${issue.code}-${index}`}>
              <td>
                <StatusPill
                  tone={
                    issue.severity === 'error'
                      ? 'critical'
                      : issue.severity === 'warning'
                        ? 'warning'
                        : 'info'
                  }
                  label={issue.severity}
                />
              </td>
              <td className={table.num}>{issue.row ?? '—'}</td>
              <td className={table.muted}>{issue.column ?? '—'}</td>
              <td>
                {issue.message}
                <div className={table.muted} style={{ fontSize: 11.5 }}>
                  {issue.code}
                  {issue.entityId ? ` · ${issue.entityId}` : ''}
                </div>
              </td>
              <td>{issue.value === null ? '—' : <code>{issue.value}</code>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Issues of a stored version ──────────────────────────────────────────────────────────

const PAGE = 50;

function IssuesPanel({ datasetId, version }: { datasetId: string; version: DatasetVersion }) {
  const [offset, setOffset] = useState(0);
  const query = {
    versionId: version.id,
    issuesOffset: offset,
    issuesLimit: PAGE,
    rowsLimit: 1,
    top: 1,
  };
  const preview = useQuery({
    queryKey: keys.preview(datasetId, query),
    queryFn: () => endpoints.preview(datasetId, query),
    placeholderData: (previous) => previous,
  });
  return (
    <Panel
      title="Validation issues"
      description="Errors make a version unusable; warnings are informational."
      flush
    >
      <QueryState
        query={preview}
        isEmpty={(data) => data.issues.total === 0}
        empty={
          <EmptyState icon={CheckCircle2} title="No issues">
            Every row of this version passed validation.
          </EmptyState>
        }
      >
        {(data) => (
          <>
            <IssueTable issues={data.issues.items} />
            <Pager offset={offset} total={data.issues.total} onChange={setOffset} />
          </>
        )}
      </QueryState>
    </Panel>
  );
}

function Pager({
  offset,
  total,
  onChange,
  size = PAGE,
}: {
  offset: number;
  total: number;
  onChange: (offset: number) => void;
  size?: number;
}) {
  if (total <= size) return null;
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 18px',
        borderTop: '1px solid var(--sp-color-border)',
      }}
    >
      <span style={{ fontSize: 12.5, color: 'var(--sp-color-text-muted)' }}>
        {formatCount(offset + 1)}–{formatCount(Math.min(offset + size, total))} of{' '}
        {formatCount(total)}
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          size="sm"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - size))}
        >
          Previous
        </Button>
        <Button size="sm" disabled={offset + size >= total} onClick={() => onChange(offset + size)}>
          Next
        </Button>
      </div>
    </div>
  );
}

// ─── Versions ────────────────────────────────────────────────────────────────────────────

function VersionsPanel({
  versions,
  latestId,
  onSelect,
}: {
  versions: ReturnType<typeof useVersions>;
  latestId: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <Panel
      title="Version history"
      description="Versions are immutable; video projects keep using the version they were made with."
      flush
    >
      <QueryState
        query={versions}
        isEmpty={(data) => data.length === 0}
        empty={<EmptyState icon={History} title="No versions yet" />}
      >
        {(data) => (
          <div className={table.wrap}>
            <table className={table.table}>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>File</th>
                  <th>Processing</th>
                  <th>Validation</th>
                  <th className={table.num}>Rows</th>
                  <th className={table.num}>Errors</th>
                  <th className={table.num}>Warnings</th>
                  <th>Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {data.map((version) => (
                  <tr key={version.id}>
                    <td>
                      <button
                        type="button"
                        onClick={() => onSelect(version.id)}
                        className={table.link}
                        style={{
                          background: 'none',
                          border: 0,
                          padding: 0,
                          cursor: 'pointer',
                          font: 'inherit',
                        }}
                      >
                        v{version.version}
                      </button>{' '}
                      {version.id === latestId ? <Tag>latest valid</Tag> : null}
                    </td>
                    <td className={table.muted}>{version.originalFilename}</td>
                    <td>
                      <StatusPill {...VERSION_STATUS[version.status]} />
                    </td>
                    <td>
                      <StatusPill {...VALIDATION_STATUS[version.validationStatus]} />
                    </td>
                    <td className={table.num}>{formatCount(version.rowCount)}</td>
                    <td className={table.num}>{formatCount(version.errorCount)}</td>
                    <td className={table.num}>{formatCount(version.warningCount)}</td>
                    <td className={table.muted}>{formatTimestamp(version.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </Panel>
  );
}

// ─── Ranking preview ─────────────────────────────────────────────────────────────────────

function RankingPanel({ datasetId, version }: { datasetId: string; version: DatasetVersion }) {
  const [period, setPeriod] = useState<string | undefined>(undefined);
  const [top, setTop] = useState(10);
  const [entity, setEntity] = useState('');
  const [rowsOffset, setRowsOffset] = useState(0);
  const term = entity.trim();
  const query = {
    versionId: version.id,
    period,
    top,
    entity: term || undefined,
    rowsOffset,
    rowsLimit: 25,
    issuesLimit: 1,
  };
  const preview = useQuery({
    queryKey: keys.preview(datasetId, query),
    queryFn: () => endpoints.preview(datasetId, query),
    placeholderData: (previous) => previous,
    enabled: version.hasNormalizedOutput,
  });
  const normalized = useNormalized(version.hasNormalizedOutput ? datasetId : undefined, version.id);

  if (!version.hasNormalizedOutput) {
    return (
      <Panel>
        <EmptyState icon={ListChecks} title="No ranking for this version">
          Rankings are computed when a version processes successfully.
        </EmptyState>
      </Panel>
    );
  }

  return (
    <QueryState query={preview}>
      {(data) => {
        const periods = data.periods;
        const index = Math.max(0, periods.indexOf(data.period ?? periods.at(-1) ?? ''));
        const max = Math.max(...data.ranking.map((entry) => Math.abs(entry.value)), 1);
        const matches = (name: string, entityId: string) =>
          !term || `${name} ${entityId}`.toLowerCase().includes(term.toLowerCase());
        return (
          <div style={{ display: 'grid', gap: 16 }}>
            <Panel>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) 140px minmax(200px, 280px)',
                  gap: 16,
                  alignItems: 'end',
                }}
              >
                <Field label="Period" aside={data.period ?? '—'}>
                  {(id) => (
                    <Range
                      id={id}
                      min={0}
                      max={Math.max(0, periods.length - 1)}
                      value={index}
                      onChange={(event) => setPeriod(periods[Number(event.target.value)])}
                    />
                  )}
                </Field>
                <Field label="Show top">
                  {(id) => (
                    <Select
                      id={id}
                      value={top}
                      onChange={(event) => setTop(Number(event.target.value))}
                    >
                      {[5, 10, 15, 20, 30, 50].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Filter entities">
                  {(id) => (
                    <div style={{ position: 'relative' }}>
                      <Search
                        size={15}
                        style={{
                          position: 'absolute',
                          left: 11,
                          top: 11,
                          color: 'var(--sp-color-text-muted)',
                        }}
                        aria-hidden
                      />
                      <Input
                        id={id}
                        placeholder="Name or id"
                        value={entity}
                        onChange={(event) => {
                          setEntity(event.target.value);
                          setRowsOffset(0);
                        }}
                        style={{ paddingLeft: 34 }}
                      />
                    </div>
                  )}
                </Field>
              </div>
            </Panel>
            <Grid columns="repeat(auto-fit, minmax(min(100%, 440px), 1fr))">
              <Panel
                title={`Top ${data.top} in ${data.period ?? '—'}`}
                description={data.unit ?? undefined}
              >
                {data.ranking.length === 0 ? (
                  <EmptyState icon={ListChecks} title="No values in this period" />
                ) : (
                  <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 7 }}>
                    {data.ranking.map((entry, position) => {
                      const tied = data.ranking.some(
                        (other, otherIndex) => otherIndex !== position && other.rank === entry.rank,
                      );
                      const highlighted = term && matches(entry.name, entry.entityId);
                      return (
                        <li
                          key={entry.entityId}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '34px minmax(0, 1fr) 96px',
                            gap: 10,
                            alignItems: 'center',
                            opacity: term && !highlighted ? 0.35 : 1,
                          }}
                        >
                          <span
                            style={{
                              fontWeight: 650,
                              color: 'var(--sp-color-text-muted)',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {formatRank(entry.rank, tied)}
                          </span>
                          <div
                            style={{
                              position: 'relative',
                              height: 26,
                              borderRadius: 6,
                              background: 'rgba(148,170,255,0.06)',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                position: 'absolute',
                                inset: '0 auto 0 0',
                                width: `${(Math.abs(entry.value) / max) * 100}%`,
                                background: highlighted
                                  ? 'linear-gradient(90deg, #2f7bf2, #8ec0ff)'
                                  : 'linear-gradient(90deg, rgba(47,123,242,0.55), rgba(98,162,255,0.8))',
                                borderRadius: 6,
                                transition: 'width 300ms ease',
                              }}
                            />
                            <span
                              style={{
                                position: 'relative',
                                padding: '0 9px',
                                lineHeight: '26px',
                                fontSize: 12.5,
                                fontWeight: 550,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {entry.name}
                              {entry.valueKind !== 'observed' ? ' · est.' : ''}
                            </span>
                          </div>
                          <span
                            style={{
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              fontSize: 12.5,
                            }}
                          >
                            {formatValue(entry.value)}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Panel>
              <RankHistory normalized={normalized} term={term} period={data.period} />
            </Grid>
            <Panel
              title="Records"
              description={term ? `Rows matching “${term}”` : 'Original rows of the CSV'}
              flush
            >
              {data.observations.items.length === 0 ? (
                <EmptyState icon={Search} title="No matching records" />
              ) : (
                <>
                  <div className={table.wrap}>
                    <table className={table.table}>
                      <thead>
                        <tr>
                          <th className={table.num}>Row</th>
                          <th>Entity</th>
                          <th>Period</th>
                          <th className={table.num}>Value</th>
                          <th>Source</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.observations.items.map((row) => (
                          <tr key={row.row}>
                            <td className={`${table.num} ${table.muted}`}>{row.row}</td>
                            <td>
                              {row.entityName} <span className={table.muted}>({row.entityId})</span>
                            </td>
                            <td>{row.period}</td>
                            <td className={table.num}>{formatValue(row.value)}</td>
                            <td className={table.muted}>{row.sourceId}</td>
                            <td className={table.muted}>{row.notes ?? ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pager
                    offset={rowsOffset}
                    total={data.observations.total}
                    onChange={setRowsOffset}
                    size={25}
                  />
                </>
              )}
            </Panel>
          </div>
        );
      }}
    </QueryState>
  );
}

/** Rank of each matching entity in every period, from the version's animation data. */
function RankHistory({
  normalized,
  term,
  period,
}: {
  normalized: ReturnType<typeof useNormalized>;
  term: string;
  period: string | null;
}) {
  const history = useMemo(() => {
    const data = normalized.data;
    if (!data) return null;
    const lower = term.toLowerCase();
    const latest = data.rankings.at(-1)?.entries ?? [];
    const order = new Map(latest.map((entry) => [entry.entityId, entry.position]));
    const entities = data.entities
      .filter((entity) => !lower || `${entity.name} ${entity.id}`.toLowerCase().includes(lower))
      .sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9))
      .slice(0, 12);
    const ranks = data.rankings.map((ranking) => ({
      period: ranking.period,
      byEntity: new Map(ranking.entries.map((entry) => [entry.entityId, entry.rank])),
    }));
    return { entities, ranks };
  }, [normalized.data, term]);

  return (
    <Panel
      title="Historical ranking"
      description={
        term
          ? `Entities matching “${term}”`
          : 'Top entities of the last period, across every period'
      }
      flush
    >
      <QueryState query={normalized}>
        {() =>
          history && history.entities.length ? (
            <div className={table.wrap}>
              <table className={table.table} style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Entity</th>
                    {history.ranks.map(({ period: p }) => (
                      <th
                        key={p}
                        className={table.num}
                        style={
                          p === period ? { color: 'var(--sp-color-accent-strong)' } : undefined
                        }
                      >
                        {p}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.entities.map((entity) => (
                    <tr key={entity.id}>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 550 }}>{entity.name}</td>
                      {history.ranks.map(({ period: p, byEntity }) => {
                        const rank = byEntity.get(entity.id);
                        const strength = rank ? Math.max(0.08, 1 - (rank - 1) / 12) : 0;
                        return (
                          <td
                            key={p}
                            className={table.num}
                            style={{
                              background: rank
                                ? `rgba(61, 139, 255, ${strength * 0.45})`
                                : undefined,
                              color: rank
                                ? 'var(--sp-color-text-primary)'
                                : 'var(--sp-color-text-muted)',
                              outline: p === period ? '1px solid rgba(98,162,255,0.5)' : undefined,
                            }}
                          >
                            {rank ?? '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Search} title="No matching entities" />
          )
        }
      </QueryState>
    </Panel>
  );
}
