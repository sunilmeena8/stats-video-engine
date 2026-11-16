"""CSV → validation report → normalized, animation-ready dataset.

Each stage is a plain function (see ingest, validate, ranking, interpolation); this module only
wires them together, so every stage can be tested on its own.
"""

import time
from dataclasses import dataclass
from datetime import UTC, datetime

import pandas as pd

from app import __version__
from app.models import (
    GeneratorInfo,
    MetricConfiguration,
    NormalizedDataset,
    NormalizedDatasetInfo,
    NormalizedEntity,
    NormalizedMetric,
    NormalizedObservation,
    NormalizedQuality,
    NormalizedSource,
    NormalizedTimeRange,
    ProcessingOptions,
    ProcessingSummary,
    ValidationReport,
)
from app.processing.ingest import DEFAULT_MAX_ROWS, IngestResult, ingest_csv
from app.processing.interpolation import OutputTooLargeError, build_frames
from app.processing.issues import IssueCollector
from app.processing.periods import calendar_labels, period_from_index
from app.processing.ranking import period_rankings, rankable_values
from app.processing.validate import ValidationOutcome, validate_rows

GENERATOR_NAME = "statsopedia-data-processor"
#: Issues returned inline in API responses; the full list is written to the report file.
MAX_INLINE_ISSUES = 1_000


@dataclass
class ValidationRun:
    report: ValidationReport
    ingest: IngestResult
    outcome: ValidationOutcome | None
    issues: IssueCollector
    started: float


def validate_csv(
    data: bytes,
    metric: MetricConfiguration,
    *,
    expected_unit: str | None = None,
    max_rows: int = DEFAULT_MAX_ROWS,
) -> ValidationRun:
    """Validates a CSV without producing output. The report lists every issue."""
    started = time.perf_counter()
    issues = IssueCollector()
    ingest = ingest_csv(data, issues, max_rows=max_rows)
    outcome = None
    if not ingest.header_failed:
        outcome = validate_rows(ingest.table, metric, issues, expected_unit=expected_unit)
    return ValidationRun(
        report=_report(ingest, outcome, issues, started),
        ingest=ingest,
        outcome=outcome,
        issues=issues,
        started=started,
    )


def process_csv(
    data: bytes,
    dataset: NormalizedDatasetInfo,
    metric: MetricConfiguration,
    processing: ProcessingOptions,
    *,
    expected_unit: str | None = None,
    max_rows: int = DEFAULT_MAX_ROWS,
) -> tuple[ValidationReport, NormalizedDataset | None]:
    """Validates and, when there are no blocking errors, builds the normalized dataset."""
    run = validate_csv(data, metric, expected_unit=expected_unit, max_rows=max_rows)
    outcome = run.outcome
    if run.issues.has_errors or outcome is None or outcome.span is None or outcome.unit is None:
        return run.report, None

    values = rankable_values(outcome.observations, processing.missing_values)
    try:
        frames = build_frames(
            values,
            outcome.span,
            metric.frequency,
            metric.ranking_order,
            processing.top_n,
            processing.interpolation,
        )
    except OutputTooLargeError as error:
        run.issues.error("OUTPUT_TOO_LARGE", str(error))
        return _report(run.ingest, outcome, run.issues, run.started), None

    for gap in frames.metadata.skipped_gaps:
        run.issues.warning(
            "GAP_NOT_INTERPOLATED",
            f"{gap.entity_id} has {gap.missing_periods} missing period(s) between {gap.from_} "
            f"and {gap.to}, more than maxGapPeriods ({processing.interpolation.max_gap_periods})"
            if processing.interpolation.method == "linear"
            else f"{gap.entity_id} has {gap.missing_periods} missing period(s) between "
            f"{gap.from_} and {gap.to}; interpolation is off",
            entity_id=gap.entity_id,
            value=f"{gap.from_} to {gap.to}",
        )

    rankings = period_rankings(
        values, outcome.span, metric.frequency, metric.ranking_order, processing.top_n
    )
    report = _report(run.ingest, outcome, run.issues, run.started)
    warnings = [issue for issue in report.issues if issue.severity == "warning"]
    observations = outcome.observations

    normalized = NormalizedDataset(
        generated_at=datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        generator=GeneratorInfo(name=GENERATOR_NAME, version=__version__),
        dataset=dataset,
        metric=NormalizedMetric(**metric.model_dump(), unit=outcome.unit),
        processing=processing,
        time_range=NormalizedTimeRange(
            frequency=metric.frequency,
            start=period_from_index(outcome.span[0], metric.frequency).label,
            end=period_from_index(outcome.span[1], metric.frequency).label,
            periods=calendar_labels(outcome.span[0], outcome.span[1], metric.frequency),
        ),
        entities=_entities(observations, metric),
        sources=_sources(observations),
        observations=_observations(observations),
        rankings=rankings,
        interpolation=frames.metadata,
        frames=frames.frames,
        quality=NormalizedQuality(
            status="valid_with_warnings" if warnings else "valid",
            summary=report.summary,
            warnings=warnings[:MAX_INLINE_ISSUES],
            warnings_truncated=len(warnings) > MAX_INLINE_ISSUES,
        ),
    )
    return report, normalized


