"""Shared builders for processing tests."""

from app.models import (
    Frequency,
    InterpolationMethod,
    InterpolationOptions,
    MetricConfiguration,
    MissingValuePolicy,
    NormalizedDatasetInfo,
    ProcessingOptions,
    RankingOrder,
)

HEADER = "entity_id,entity_name,year,value,unit,source_id"


def csv_bytes(*rows: str, header: str = HEADER) -> bytes:
    return ("\n".join([header, *rows]) + "\n").encode("utf-8")


def metric(
    frequency: Frequency = "yearly",
    order: RankingOrder = "desc",
    *,
    allow_negative: bool = False,
) -> MetricConfiguration:
    return MetricConfiguration(
        frequency=frequency, ranking_order=order, allow_negative=allow_negative
    )


def processing(
    *,
    top_n: int | None = None,
    missing: MissingValuePolicy = "exclude",
    method: InterpolationMethod = "linear",
    steps: int = 1,
    max_gap: int = 1,
    allow_large_gaps: bool = False,
) -> ProcessingOptions:
    return ProcessingOptions(
        top_n=top_n,
        missing_values=missing,
        interpolation=InterpolationOptions(
            method=method,
            steps_per_period=steps,
            max_gap_periods=max_gap,
            allow_large_gaps=allow_large_gaps,
        ),
    )


DATASET_INFO = NormalizedDatasetInfo(
    id="0b7d6c2e-58f4-4c4b-9a8e-5d1f2a3b4c5d",
    slug="test-dataset",
    title="Test dataset",
    description=None,
    version_id="7e2c1a9b-3d4f-4e5a-8b6c-1d2e3f4a5b6c",
    version=1,
    original_filename="test.csv",
    checksum_sha256="0" * 64,
)
