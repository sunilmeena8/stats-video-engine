"""CSV ingestion: bytes in, a table of trimmed text cells with CSV row numbers out.

Parsing uses the standard `csv` module in strict mode (RFC 4180 quoting: commas, quotes and
newlines inside quoted fields) so every record keeps its row number. Nothing is coerced here;
all values stay strings until validation. Rows that cannot be used are reported, never dropped
silently.
"""

import csv
import io
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass

import pandas as pd

from app.models import CsvColumnReport
from app.processing.issues import IssueCollector

REQUIRED_COLUMNS = ("entity_id", "entity_name", "year", "value", "unit", "source_id")
OPTIONAL_COLUMNS = ("entity_image", "entity_category", "source_url", "notes")
KNOWN_COLUMNS = REQUIRED_COLUMNS + OPTIONAL_COLUMNS

DEFAULT_MAX_ROWS = 1_000_000
# Large enough for any real cell; stops pathological single-field files early.
_FIELD_SIZE_LIMIT = 1_000_000


@dataclass
class IngestResult:
    columns: CsvColumnReport
    #: One row per usable CSV record: every known column (as str) plus `row` (int).
    table: pd.DataFrame
    #: Data records seen, including unusable ones (header excluded).
    row_count: int
    #: True when the header is unusable, so row-level validation must not run.
    header_failed: bool


def ingest_csv(
    data: bytes, issues: IssueCollector, *, max_rows: int = DEFAULT_MAX_ROWS
) -> IngestResult:
    empty = IngestResult(
        columns=CsvColumnReport(found=[], missing=list(REQUIRED_COLUMNS), unexpected=[]),
        table=_empty_table(),
        row_count=0,
        header_failed=True,
    )

    if not data.strip():
        issues.error("FILE_EMPTY", "The file is empty")
        return empty
    if b"\x00" in data:
        line = data[: data.index(b"\x00")].count(b"\n") + 1
        issues.error(
            "FILE_BINARY",
            f"The file contains NUL bytes (first on line {line}); it is not a text CSV",
        )
        return empty
    try:
        text = data.decode("utf-8-sig")  # tolerates a UTF-8 byte-order mark
    except UnicodeDecodeError as error:
        line = data[: error.start].count(b"\n") + 1
        issues.error(
            "FILE_NOT_UTF8",
            f"The file is not valid UTF-8 (invalid byte on line {line}). "
            "Re-export it as CSV UTF-8.",
        )
        return empty

    csv.field_size_limit(_FIELD_SIZE_LIMIT)
    reader = csv.reader(io.StringIO(text, newline=""), strict=True)
    try:
        raw_header = next(reader)
    except (csv.Error, StopIteration) as error:
        issues.error("CSV_MALFORMED", f"Could not read the header row: {error}", row=1)
        return empty

    header = [name.strip().lower() for name in raw_header]
    columns, header_ok = _check_header(header, issues)
    if not header_ok:
        # Count the remaining records so the summary is still truthful.
        return IngestResult(
            columns=columns,
            table=_empty_table(),
            row_count=_count_records(reader, issues),
            header_failed=True,
        )

    positions = {name: header.index(name) for name in KNOWN_COLUMNS if name in header}
    cells: dict[str, list[str]] = {name: [] for name in KNOWN_COLUMNS}
    rows: list[int] = []
    row_count = 0
    row_number = 1  # header

    try:
        for record in reader:
            row_number += 1
            row_count += 1
            if row_count > max_rows:
                issues.error(
                    "TOO_MANY_ROWS",
                    f"The file has more than {max_rows:,} data rows; split it into smaller files",
                    row=row_number,
                )
                row_count -= 1
                break
            if not any(field.strip() for field in record):
                issues.warning("BLANK_ROW", "Blank row ignored", row=row_number)
                continue
            if len(record) != len(header):
                issues.error(
                    "FIELD_COUNT_MISMATCH",
                    f"Expected {len(header)} fields but found {len(record)}. "
                    "Quote values that contain commas.",
                    row=row_number,
                )
                continue
            rows.append(row_number)
            for name in KNOWN_COLUMNS:
                position = positions.get(name)
                cells[name].append("" if position is None else record[position].strip())
    except csv.Error as error:
        issues.error(
            "CSV_MALFORMED",
            f"Malformed CSV at row {row_number + 1}: {error}. Check for an unclosed quote.",
            row=row_number + 1,
        )

    if row_count == 0:
        issues.error("NO_DATA_ROWS", "The file has a header but no data rows")

    table = pd.DataFrame({name: pd.Series(values, dtype=object) for name, values in cells.items()})
    table["row"] = pd.Series(rows, dtype="int64")
    return IngestResult(columns=columns, table=table, row_count=row_count, header_failed=False)


def _check_header(header: list[str], issues: IssueCollector) -> tuple[CsvColumnReport, bool]:
    duplicates = sorted(name for name, count in Counter(header).items() if count > 1)
    missing = [name for name in REQUIRED_COLUMNS if name not in header]
    unexpected = [name for name in header if name not in KNOWN_COLUMNS]
    columns = CsvColumnReport(found=header, missing=missing, unexpected=unexpected)

    if duplicates:
        issues.error(
            "DUPLICATE_COLUMNS",
            f"Columns appear more than once: {', '.join(duplicates)}",
            row=1,
            value=", ".join(duplicates),
        )
    if missing:
        issues.error(
            "MISSING_COLUMNS",
            f"Missing required columns: {', '.join(missing)}. "
            f"Required: {', '.join(REQUIRED_COLUMNS)}.",
            row=1,
            value=", ".join(missing),
        )
    if unexpected:
        issues.warning(
            "UNEXPECTED_COLUMNS",
            f"Unknown columns are ignored: {', '.join(name or '(blank)' for name in unexpected)}",
            row=1,
            value=", ".join(unexpected),
        )
    return columns, not duplicates and not missing


def _count_records(reader: Iterator[list[str]], issues: IssueCollector) -> int:
    count = 0
    try:
        for _ in reader:
            count += 1
    except csv.Error as error:
        issues.error("CSV_MALFORMED", f"Malformed CSV after row {count + 1}: {error}")
    return count


def _empty_table() -> pd.DataFrame:
    table = pd.DataFrame({name: pd.Series([], dtype=object) for name in KNOWN_COLUMNS})
    table["row"] = pd.Series([], dtype="int64")
    return table
