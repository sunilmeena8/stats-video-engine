"""Collects validation issues. Every issue is kept; truncation only happens when reporting."""

from collections import Counter

from app.models import ErrorCode, IssueCode, ValidationIssue, WarningCode

# Cell values echoed back in issues are cut to this length.
MAX_ECHOED_VALUE_LENGTH = 120


class IssueCollector:
    def __init__(self) -> None:
        self._issues: list[ValidationIssue] = []

    def error(
        self,
        code: ErrorCode,
        message: str,
        *,
        row: int | None = None,
        column: str | None = None,
        entity_id: str | None = None,
        value: str | None = None,
    ) -> None:
        self._add("error", code, message, row, column, entity_id, value)

    def warning(
        self,
        code: WarningCode,
        message: str,
        *,
        row: int | None = None,
        column: str | None = None,
        entity_id: str | None = None,
        value: str | None = None,
    ) -> None:
        self._add("warning", code, message, row, column, entity_id, value)

    def _add(
        self,
        severity: str,
        code: IssueCode,
        message: str,
        row: int | None,
        column: str | None,
        entity_id: str | None,
        value: str | None,
    ) -> None:
        if value is not None and len(value) > MAX_ECHOED_VALUE_LENGTH:
            value = value[: MAX_ECHOED_VALUE_LENGTH - 1] + "…"
        self._issues.append(
            ValidationIssue.model_validate(
                {
                    "severity": severity,
                    "code": code,
                    "message": message,
                    "row": row,
                    "column": column,
                    "entity_id": entity_id,
                    "value": value,
                }
            )
        )

    @property
    def has_errors(self) -> bool:
        return any(issue.severity == "error" for issue in self._issues)

    def sorted(self) -> list[ValidationIssue]:
        """File-level issues first, then by row, then errors before warnings."""
        return sorted(
            self._issues,
            key=lambda i: (
                -1 if i.row is None else i.row,
                0 if i.severity == "error" else 1,
                i.code,
            ),
        )

    def counts(self) -> tuple[int, int, dict[str, int]]:
        """(error count, warning count, count per code)."""
        errors = sum(1 for i in self._issues if i.severity == "error")
        by_code = Counter(i.code for i in self._issues)
        return errors, len(self._issues) - errors, dict(sorted(by_code.items()))

    def error_rows(self) -> set[int]:
        return {i.row for i in self._issues if i.severity == "error" and i.row is not None}
