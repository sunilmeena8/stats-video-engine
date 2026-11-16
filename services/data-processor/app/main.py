"""FastAPI application factory: health, CSV validation/processing and ranking endpoints.

These endpoints are internal: the API calls them with storage-relative paths it generated.
The service binds to 127.0.0.1 by default and must not be exposed publicly.
"""

import logging
import os
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

import pandas as pd
from fastapi import FastAPI, HTTPException, Response
from pydantic import Field

from app import __version__
from app.config import Settings
from app.logging_config import SERVICE_NAME
from app.models import (
    CamelModel,
    Frequency,
    MetricConfiguration,
    MissingValuePolicy,
    NormalizedDatasetInfo,
    PeriodRanking,
    ProcessingOptions,
    RankingOrder,
    ValidationReport,
)
from app.processing.periods import PeriodError, calendar_labels, parse_period
from app.processing.pipeline import process_csv, truncate_report, validate_csv
from app.processing.ranking import period_rankings, rankable_values
from app.storage import StoragePathError, resolve_storage_path, write_atomically

logger = logging.getLogger("app")

# Directories this service reads uploads from and writes processed output to.
REQUIRED_STORAGE_DIRECTORIES = ("datasets", "processed")


class DependencyCheckResult(CamelModel):
    status: Literal["up", "down"]
    latency_ms: float
    error: str | None


class HealthResponse(CamelModel):
    """Mirrors `HealthResponse` in packages/shared-types (validated by the dashboard)."""

    status: Literal["ok", "degraded"]
    service: str
    version: str
    uptime_seconds: float
    timestamp: datetime
    checks: dict[str, DependencyCheckResult]


def check_storage(storage_root: Path) -> DependencyCheckResult:
    """The storage directories this service needs must exist and be writable."""
    started = time.perf_counter()
    unusable = [
        name
        for name in REQUIRED_STORAGE_DIRECTORIES
        if not ((storage_root / name).is_dir() and os.access(storage_root / name, os.W_OK))
    ]
    latency_ms = round((time.perf_counter() - started) * 1000, 1)
    if unusable:
        return DependencyCheckResult(
            status="down",
            latency_ms=latency_ms,
            error=f"Missing or not writable under {storage_root}: {', '.join(unusable)}",
        )
    return DependencyCheckResult(status="up", latency_ms=latency_ms, error=None)


class ValidateRequest(CamelModel):
    source_file_path: str
    metric: MetricConfiguration
    expected_unit: str | None = None


class ProcessCsvRequest(CamelModel):
    source_file_path: str
    output_file_path: str
    report_file_path: str
    dataset: NormalizedDatasetInfo
    metric: MetricConfiguration
    processing: ProcessingOptions
    expected_unit: str | None = None


class ProcessCsvResponse(CamelModel):
    report: ValidationReport
    #: Null when validation found blocking errors (no output is written).
    output_file_path: str | None
    report_file_path: str


class RankingObservation(CamelModel):
    entity_id: str = Field(min_length=1, max_length=120)
    period: str
    value: float | None


class RankingsRequest(CamelModel):
    frequency: Frequency
    ranking_order: RankingOrder = "desc"
    top_n: int | None = Field(default=None, ge=1, le=100)
    missing_values: MissingValuePolicy = "exclude"
    observations: list[RankingObservation] = Field(max_length=1_000_000)


class RankingsResponse(CamelModel):
    periods: list[str]
    rankings: list[PeriodRanking]


