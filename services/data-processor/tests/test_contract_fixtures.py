"""The committed contract fixtures must match what the processor generates today."""

import json

from app.contract_fixtures import FIXTURE_DIR, build_fixtures


def test_contract_fixtures_are_current() -> None:
    for name, content in build_fixtures().items():
        committed = json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))
        assert committed == content, (
            f"{name} is stale: run `.venv/bin/python -m app.contract_fixtures`"
        )
