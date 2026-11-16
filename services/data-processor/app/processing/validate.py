"""Validation of ingested CSV rows.

Errors block the import; warnings are reported and processing continues. Each row-level issue
carries the CSV row number. Rows are never dropped silently: a row is either a valid
observation or the subject of at least one error.
"""

import math
import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import SupportsInt, cast
from urllib.parse import urlsplit

import pandas as pd

from app.models import MetricConfiguration, WarningCode
from app.processing.issues import IssueCollector
from app.processing.periods import PeriodError, parse_period, period_from_index

# Plain decimal or scientific notation. Rejects thousands separators, "nan", "inf", "1_000".
_NUMBER = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")

MAX_LENGTHS = {
    "entity_id": 120,
    "source_id": 120,
    "entity_name": 200,
    "unit": 80,
    "entity_category": 120,
    "entity_image": 2048,
    "source_url": 2048,
    "notes": 2000,
}

#: Longest calendar span a dataset may cover (e.g. ~270 years of daily data).
MAX_PERIODS = 100_000

#: Missing periods listed by name in one MISSING_PERIODS warning.
_LISTED_PERIODS = 8


@dataclass
class ValidationOutcome:
    #: Valid rows: row, entity_id, entity_name, period, period_index, year, value (NaN when
    #: missing), is_missing, unit, source_id, image_url, category, source_url, notes.
    observations: pd.DataFrame
    unit: str | None
    #: First and last period index across valid rows, or None without valid rows.
    span: tuple[int, int] | None
    missing_value_count: int


def as_int(value: object) -> int:
    """int() for pandas/numpy scalars, which mypy cannot narrow."""
    return int(cast(SupportsInt, value))


def is_http_url(value: str) -> bool:
    if _CONTROL.search(value) or " " in value:
        return False
    try:
        parts = urlsplit(value)
    except ValueError:
        return False
    return parts.scheme in ("http", "https") and bool(parts.hostname)


def validate_rows(
    table: pd.DataFrame,
    metric: MetricConfiguration,
    issues: IssueCollector,
    *,
    expected_unit: str | None = None,
) -> ValidationOutcome:
    parsed = _parse_rows(table, metric, issues)
    _check_duplicates(parsed, issues)
    unit = _check_units(parsed, issues, expected_unit)
    _check_entity_consistency(parsed, issues)
    _check_source_consistency(parsed, issues)

    error_rows = issues.error_rows()
    valid = parsed[parsed["period_ok"] & ~parsed["row"].isin(error_rows)].drop(columns="period_ok")
    valid = valid.reset_index(drop=True)
    valid["period_index"] = valid["period_index"].astype("int64")
    valid["year"] = valid["year"].astype("int64")

    span = _check_periods(valid, metric, issues)
    return ValidationOutcome(
        observations=valid,
        unit=unit,
        span=span,
        missing_value_count=int(parsed["is_missing"].sum()),
    )