def rank_observations(request: RankingsRequest) -> RankingsResponse:
    """Ranks ad-hoc observations with the same rules as CSV processing."""
    problems: list[str] = []
    rows: list[dict[str, object]] = []
    seen: set[tuple[str, str]] = set()
    for position, observation in enumerate(request.observations):
        try:
            period = parse_period(observation.period, request.frequency)
        except PeriodError as error:
            problems.append(f"observations[{position}].period: {error}")
            continue
        key = (observation.entity_id, period.label)
        if key in seen:
            problems.append(f"observations[{position}]: duplicate {key[0]} in {key[1]}")
            continue
        seen.add(key)
        rows.append(
            {
                "entity_id": observation.entity_id,
                "period_index": period.index,
                "value": float("nan") if observation.value is None else observation.value,
                "is_missing": observation.value is None,
            }
        )
    if problems:
        raise HTTPException(status_code=422, detail=problems[:100])
    if not rows:
        return RankingsResponse(periods=[], rankings=[])

    table = pd.DataFrame(rows)
    span = (int(table["period_index"].min()), int(table["period_index"].max()))
    values = rankable_values(table, request.missing_values)
    return RankingsResponse(
        periods=calendar_labels(span[0], span[1], request.frequency),
        rankings=period_rankings(
            values, span, request.frequency, request.ranking_order, request.top_n
        ),
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    """Builds the app from injected settings (tests pass their own)."""
    resolved = settings or Settings()
    started = time.monotonic()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        logger.info(
            "Data processor started",
            extra={"pandasVersion": pd.__version__, "storageRoot": str(resolved.storage_root)},
        )
        yield
        logger.info("Data processor stopped")

    app = FastAPI(title="Statsopedia data-processor", version=__version__, lifespan=lifespan)

    def describe(
        status: Literal["ok", "degraded"], checks: dict[str, DependencyCheckResult]
    ) -> HealthResponse:
        return HealthResponse(
            status=status,
            service=SERVICE_NAME,
            version=__version__,
            uptime_seconds=round(time.monotonic() - started, 1),
            timestamp=datetime.now(UTC),
            checks=checks,
        )

    @app.get("/health", response_model=HealthResponse)
    def health(response: Response) -> HealthResponse:
        """Liveness: the process is up and serving requests."""
        response.headers["Cache-Control"] = "no-store"
        return describe("ok", {})

    @app.get("/health/ready", response_model=HealthResponse)
    def ready(response: Response) -> HealthResponse:
        """Readiness: storage directories are usable. 503 when they are not."""
        response.headers["Cache-Control"] = "no-store"
        checks = {"storage": check_storage(resolved.storage_root)}
        healthy = all(check.status == "up" for check in checks.values())
        if not healthy:
            response.status_code = 503
            logger.warning(
                "Readiness check failed",
                extra={"checks": {k: v.model_dump() for k, v in checks.items()}},
            )
        return describe("ok" if healthy else "degraded", checks)

    def read_source(relative: str) -> bytes:
        try:
            path = resolve_storage_path(resolved.storage_root, relative, ("datasets", "temp"))
        except StoragePathError as error:
            raise HTTPException(status_code=400, detail=str(error)) from None
        if path.suffix.lower() != ".csv":
            raise HTTPException(status_code=400, detail="Source file must have a .csv extension")
        if not path.is_file():
            raise HTTPException(status_code=404, detail=f"Source file not found: {relative}")
        if path.stat().st_size > resolved.max_csv_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"Source file exceeds {resolved.max_csv_bytes:,} bytes",
            )
        # Read as bytes only: uploaded files are data and are never executed or imported.
        return path.read_bytes()

    def output_path(relative: str) -> Path:
        try:
            return resolve_storage_path(resolved.storage_root, relative, ("processed",))
        except StoragePathError as error:
            raise HTTPException(status_code=400, detail=str(error)) from None

    @app.post("/validate", response_model=ValidationReport)
    def validate(request: ValidateRequest) -> ValidationReport:
        """Validates a stored CSV without writing anything."""
        data = read_source(request.source_file_path)
        run = validate_csv(
            data,
            request.metric,
            expected_unit=request.expected_unit,
            max_rows=resolved.max_csv_rows,
        )
        logger.info(
            "CSV validated",
            extra={"sourceFilePath": request.source_file_path, "status": run.report.status},
        )
        return truncate_report(run.report)

    @app.post("/process/csv", response_model=ProcessCsvResponse)
    def process(request: ProcessCsvRequest) -> ProcessCsvResponse:
        """Validates a stored CSV, writes the full report and, if valid, the normalized JSON."""
        output = output_path(request.output_file_path)
        report_path = output_path(request.report_file_path)
        if output == report_path:
            raise HTTPException(status_code=400, detail="Output and report paths must differ")
        data = read_source(request.source_file_path)

        report, normalized = process_csv(
            data,
            request.dataset,
            request.metric,
            request.processing,
            expected_unit=request.expected_unit,
            max_rows=resolved.max_csv_rows,
        )
        write_atomically(report_path, report.model_dump_json(by_alias=True))
        if normalized is not None:
            write_atomically(output, normalized.model_dump_json(by_alias=True))

        summary = report.summary
        logger.info(
            "CSV processed",
            extra={
                "datasetId": request.dataset.id,
                "versionId": request.dataset.version_id,
                "status": report.status,
                "rows": summary.row_count,
                "errors": summary.error_count,
                "warnings": summary.warning_count,
                "durationMs": summary.duration_ms,
            },
        )
        return ProcessCsvResponse(
            report=truncate_report(report),
            output_file_path=request.output_file_path if normalized is not None else None,
            report_file_path=request.report_file_path,
        )

    @app.post("/rankings", response_model=RankingsResponse)
    def rankings(request: RankingsRequest) -> RankingsResponse:
        """Ranks observations sent in the request body (no file access)."""
        return rank_observations(request)

    return app
