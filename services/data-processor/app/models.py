"""Pydantic mirrors of the TypeScript contracts in packages/shared-types.

Field names are snake_case here and serialize as camelCase (the TypeScript names). The API
validates every response and normalized file against the Zod schemas in
packages/shared-schemas, so a drift between the two languages fails loudly.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

Frequency = Literal["yearly", "monthly", "daily"]
RankingOrder = Literal["desc", "asc"]
MissingValuePolicy = Literal["exclude", "zero"]
InterpolationMethod = Literal["none", "linear"]
Severity = Literal["error", "warning"]
ValueKind = Literal["observed", "zero_filled", "interpolated"]
ReportStatus = Literal["valid", "valid_with_warnings", "invalid"]

# Keep in sync with VALIDATION_ERROR_CODES / VALIDATION_WARNING_CODES in shared-types.
ErrorCode = Literal[
    "FILE_EMPTY",
    "FILE_NOT_UTF8",
    "FILE_BINARY",
    "CSV_MALFORMED",
    "MISSING_COLUMNS",
    "DUPLICATE_COLUMNS",
    "NO_DATA_ROWS",
    "TOO_MANY_ROWS",
    "FIELD_COUNT_MISMATCH",
    "FIELD_TOO_LONG",
    "INVALID_ID",
    "MISSING_ENTITY_ID",
    "MISSING_ENTITY_NAME",
    "MISSING_PERIOD",
    "INVALID_PERIOD",
    "INVALID_VALUE",
    "NEGATIVE_VALUE",
    "MISSING_UNIT",
    "MISSING_SOURCE_ID",
    "DUPLICATE_OBSERVATION",
    "INCONSISTENT_UNIT",
    "INCONSISTENT_ENTITY_NAME",
    "OUTPUT_TOO_LARGE",
]
WarningCode = Literal[
    "UNEXPECTED_COLUMNS",
    "BLANK_ROW",
    "MISSING_VALUE",
    "MISSING_PERIODS",
    "EMPTY_PERIOD",
    "INVALID_SOURCE_URL",
    "INCONSISTENT_SOURCE_URL",
    "INVALID_IMAGE_URL",
    "INCONSISTENT_ENTITY_METADATA",
    "UNIT_CHANGED",
    "GAP_NOT_INTERPOLATED",
]
IssueCode = ErrorCode | WarningCode

NORMALIZED_DATASET_SCHEMA_VERSION = 1


class CamelModel(BaseModel):
    """Serializes snake_case fields as camelCase and rejects unknown input fields."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class MetricConfiguration(CamelModel):
    frequency: Frequency
    ranking_order: RankingOrder
    allow_negative: bool


class InterpolationOptions(CamelModel):
    method: InterpolationMethod
    steps_per_period: int = Field(ge=1, le=60)
    max_gap_periods: int = Field(ge=0, le=10_000)
    allow_large_gaps: bool


class ProcessingOptions(CamelModel):
    top_n: int | None = Field(ge=1, le=100)
    missing_values: MissingValuePolicy
    interpolation: InterpolationOptions


class ValidationIssue(CamelModel):
    severity: Severity
    code: IssueCode
    message: str
    row: int | None = None
    column: str | None = None
    entity_id: str | None = None
    value: str | None = None


class CsvColumnReport(CamelModel):
    found: list[str]
    missing: list[str]
    unexpected: list[str]


class ProcessingSummary(CamelModel):
    row_count: int
    valid_row_count: int
    entity_count: int
    source_count: int
    period_count: int
    observed_period_count: int
    missing_value_count: int
    error_count: int
    warning_count: int
    issue_counts: dict[str, int]
    duration_ms: float


class ValidationReport(CamelModel):
    status: ReportStatus
    columns: CsvColumnReport
    summary: ProcessingSummary
    issues: list[ValidationIssue]
    issues_truncated: bool


class NormalizedDatasetInfo(CamelModel):
    id: str
    slug: str
    title: str
    description: str | None
    version_id: str
    version: int = Field(ge=1)
    original_filename: str
    checksum_sha256: str


class NormalizedMetric(MetricConfiguration):
    unit: str


class NormalizedTimeRange(CamelModel):
    frequency: Frequency
    start: str
    end: str
    periods: list[str]


class NormalizedEntity(CamelModel):
    id: str
    name: str
    category: str | None
    image_url: str | None
    first_period: str
    last_period: str
    observation_count: int
    missing_periods: list[str]


class NormalizedSource(CamelModel):
    id: str
    url: str | None
    observation_count: int


class NormalizedObservation(CamelModel):
    entity_id: str
    period: str
    value: float | None
    source_id: str
    row: int
    notes: str | None


class RankedValue(CamelModel):
    entity_id: str
    value: float
    rank: int
    position: int
    value_kind: ValueKind


class PeriodRanking(CamelModel):
    period: str
    entries: list[RankedValue]
    entered: list[str]
    exited: list[str]


class InterpolationGap(CamelModel):
    entity_id: str
    from_: str = Field(alias="from")
    to: str
    missing_periods: int


class InterpolationMetadata(InterpolationOptions):
    frame_count: int
    estimated_value_count: int
    bridged_gaps: list[InterpolationGap]
    skipped_gaps: list[InterpolationGap]


class AnimationFrame(CamelModel):
    index: int
    from_period: str
    to_period: str | None
    progress: float
    is_estimate: bool
    entries: list[RankedValue]


class GeneratorInfo(CamelModel):
    name: str
    version: str


class NormalizedQuality(CamelModel):
    status: Literal["valid", "valid_with_warnings"]
    summary: ProcessingSummary
    warnings: list[ValidationIssue]
    warnings_truncated: bool


class NormalizedDataset(CamelModel):
    schema_version: Literal[1] = 1
    generated_at: str
    generator: GeneratorInfo
    dataset: NormalizedDatasetInfo
    metric: NormalizedMetric
    processing: ProcessingOptions
    time_range: NormalizedTimeRange
    entities: list[NormalizedEntity]
    sources: list[NormalizedSource]
    observations: list[NormalizedObservation]
    rankings: list[PeriodRanking]
    interpolation: InterpolationMetadata
    frames: list[AnimationFrame]
    quality: NormalizedQuality