def truncate_report(report: ValidationReport, limit: int = MAX_INLINE_ISSUES) -> ValidationReport:
    """A copy of the report with at most `limit` issues (counts are unaffected)."""
    if len(report.issues) <= limit:
        return report
    return report.model_copy(update={"issues": report.issues[:limit], "issues_truncated": True})


def _report(
    ingest: IngestResult,
    outcome: ValidationOutcome | None,
    issues: IssueCollector,
    started: float,
) -> ValidationReport:
    errors, warnings, by_code = issues.counts()
    observations = outcome.observations if outcome is not None else pd.DataFrame()
    observed = (
        observations.loc[~observations["is_missing"], "period_index"].nunique()
        if not observations.empty
        else 0
    )
    span = outcome.span if outcome is not None else None
    summary = ProcessingSummary(
        row_count=ingest.row_count,
        valid_row_count=len(observations),
        entity_count=int(observations["entity_id"].nunique()) if not observations.empty else 0,
        source_count=int(observations["source_id"].nunique()) if not observations.empty else 0,
        period_count=0 if span is None else span[1] - span[0] + 1,
        observed_period_count=int(observed),
        missing_value_count=outcome.missing_value_count if outcome is not None else 0,
        error_count=errors,
        warning_count=warnings,
        issue_counts=by_code,
        duration_ms=round((time.perf_counter() - started) * 1000, 1),
    )
    status = "invalid" if errors else ("valid_with_warnings" if warnings else "valid")
    return ValidationReport(
        status=status,
        columns=ingest.columns,
        summary=summary,
        issues=issues.sorted(),
        issues_truncated=False,
    )


def _entities(observations: pd.DataFrame, metric: MetricConfiguration) -> list[NormalizedEntity]:
    entities: list[NormalizedEntity] = []
    for entity_id, rows in observations.groupby("entity_id", sort=True):
        ordered = rows.sort_values("row")
        low, high = int(rows["period_index"].min()), int(rows["period_index"].max())
        have = set(rows.loc[~rows["is_missing"], "period_index"])
        missing = [
            period_from_index(i, metric.frequency).label
            for i in range(low, high + 1)
            if i not in have
        ]
        images = ordered["image_url"].dropna()
        categories = ordered["category"].dropna()
        entities.append(
            NormalizedEntity(
                id=str(entity_id),
                name=str(ordered["entity_name"].iloc[0]),
                category=str(categories.iloc[0]) if not categories.empty else None,
                image_url=str(images.iloc[0]) if not images.empty else None,
                first_period=period_from_index(low, metric.frequency).label,
                last_period=period_from_index(high, metric.frequency).label,
                observation_count=int((~rows["is_missing"]).sum()),
                missing_periods=missing,
            )
        )
    return entities


def _sources(observations: pd.DataFrame) -> list[NormalizedSource]:
    sources: list[NormalizedSource] = []
    for source_id, rows in observations.groupby("source_id", sort=True):
        urls = rows.sort_values("row")["source_url"].dropna()
        sources.append(
            NormalizedSource(
                id=str(source_id),
                url=str(urls.iloc[0]) if not urls.empty else None,
                observation_count=len(rows),
            )
        )
    return sources


def _observations(observations: pd.DataFrame) -> list[NormalizedObservation]:
    ordered = observations.sort_values("row")
    return [
        NormalizedObservation.model_construct(
            entity_id=str(entity_id),
            period=str(period),
            value=None if missing else float(value),
            source_id=str(source_id),
            row=int(row),
            # Empty cells become None upstream, but pandas may turn None into NaN.
            notes=None if pd.isna(notes) else str(notes),
        )
        for entity_id, period, value, missing, source_id, row, notes in zip(
            ordered["entity_id"],
            ordered["period"],
            ordered["value"],
            ordered["is_missing"],
            ordered["source_id"],
            ordered["row"],
            ordered["notes"],
            strict=True,
        )
    ]