def _parse_rows(
    table: pd.DataFrame, metric: MetricConfiguration, issues: IssueCollector
) -> pd.DataFrame:
    labels: list[str] = []
    indexes: list[int] = []
    years: list[int] = []
    values: list[float] = []
    missing: list[bool] = []
    period_ok: list[bool] = []
    image_urls: list[str | None] = []
    source_urls: list[str | None] = []

    for rec in table.itertuples(index=False):
        row = as_int(rec.row)
        entity_id = str(rec.entity_id)

        for column, limit in MAX_LENGTHS.items():
            cell = str(getattr(rec, column))
            if len(cell) > limit:
                issues.error(
                    "FIELD_TOO_LONG",
                    f"{column} is {len(cell)} characters long (maximum {limit})",
                    row=row,
                    column=column,
                    entity_id=entity_id or None,
                    value=cell,
                )

        if not entity_id:
            issues.error("MISSING_ENTITY_ID", "entity_id is empty", row=row, column="entity_id")
        elif _CONTROL.search(entity_id):
            issues.error(
                "INVALID_ID",
                "entity_id contains a line break or control character",
                row=row,
                column="entity_id",
                value=entity_id,
            )
        if not rec.entity_name:
            issues.error(
                "MISSING_ENTITY_NAME",
                "entity_name is empty",
                row=row,
                column="entity_name",
                entity_id=entity_id or None,
            )
        if not rec.unit:
            issues.error("MISSING_UNIT", "unit is empty", row=row, column="unit")
        source_id = str(rec.source_id)
        if not source_id:
            issues.error("MISSING_SOURCE_ID", "source_id is empty", row=row, column="source_id")
        elif _CONTROL.search(source_id):
            issues.error(
                "INVALID_ID",
                "source_id contains a line break or control character",
                row=row,
                column="source_id",
                value=source_id,
            )

        raw_period = str(rec.year)
        if not raw_period:
            issues.error("MISSING_PERIOD", "year is empty", row=row, column="year")
            labels.append("")
            indexes.append(0)
            years.append(0)
            period_ok.append(False)
        else:
            try:
                period = parse_period(raw_period, metric.frequency)
            except PeriodError as error:
                issues.error(
                    "INVALID_PERIOD",
                    str(error),
                    row=row,
                    column="year",
                    entity_id=entity_id or None,
                    value=raw_period,
                )
                labels.append("")
                indexes.append(0)
                years.append(0)
                period_ok.append(False)
            else:
                labels.append(period.label)
                indexes.append(period.index)
                years.append(period.year)
                period_ok.append(bool(entity_id))

        raw_value = str(rec.value)
        value = math.nan
        is_missing = False
        if not raw_value:
            is_missing = True
            issues.warning(
                "MISSING_VALUE",
                "value is empty: kept as a missing observation (not zero)",
                row=row,
                column="value",
                entity_id=entity_id or None,
            )
        elif not _NUMBER.match(raw_value):
            hint = " Remove thousands separators." if "," in raw_value else ""
            issues.error(
                "INVALID_VALUE",
                f'"{raw_value}" is not a number.{hint}',
                row=row,
                column="value",
                entity_id=entity_id or None,
                value=raw_value,
            )
        else:
            value = float(raw_value)
            if not math.isfinite(value):
                issues.error(
                    "INVALID_VALUE",
                    f'"{raw_value}" is too large to represent',
                    row=row,
                    column="value",
                    entity_id=entity_id or None,
                    value=raw_value,
                )
                value = math.nan
            elif value < 0 and not metric.allow_negative:
                issues.error(
                    "NEGATIVE_VALUE",
                    "Negative values are not allowed for this metric",
                    row=row,
                    column="value",
                    entity_id=entity_id or None,
                    value=raw_value,
                )
        values.append(value)
        missing.append(is_missing)

        image_urls.append(
            _optional_url(str(rec.entity_image), "entity_image", row, entity_id, issues)
        )
        source_urls.append(_optional_url(str(rec.source_url), "source_url", row, None, issues))

    return pd.DataFrame(
        {
            "row": table["row"].astype("int64"),
            "entity_id": table["entity_id"],
            "entity_name": table["entity_name"],
            "period": pd.Series(labels, dtype=object),
            "period_index": pd.Series(indexes, dtype="int64"),
            "year": pd.Series(years, dtype="int64"),
            "value": pd.Series(values, dtype="float64"),
            "is_missing": pd.Series(missing, dtype=bool),
            "unit": table["unit"],
            "source_id": table["source_id"],
            "image_url": pd.Series(image_urls, dtype=object),
            "category": table["entity_category"].map(lambda c: c or None),
            "source_url": pd.Series(source_urls, dtype=object),
            "notes": table["notes"].map(lambda n: n or None),
            "period_ok": pd.Series(period_ok, dtype=bool),
        }
    )


def _optional_url(
    value: str, column: str, row: int, entity_id: str | None, issues: IssueCollector
) -> str | None:
    if not value:
        return None
    if is_http_url(value):
        return value
    code: WarningCode = "INVALID_IMAGE_URL" if column == "entity_image" else "INVALID_SOURCE_URL"
    issues.warning(
        code,
        f"{column} is not an http(s) URL and is ignored",
        row=row,
        column=column,
        entity_id=entity_id or None,
        value=value,
    )
    return None


def _check_duplicates(parsed: pd.DataFrame, issues: IssueCollector) -> None:
    keyed = parsed[parsed["period_ok"]]
    first_row = keyed.groupby(["entity_id", "period"], sort=False)["row"].transform("min")
    duplicates = keyed[keyed["row"] != first_row]
    for rec, first in zip(
        duplicates.itertuples(index=False), first_row[duplicates.index], strict=True
    ):
        issues.error(
            "DUPLICATE_OBSERVATION",
            f"Duplicate entity_id + year: {rec.entity_id} in {rec.period} "
            f"was already given on row {first}",
            row=as_int(rec.row),
            column="year",
            entity_id=str(rec.entity_id),
            value=str(rec.period),
        )


def _check_units(
    parsed: pd.DataFrame, issues: IssueCollector, expected_unit: str | None
) -> str | None:
    units = parsed.loc[parsed["unit"] != "", "unit"]
    if units.empty:
        return None
    counts = units.value_counts(sort=False)
    # Most common unit wins; ties go to the unit that appears first.
    first_seen = {unit: position for position, unit in enumerate(units.drop_duplicates())}
    unit = str(max(counts.index, key=lambda u: (counts[u], -first_seen[u])))
    if len(counts) > 1:
        others = parsed[(parsed["unit"] != "") & (parsed["unit"] != unit)]
        for rec in others.itertuples(index=False):
            issues.error(
                "INCONSISTENT_UNIT",
                f'Unit "{rec.unit}" differs from "{unit}" used by {counts[unit]} other rows; '
                "a dataset must use one unit",
                row=as_int(rec.row),
                column="unit",
                entity_id=str(rec.entity_id) or None,
                value=str(rec.unit),
            )
    if expected_unit is not None and unit != expected_unit:
        issues.warning(
            "UNIT_CHANGED",
            f'This file uses "{unit}" but the dataset unit is "{expected_unit}"',
            column="unit",
            value=unit,
        )
    return unit


