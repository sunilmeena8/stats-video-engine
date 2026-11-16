"""CSV ingestion and validation."""

import time

import pytest

from app.models import ValidationReport
from app.processing.pipeline import process_csv, validate_csv
from tests.helpers import DATASET_INFO, csv_bytes, metric, processing


def codes(report: ValidationReport, severity: str | None = None) -> list[str]:
    return [i.code for i in report.issues if severity is None or i.severity == severity]


def issue_rows(report: ValidationReport, code: str) -> list[int | None]:
    return [i.row for i in report.issues if i.code == code]


def test_valid_csv_passes_with_no_issues() -> None:
    data = csv_bytes(
        "USA,United States,2000,10.5,people,wb",
        "CHN,China,2000,12,people,wb",
        "USA,United States,2001,11,people,wb",
        "CHN,China,2001,13e0,people,wb",
    )
    report = validate_csv(data, metric()).report

    assert report.status == "valid"
    assert report.issues == []
    assert report.summary.row_count == 4
    assert report.summary.valid_row_count == 4
    assert report.summary.entity_count == 2
    assert report.summary.period_count == 2
    assert report.columns.missing == []


def test_missing_columns_block_and_are_named() -> None:
    data = csv_bytes("USA,United States,2000,10", header="entity_id,entity_name,year,value")
    report = validate_csv(data, metric()).report

    assert report.status == "invalid"
    assert report.columns.missing == ["unit", "source_id"]
    [issue] = [i for i in report.issues if i.code == "MISSING_COLUMNS"]
    assert issue.row == 1
    assert "unit" in issue.message and "source_id" in issue.message
    # Rows are counted even though they cannot be validated.
    assert report.summary.row_count == 1


def test_unexpected_and_optional_columns() -> None:
    data = csv_bytes(
        "USA,United States,2000,1,people,wb,Americas,extra",
        header="entity_id,entity_name,year,value,unit,source_id,entity_category,colour",
    )
    report = validate_csv(data, metric()).report

    assert report.status == "valid_with_warnings"
    assert report.columns.unexpected == ["colour"]
    assert codes(report) == ["UNEXPECTED_COLUMNS"]


def test_header_names_are_case_and_whitespace_insensitive() -> None:
    data = csv_bytes(
        "USA,United States,2000,1,people,wb",
        header=" Entity_ID ,ENTITY_NAME,Year,Value,Unit,Source_Id",
    )
    assert validate_csv(data, metric()).report.status == "valid"


def test_duplicate_columns_block() -> None:
    data = csv_bytes(
        "USA,United States,2000,1,people,wb,2",
        header="entity_id,entity_name,year,value,unit,source_id,value",
    )
    assert "DUPLICATE_COLUMNS" in codes(validate_csv(data, metric()).report, "error")


@pytest.mark.parametrize(
    ("value", "code"),
    [
        ("abc", "INVALID_VALUE"),
        ("1,234", "INVALID_VALUE"),
        ("nan", "INVALID_VALUE"),
        ("inf", "INVALID_VALUE"),
        ("1_000", "INVALID_VALUE"),
        ("1e999", "INVALID_VALUE"),
        ("-5", "NEGATIVE_VALUE"),
    ],
)
def test_invalid_values_are_errors_with_row_numbers(value: str, code: str) -> None:
    data = csv_bytes("USA,United States,2000,1,people,wb", f'CHN,China,2000,"{value}",people,wb')
    report = validate_csv(data, metric()).report

    assert report.status == "invalid"
    [issue] = [i for i in report.issues if i.code == code]
    assert issue.row == 3
    assert issue.column == "value"
    assert issue.value == value
    assert report.summary.valid_row_count == 1


def test_negative_values_are_allowed_when_the_metric_permits_them() -> None:
    data = csv_bytes("USA,United States,2000,-5.5,°C,wb")
    assert validate_csv(data, metric(allow_negative=True)).report.status == "valid"


def test_empty_value_is_a_missing_observation_warning_not_zero() -> None:
    data = csv_bytes("USA,United States,2000,,people,wb", "USA,United States,2001,4,people,wb")
    run = validate_csv(data, metric())

    assert run.report.status == "valid_with_warnings"
    assert issue_rows(run.report, "MISSING_VALUE") == [2]
    assert run.report.summary.missing_value_count == 1
    assert run.outcome is not None
    first = run.outcome.observations.iloc[0]
    assert bool(first["is_missing"])


