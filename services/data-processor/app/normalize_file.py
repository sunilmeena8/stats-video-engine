"""Offline CSV → normalized JSON, through the same pipeline as POST /process/csv.

    .venv/bin/python -m app.normalize_file input.csv output.json --title "My dataset" \\
        [--frequency yearly] [--order desc] [--allow-negative] [--top-n 20] \\
        [--missing exclude] [--interpolation linear] [--max-gap 1] [--allow-large-gaps]

Used to produce the renderer's sample input and to inspect a CSV without the API. Ids are
derived from the slug (UUID v5), so re-running on the same file gives the same ids.
Exits with status 1 and prints the issues when the CSV has blocking errors.
"""

import argparse
import hashlib
import re
import sys
import uuid
from pathlib import Path

from app.models import (
    InterpolationOptions,
    MetricConfiguration,
    NormalizedDatasetInfo,
    ProcessingOptions,
)
from app.processing.pipeline import process_csv

_NAMESPACE = uuid.UUID("5f0c6a3e-7d21-4f7b-9a43-2b6e8c1d0f55")


def _slugify(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return slug[:80].rstrip("-") or "dataset"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("csv", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--title", required=True)
    parser.add_argument("--description")
    parser.add_argument("--frequency", choices=["yearly", "monthly", "daily"], default="yearly")
    parser.add_argument("--order", choices=["desc", "asc"], default="desc")
    parser.add_argument("--allow-negative", action="store_true")
    parser.add_argument("--top-n", type=int)
    parser.add_argument("--missing", choices=["exclude", "zero"], default="exclude")
    parser.add_argument("--interpolation", choices=["linear", "none"], default="linear")
    parser.add_argument("--max-gap", type=int, default=1)
    parser.add_argument("--allow-large-gaps", action="store_true")
    args = parser.parse_args()

    data = args.csv.read_bytes()
    slug = _slugify(args.title)
    report, normalized = process_csv(
        data,
        NormalizedDatasetInfo(
            id=str(uuid.uuid5(_NAMESPACE, slug)),
            slug=slug,
            title=args.title,
            description=args.description,
            version_id=str(uuid.uuid5(_NAMESPACE, f"{slug}/v1")),
            version=1,
            original_filename=args.csv.name,
            checksum_sha256=hashlib.sha256(data).hexdigest(),
        ),
        MetricConfiguration(
            frequency=args.frequency,
            ranking_order=args.order,
            allow_negative=args.allow_negative,
        ),
        ProcessingOptions(
            top_n=args.top_n,
            missing_values=args.missing,
            interpolation=InterpolationOptions(
                method=args.interpolation,
                steps_per_period=1,
                max_gap_periods=args.max_gap,
                allow_large_gaps=args.allow_large_gaps,
            ),
        ),
    )
    for issue in report.issues:
        row = f"row {issue.row}" if issue.row is not None else "file"
        sys.stderr.write(f"{issue.severity.upper():7} {row:>9}  {issue.code}: {issue.message}\n")
    if normalized is None:
        sys.stderr.write(f"Invalid CSV: {report.summary.error_count} blocking error(s)\n")
        sys.exit(1)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(normalized.model_dump_json(by_alias=True), encoding="utf-8")
    sys.stderr.write(
        f"Wrote {args.output} ({report.summary.row_count} rows, "
        f"{report.summary.entity_count} entities, {len(normalized.rankings)} periods)\n"
    )


if __name__ == "__main__":
    main()
