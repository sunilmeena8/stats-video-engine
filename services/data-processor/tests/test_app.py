import json
import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings
from app.logging_config import JsonFormatter
from app.main import REQUIRED_STORAGE_DIRECTORIES, create_app


def make_client(storage_root: Path) -> TestClient:
    return TestClient(create_app(Settings(storage_root=storage_root)))


def test_health_reports_liveness_in_the_shared_contract_shape(tmp_path: Path) -> None:
    response = make_client(tmp_path).get("/health")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    # camelCase keys, as validated by healthResponseSchema in packages/shared-schemas.
    assert set(body) == {"status", "service", "version", "uptimeSeconds", "timestamp", "checks"}
    assert body["status"] == "ok"
    assert body["service"] == "data-processor"
    assert body["checks"] == {}


def test_ready_is_ok_when_storage_directories_are_writable(tmp_path: Path) -> None:
    for name in REQUIRED_STORAGE_DIRECTORIES:
        (tmp_path / name).mkdir()

    response = make_client(tmp_path).get("/health/ready")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["checks"]["storage"]["status"] == "up"
    assert body["checks"]["storage"]["error"] is None


def test_ready_is_degraded_when_storage_is_missing(tmp_path: Path) -> None:
    response = make_client(tmp_path / "missing").get("/health/ready")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert body["checks"]["storage"]["status"] == "down"
    assert "datasets" in body["checks"]["storage"]["error"]


def test_settings_read_prefixed_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATA_PROCESSOR_PORT", "9123")
    monkeypatch.setenv("DATA_PROCESSOR_LOG_LEVEL", "debug")

    settings = Settings(_env_file=None)

    assert settings.port == 9123
    assert settings.log_level == "debug"
    assert settings.storage_root.is_absolute()


def test_settings_reject_invalid_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATA_PROCESSOR_PORT", "70000")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_json_formatter_emits_one_structured_object() -> None:
    record = logging.LogRecord("app", logging.WARNING, __file__, 1, "Disk %s", ("full",), None)
    record.datasetId = "abc"

    payload = json.loads(JsonFormatter().format(record))

    assert payload["level"] == "warning"
    assert payload["msg"] == "Disk full"
    assert payload["service"] == "data-processor"
    assert payload["datasetId"] == "abc"
    assert payload["time"].endswith("+00:00")
