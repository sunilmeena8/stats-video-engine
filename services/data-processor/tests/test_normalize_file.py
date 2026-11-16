"""The offline CSV → normalized JSON command."""

import json
import sys
from pathlib import Path

import pytest

from app import normalize_file
from tests.helpers import csv_bytes


def run(monkeypatch: pytest.MonkeyPatch, *args: str) -> None:
    monkeypatch.setattr(sys, "argv", ["normalize_file", *args])
    normalize_file.main()


def test_writes_normalized_json_with_stable_ids(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "in.csv"
    source.write_bytes(csv_bytes("A,Alpha,2000,1,u,s", "A,Alpha,2001,2,u,s"))
    first, second = tmp_path / "a.json", tmp_path / "b.json"
    run(monkeypatch, str(source), str(first), "--title", "Test Data")
    run(monkeypatch, str(source), str(second), "--title", "Test Data")

    a, b = json.loads(first.read_text()), json.loads(second.read_text())
    assert a["dataset"]["slug"] == "test-data"
    assert a["dataset"]["id"] == b["dataset"]["id"]
    assert len(a["dataset"]["checksumSha256"]) == 64
    assert [r["period"] for r in a["rankings"]] == ["2000", "2001"]


def test_exits_with_an_error_for_invalid_csv(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    source = tmp_path / "bad.csv"
    source.write_bytes(csv_bytes("A,Alpha,2000,abc,u,s"))
    with pytest.raises(SystemExit) as exit_info:
        run(monkeypatch, str(source), str(tmp_path / "out.json"), "--title", "Bad")
    assert exit_info.value.code == 1
    assert "row 2" in capsys.readouterr().err
    assert not (tmp_path / "out.json").exists()
