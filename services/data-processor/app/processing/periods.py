"""Time periods: parsing the CSV `year` column and walking the calendar.

Every period has a label (as written in outputs) and an integer index such that consecutive
calendar periods have consecutive indexes. Gaps and frame timing are computed on indexes.

Yearly periods use ISO 8601 astronomical numbering: year 0 is 1 BCE, -1 is 2 BCE.
"""

import re
from dataclasses import dataclass
from datetime import date

from app.models import Frequency

# Same bounds as YEAR_MIN / YEAR_MAX in packages/shared-schemas.
YEAR_MIN = -10_000
YEAR_MAX = 2_500

_YEARLY = re.compile(r"^-?\d{1,5}$")
_MONTHLY = re.compile(r"^(\d{4})-(\d{2})$")
_DAILY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")

_EXPECTED_FORMAT: dict[Frequency, str] = {
    "yearly": "a year such as 2020 (or -500 for BCE)",
    "monthly": "a month such as 2020-03",
    "daily": "a date such as 2020-03-15",
}


@dataclass(frozen=True, slots=True)
class Period:
    label: str
    index: int
    year: int


class PeriodError(ValueError):
    """A `year` cell that is not a valid period for the dataset's frequency."""


def parse_period(raw: str, frequency: Frequency) -> Period:
    """Parses one `year` cell. Raises PeriodError with a user-facing message."""
    if frequency == "yearly":
        if not _YEARLY.match(raw):
            raise PeriodError(_format_message(raw, frequency))
        year = int(raw)
        _check_year(year)
        return Period(label=str(year), index=year, year=year)

    if frequency == "monthly":
        match = _MONTHLY.match(raw)
        if not match:
            raise PeriodError(_format_message(raw, frequency))
        year, month = int(match.group(1)), int(match.group(2))
        _check_year(year, calendar=True)
        if not 1 <= month <= 12:
            raise PeriodError(f'"{raw}" has an invalid month ({month:02d})')
        return Period(label=f"{year:04d}-{month:02d}", index=year * 12 + month - 1, year=year)

    match = _DAILY.match(raw)
    if not match:
        raise PeriodError(_format_message(raw, frequency))
    year = int(match.group(1))
    _check_year(year, calendar=True)
    try:
        day = date(year, int(match.group(2)), int(match.group(3)))
    except ValueError as error:
        raise PeriodError(f'"{raw}" is not a calendar date ({error})') from None
    return Period(label=day.isoformat(), index=day.toordinal(), year=year)


def period_from_index(index: int, frequency: Frequency) -> Period:
    """Inverse of `parse_period(...).index`."""
    if frequency == "yearly":
        return Period(label=str(index), index=index, year=index)
    if frequency == "monthly":
        year, month0 = divmod(index, 12)
        return Period(label=f"{year:04d}-{month0 + 1:02d}", index=index, year=year)
    day = date.fromordinal(index)
    return Period(label=day.isoformat(), index=index, year=day.year)


def calendar_labels(start_index: int, end_index: int, frequency: Frequency) -> list[str]:
    """Labels of every period from start to end inclusive."""
    return [period_from_index(i, frequency).label for i in range(start_index, end_index + 1)]


def _check_year(year: int, *, calendar: bool = False) -> None:
    low = 1 if calendar else YEAR_MIN
    if not low <= year <= YEAR_MAX:
        raise PeriodError(f"Year {year} is outside the supported range {low} to {YEAR_MAX}")


def _format_message(raw: str, frequency: Frequency) -> str:
    return f'"{raw}" is not {_EXPECTED_FORMAT[frequency]} ({frequency} dataset)'