@pytest.mark.parametrize(
    ("row", "code"),
    [
        (",United States,2000,1,people,wb", "MISSING_ENTITY_ID"),
        ("USA,,2000,1,people,wb", "MISSING_ENTITY_NAME"),
        ("USA,United States,,1,people,wb", "MISSING_PERIOD"),
        ("USA,United States,2000,1,,wb", "MISSING_UNIT"),
        ("USA,United States,2000,1,people,", "MISSING_SOURCE_ID"),
    ],
)
def test_missing_required_cells(row: str, code: str) -> None:
    report = validate_csv(csv_bytes(row), metric()).report
    assert report.status == "invalid"
    assert issue_rows(report, code) == [2]


@pytest.mark.parametrize(
    ("frequency", "period"),
    [
        ("yearly", "2020.0"),
        ("yearly", "2020-01"),
        ("yearly", "3000"),
        ("monthly", "2020-13"),
        ("monthly", "2020"),
        ("daily", "2021-02-29"),
        ("daily", "2020/01/01"),
    ],
)
def test_invalid_periods(frequency: str, period: str) -> None:
    data = csv_bytes(f"USA,United States,{period},1,people,wb")
    report = validate_csv(data, metric(frequency)).report  # type: ignore[arg-type]
    assert issue_rows(report, "INVALID_PERIOD") == [2]


def test_monthly_and_daily_periods_are_normalized() -> None:
    monthly = validate_csv(
        csv_bytes("A,Alpha,2020-11,1,u,s", "A,Alpha,2021-02,2,u,s"), metric("monthly")
    )
    assert monthly.report.summary.period_count == 4  # Nov, Dec, Jan, Feb
    daily = validate_csv(
        csv_bytes("A,Alpha,2024-02-28,1,u,s", "A,Alpha,2024-03-01,2,u,s"), metric("daily")
    )
    assert daily.report.summary.period_count == 3  # leap day included


def test_bce_years() -> None:
    run = validate_csv(csv_bytes("A,Alpha,-1,1,u,s", "A,Alpha,1,2,u,s"), metric())
    # Astronomical numbering: year 0 (1 BCE) lies between -1 and 1.
    assert run.report.summary.period_count == 3
    assert "MISSING_PERIODS" in codes(run.report)


def test_duplicate_entity_period_rows_are_reported_against_the_first_row() -> None:
    data = csv_bytes(
        "USA,United States,2000,1,people,wb",
        "CHN,China,2000,2,people,wb",
        "USA,United States,2000,3,people,wb",
    )
    report = validate_csv(data, metric()).report

    [issue] = [i for i in report.issues if i.code == "DUPLICATE_OBSERVATION"]
    assert issue.row == 4
    assert "row 2" in issue.message


def test_inconsistent_units_and_names() -> None:
    data = csv_bytes(
        "USA,United States,2000,1,people,wb",
        "USA,United States,2001,1,people,wb",
        "USA,USA,2002,1,people,wb",
        "CHN,China,2000,1,thousands,wb",
    )
    report = validate_csv(data, metric()).report

    assert issue_rows(report, "INCONSISTENT_ENTITY_NAME") == [4]
    assert issue_rows(report, "INCONSISTENT_UNIT") == [5]
    assert report.status == "invalid"


def test_unit_change_against_the_dataset_is_a_warning() -> None:
    data = csv_bytes("USA,United States,2000,1,people,wb")
    report = validate_csv(data, metric(), expected_unit="persons").report
    assert codes(report) == ["UNIT_CHANGED"]


def test_missing_years_per_entity_are_warnings() -> None:
    data = csv_bytes(
        "A,Alpha,2000,1,u,s",
        "A,Alpha,2003,4,u,s",
        "B,Beta,2000,1,u,s",
        "B,Beta,2001,1,u,s",
        "B,Beta,2002,1,u,s",
        "B,Beta,2003,1,u,s",
    )
    report = validate_csv(data, metric()).report

    [gap] = [i for i in report.issues if i.code == "MISSING_PERIODS"]
    assert gap.entity_id == "A"
    assert "2001, 2002" in gap.message
    assert report.status == "valid_with_warnings"


def test_special_characters_quotes_commas_newlines_and_unicode() -> None:
    data = (
        "﻿entity_id,entity_name,year,value,unit,source_id,notes\n"
        'CIV,"Côte d\'Ivoire, Republic of",2000,1,people,wb,"He said ""hi""\nsecond line"\n'
        "JPN,日本 🇯🇵,2000,2,people,wb,\n"
        'MEX,"México",2000,3,people,wb,"a,b,c"\n'
    ).encode()
    run = validate_csv(data, metric())

    assert run.report.status == "valid"
    assert run.outcome is not None
    obs = run.outcome.observations.set_index("entity_id")
    assert obs.loc["CIV", "entity_name"] == "Côte d'Ivoire, Republic of"
    assert obs.loc["CIV", "notes"] == 'He said "hi"\nsecond line'
    assert obs.loc["JPN", "entity_name"] == "日本 🇯🇵"
    # Row numbers count CSV records, so a multi-line field does not shift later rows.
    assert obs.loc["MEX", "row"] == 4


