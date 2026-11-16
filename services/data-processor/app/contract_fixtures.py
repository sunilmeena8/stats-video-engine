"""Generates the cross-language contract fixtures from the committed sample CSV.

    .venv/bin/python -m app.contract_fixtures            # rewrite the fixtures
    .venv/bin/python -m app.contract_fixtures --check    # exit 1 if they are stale

The TypeScript tests in packages/shared-schemas parse these files with the Zod schemas, so a
change to the Python models that the TypeScript contract does not accept fails a test.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from app.models import (
    InterpolationOptions,
    MetricConfiguration,
    NormalizedDatasetInfo,
    ProcessingOptions,
)
from app.processing.pipeline import process_csv

REPO_ROOT = Path(__file__).resolve().parents[3]
SAMPLE_CSV = REPO_ROOT / "samples/datasets/synthetic-ranking.csv"
FIXTURE_DIR = REPO_ROOT / "packages/shared-schemas/test/fixtures"

# Fields that legitimately differ between runs.
_VOLATILE = {"generatedAt", "durationMs"}


def build_fixtures() -> dict[str, dict[str, Any]]:
    report, normalized = process_csv(
        SAMPLE_CSV.read_bytes(),
        NormalizedDatasetInfo(
            id="0b7d6c2e-58f4-4c4b-9a8e-5d1f2a3b4c5d",
            slug="synthetic-ranking",
            title="Synthetic ranking (sample)",
            description="Synthetic sample data, not real statistics.",
            version_id="7e2c1a9b-3d4f-4e5a-8b6c-1d2e3f4a5b6c",
            version=1,
            original_filename="synthetic-ranking.csv",
            checksum_sha256="0" * 64,
        ),
        MetricConfiguration(frequency="yearly", ranking_order="desc", allow_negative=False),
        ProcessingOptions(
            top_n=4,
            missing_values="exclude",
            interpolation=InterpolationOptions(
                method="linear", steps_per_period=2, max_gap_periods=1, allow_large_gaps=False
            ),
        ),
    )
    if normalized is None:
        raise RuntimeError(f"Sample CSV is invalid: {report.issues}")
    return {
        "normalized-dataset.json": _stable(json.loads(normalized.model_dump_json(by_alias=True))),
        "validation-report.json": _stable(json.loads(report.model_dump_json(by_alias=True))),
    }


def _stable(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: (_placeholder(key) if key in _VOLATILE else _stable(item))
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_stable(item) for item in value]
    return value


def _placeholder(key: str) -> Any:
    return "2026-01-01T00:00:00.000Z" if key == "generatedAt" else 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if fixtures are stale")
    args = parser.parse_args()

    stale = []
    for name, content in build_fixtures().items():
        path = FIXTURE_DIR / name
        text = json.dumps(content, indent=2, ensure_ascii=False) + "\n"
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != text:
                stale.append(name)
        else:
            path.write_text(text, encoding="utf-8")
    if stale:
        sys.stderr.write(f"Stale contract fixtures: {', '.join(stale)}. Regenerate them.\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