def _check_entity_consistency(parsed: pd.DataFrame, issues: IssueCollector) -> None:
    named = parsed[(parsed["entity_id"] != "") & (parsed["entity_name"] != "")]
    groups = named.groupby("entity_id", sort=False)
    canonical = named["entity_id"].map(groups["entity_name"].first())
    first_row = named["entity_id"].map(groups["row"].min())
    differs = named["entity_name"] != canonical
    for rec, name, row in zip(
        named[differs].itertuples(index=False), canonical[differs], first_row[differs], strict=True
    ):
        issues.error(
            "INCONSISTENT_ENTITY_NAME",
            f'Entity {rec.entity_id} is named "{name}" on row {row} but "{rec.entity_name}" here',
            row=as_int(rec.row),
            column="entity_name",
            entity_id=str(rec.entity_id),
            value=str(rec.entity_name),
        )

    # Image and category: the first non-empty value per entity is used.
    for column, label in (("image_url", "entity_image"), ("category", "entity_category")):
        present = parsed[(parsed["entity_id"] != "") & parsed[column].notna()]
        _warn_differing(present, "entity_id", column, label, issues, entity_scoped=True)


def _check_source_consistency(parsed: pd.DataFrame, issues: IssueCollector) -> None:
    present = parsed[(parsed["source_id"] != "") & parsed["source_url"].notna()]
    _warn_differing(present, "source_id", "source_url", "source_url", issues, entity_scoped=False)


def _warn_differing(
    present: pd.DataFrame,
    key: str,
    column: str,
    label: str,
    issues: IssueCollector,
    *,
    entity_scoped: bool,
) -> None:
    chosen = present[key].map(present.groupby(key, sort=False)[column].first())
    differs = present[column] != chosen
    for rec, value in zip(present[differs].itertuples(index=False), chosen[differs], strict=True):
        key_value = str(getattr(rec, key))
        message = f'{label} for {key_value} differs from the first one given; "{value}" is used'
        if entity_scoped:
            issues.warning(
                "INCONSISTENT_ENTITY_METADATA",
                message,
                row=as_int(rec.row),
                column=label,
                entity_id=key_value,
                value=str(getattr(rec, column)),
            )
        else:
            issues.warning(
                "INCONSISTENT_SOURCE_URL",
                message,
                row=as_int(rec.row),
                column=label,
                value=str(getattr(rec, column)),
            )


def _check_periods(
    valid: pd.DataFrame, metric: MetricConfiguration, issues: IssueCollector
) -> tuple[int, int] | None:
    if valid.empty:
        return None
    start, end = int(valid["period_index"].min()), int(valid["period_index"].max())
    if end - start + 1 > MAX_PERIODS:
        issues.error(
            "OUTPUT_TOO_LARGE",
            f"The data spans {end - start + 1:,} {metric.frequency} periods "
            f"(maximum {MAX_PERIODS:,}). Check the frequency setting.",
        )
        return None

    observed = valid[~valid["is_missing"]]
    have_by_entity = observed.groupby("entity_id")["period_index"].unique()
    bounds = valid.groupby("entity_id", sort=True)["period_index"].agg(["min", "max"])
    for entity_id, low, high in bounds.itertuples():
        have = have_by_entity.get(entity_id)
        count, first = _missing_indices(as_int(low), as_int(high), [] if have is None else have)
        if count:
            names = _labels(first, metric)
            issues.warning(
                "MISSING_PERIODS",
                f"{entity_id} has no value for {count} period(s) between its first and last "
                f"observation: {', '.join(names)}{_more(count)}",
                entity_id=str(entity_id),
                value=", ".join(names),
            )

    count, first = _missing_indices(start, end, observed["period_index"].unique())
    if count:
        names = _labels(first, metric)
        issues.warning(
            "EMPTY_PERIOD",
            f"{count} period(s) have no values for any entity: {', '.join(names)}{_more(count)}",
            value=", ".join(names),
        )
    return start, end


def _missing_indices(low: int, high: int, have: Iterable[int]) -> tuple[int, list[int]]:
    """How many indexes in [low, high] are not in `have`, and the first few of them."""
    present = sorted(int(i) for i in have if low <= int(i) <= high)
    count = (high - low + 1) - len(present)
    first: list[int] = []
    expected = low
    for index in [*present, high + 1]:
        while expected < index and len(first) < _LISTED_PERIODS:
            first.append(expected)
            expected += 1
        if len(first) >= _LISTED_PERIODS:
            break
        expected = index + 1
    return count, first


def _labels(indexes: list[int], metric: MetricConfiguration) -> list[str]:
    return [period_from_index(i, metric.frequency).label for i in indexes]


def _more(count: int) -> str:
    return f" and {count - _LISTED_PERIODS} more" if count > _LISTED_PERIODS else ""