def test_unquoted_commas_shift_fields_and_are_reported() -> None:
    data = csv_bytes(
        "USA,United States,2000,1,people,wb", "KOR,Korea, Republic of,2000,1,people,wb"
    )
    report = validate_csv(data, metric()).report
    assert issue_rows(report, "FIELD_COUNT_MISMATCH") == [3]
    assert report.summary.row_count == 2


def test_unclosed_quote_is_malformed() -> None:
    data = csv_bytes("USA,United States,2000,1,people,wb", 'CHN,"China,2000,1,people,wb')
    report = validate_csv(data, metric()).report
    assert "CSV_MALFORMED" in codes(report, "error")


def test_non_utf8_and_binary_files_are_rejected() -> None:
    latin1 = "entity_id,entity_name,year,value,unit,source_id\nMEX,México,2000,1,u,s\n".encode(
        "latin-1"
    )
    report = validate_csv(latin1, metric()).report
    assert codes(report) == ["FILE_NOT_UTF8"]
    assert "line 2" in report.issues[0].message

    assert codes(validate_csv(b"PK\x03\x04\x00\x00", metric()).report) == ["FILE_BINARY"]
    assert codes(validate_csv(b"  \n", metric()).report) == ["FILE_EMPTY"]
    assert codes(validate_csv(csv_bytes(), metric()).report) == ["NO_DATA_ROWS"]


def test_blank_rows_are_reported_not_silently_dropped() -> None:
    data = csv_bytes("USA,United States,2000,1,people,wb", ",,,,,", "CHN,China,2000,2,people,wb")
    report = validate_csv(data, metric()).report
    assert issue_rows(report, "BLANK_ROW") == [3]
    assert report.summary.valid_row_count == 2


def test_invalid_urls_are_warnings_and_ignored() -> None:
    header = "entity_id,entity_name,year,value,unit,source_id,entity_image,source_url"
    data = csv_bytes(
        "USA,United States,2000,1,people,wb,javascript:alert(1),ftp://example.org/x", header=header
    )
    report = validate_csv(data, metric()).report
    assert sorted(codes(report)) == ["INVALID_IMAGE_URL", "INVALID_SOURCE_URL"]


def test_every_row_is_accounted_for() -> None:
    data = csv_bytes(
        "A,Alpha,2000,1,u,s",
        "B,Beta,2000,x,u,s",
        "C,,2000,1,u,s",
        "D,Delta,2000,1,u,s",
    )
    run = validate_csv(data, metric())
    error_rows = {i.row for i in run.report.issues if i.severity == "error"}
    assert run.outcome is not None
    valid_rows = set(run.outcome.observations["row"])
    assert error_rows | valid_rows == {2, 3, 4, 5}
    assert not error_rows & valid_rows


def test_row_limit() -> None:
    data = csv_bytes(*[f"E{i},Entity {i},2000,1,u,s" for i in range(5)])
    report = validate_csv(data, metric(), max_rows=3).report
    assert "TOO_MANY_ROWS" in codes(report, "error")


def test_large_csv_is_processed_quickly() -> None:
    entities, years = 300, 200  # 60,000 rows
    rows = [
        f"E{e:03d},Entity {e},{1824 + y},{(e * 7919 + y * 104729) % 100000 / 10},people,src"
        for e in range(entities)
        for y in range(years)
    ]
    data = csv_bytes(*rows)

    started = time.perf_counter()
    report, normalized = process_csv(data, DATASET_INFO, metric(), processing(top_n=10))
    elapsed = time.perf_counter() - started

    assert report.status == "valid", report.issues[:5]
    assert normalized is not None
    assert report.summary.row_count == 60_000
    assert len(normalized.observations) == 60_000
    assert len(normalized.rankings) == years
    assert all(len(r.entries) == 10 for r in normalized.rankings)
    assert elapsed < 30, f"took {elapsed:.1f}s"


def test_issue_lists_are_ordered_by_row() -> None:
    data = csv_bytes("A,Alpha,2000,x,u,s", "B,,2000,1,u,s", "C,Gamma,bad,1,u,s")
    rows = [i.row for i in validate_csv(data, metric()).report.issues]
    assert rows == sorted(r for r in rows if r is not None)
