"""HTTP endpoints: /validate, /process/csv and /rankings."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.helpers import DATASET_INFO, csv_bytes

METRIC = {"frequency": "yearly", "rankingOrder": "desc", "allowNegative": False}
PROCESSING = {
    "topN": None,
    "missingValues": "exclude",
    "interpolation": {
        "method": "linear",
        "stepsPerPeriod": 2,
        "maxGapPeriods": 1,
        "allowLargeGaps": False,
    },
}


@pytest.fixture
def storage(tmp_path: Path) -> Path:
    for name in ("datasets", "processed", "temp"):
        (tmp_path / name).mkdir()
    return tmp_path


@pytest.fixture
def client(storage: Path) -> TestClient:
    return TestClient(create_app(Settings(storage_root=storage, max_csv_bytes=10_000)))


def process_body(source: str, **overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "sourceFilePath": source,
        "outputFilePath": "processed/d/v.json",
        "reportFilePath": "processed/d/v.report.json",
        "dataset": json.loads(DATASET_INFO.model_dump_json(by_alias=True)),
        "metric": METRIC,
        "processing": PROCESSING,
    }
    body.update(overrides)
    return body


def test_process_csv_writes_output_and_full_report(client: TestClient, storage: Path) -> None:
    (storage / "datasets/d.csv").write_bytes(
        csv_bytes("A,Alpha,2000,1,u,s", "B,Beta,2000,2,u,s", "A,Alpha,2001,3,u,s")
    )
    response = client.post("/process/csv", json=process_body("datasets/d.csv"))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["outputFilePath"] == "processed/d/v.json"
    assert body["report"]["status"] == "valid"
    output = json.loads((storage / "processed/d/v.json").read_text())
    assert output["dataset"]["versionId"] == DATASET_INFO.version_id
    assert len(output["frames"]) == 3
    report = json.loads((storage / "processed/d/v.report.json").read_text())
    assert report["summary"]["rowCount"] == 3
    # The original upload is untouched.
    assert (storage / "datasets/d.csv").read_bytes().startswith(b"entity_id")


def test_invalid_csv_writes_a_report_but_no_output(client: TestClient, storage: Path) -> None:
    (storage / "datasets/bad.csv").write_bytes(csv_bytes("A,Alpha,2000,x,u,s"))
    response = client.post("/process/csv", json=process_body("datasets/bad.csv"))

    body = response.json()
    assert response.status_code == 200
    assert body["outputFilePath"] is None
    assert body["report"]["status"] == "invalid"
    assert body["report"]["issues"][0]["row"] == 2
    assert not (storage / "processed/d/v.json").exists()
    assert (storage / "processed/d/v.report.json").exists()


def test_inline_issues_are_capped_but_counts_and_report_file_are_complete(
    storage: Path,
) -> None:
    client = TestClient(create_app(Settings(storage_root=storage)))
    (storage / "datasets/many.csv").write_bytes(
        csv_bytes(*[f"E{i},Entity,2000,x,u,s" for i in range(1500)])
    )
    body = client.post("/process/csv", json=process_body("datasets/many.csv")).json()

    assert len(body["report"]["issues"]) == 1000
    assert body["report"]["issuesTruncated"] is True
    assert body["report"]["summary"]["issueCounts"]["INVALID_VALUE"] == 1500
    full = json.loads((storage / "processed/d/v.report.json").read_text())
    assert len(full["issues"]) >= 1500


@pytest.mark.parametrize(
    "path",
    ["../etc/passwd.csv", "/etc/passwd.csv", "datasets/../../x.csv", "processed/x.csv", "x.csv"],
)
def test_source_paths_must_stay_in_allowed_directories(client: TestClient, path: str) -> None:
    assert client.post("/process/csv", json=process_body(path)).status_code == 400


@pytest.mark.parametrize(
    "path", ["datasets/out.json", "processed/../datasets/out.json", "processed"]
)
def test_output_paths_must_stay_in_processed(client: TestClient, storage: Path, path: str) -> None:
    (storage / "datasets/d.csv").write_bytes(csv_bytes("A,Alpha,2000,1,u,s"))
    response = client.post("/process/csv", json=process_body("datasets/d.csv", outputFilePath=path))
    assert response.status_code == 400


def test_symlinks_out_of_storage_are_refused(
    client: TestClient, storage: Path, tmp_path_factory: pytest.TempPathFactory
) -> None:
    outside = tmp_path_factory.mktemp("outside") / "secret.csv"
    outside.write_text("secret")
    (storage / "datasets/link.csv").symlink_to(outside)
    assert client.post("/process/csv", json=process_body("datasets/link.csv")).status_code == 400


def test_size_limit_and_missing_files(client: TestClient, storage: Path) -> None:
    (storage / "datasets/big.csv").write_bytes(b"x" * 10_001)
    assert client.post("/process/csv", json=process_body("datasets/big.csv")).status_code == 413
    assert client.post("/process/csv", json=process_body("datasets/none.csv")).status_code == 404
    (storage / "datasets/run.sh").write_text("echo hi")
    assert client.post("/process/csv", json=process_body("datasets/run.sh")).status_code == 400


def test_unknown_request_fields_are_rejected(client: TestClient, storage: Path) -> None:
    (storage / "datasets/d.csv").write_bytes(csv_bytes("A,Alpha,2000,1,u,s"))
    body = process_body("datasets/d.csv", command="rm -rf /")
    assert client.post("/process/csv", json=body).status_code == 422


def test_validate_reports_without_writing(client: TestClient, storage: Path) -> None:
    (storage / "temp/upload.csv").write_bytes(csv_bytes("A,Alpha,2000,1,u,s", "A,Alpha,2000,2,u,s"))
    response = client.post(
        "/validate", json={"sourceFilePath": "temp/upload.csv", "metric": METRIC}
    )
    assert response.status_code == 200
    report = response.json()
    assert report["status"] == "invalid"
    assert report["issues"][0]["code"] == "DUPLICATE_OBSERVATION"
    assert list((storage / "processed").iterdir()) == []


def test_rankings_endpoint() -> None:
    client = TestClient(create_app(Settings()))
    response = client.post(
        "/rankings",
        json={
            "frequency": "yearly",
            "topN": 2,
            "observations": [
                {"entityId": "A", "period": "2000", "value": 5},
                {"entityId": "B", "period": "2000", "value": 5},
                {"entityId": "C", "period": "2000", "value": 9},
                {"entityId": "A", "period": "2002", "value": None},
            ],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["periods"] == ["2000", "2001", "2002"]
    assert body["rankings"][0]["entries"] == [
        {"entityId": "C", "value": 9.0, "rank": 1, "position": 1, "valueKind": "observed"},
        {"entityId": "A", "value": 5.0, "rank": 2, "position": 2, "valueKind": "observed"},
    ]
    assert body["rankings"][2]["entries"] == []


def test_rankings_endpoint_rejects_bad_periods_and_duplicates() -> None:
    client = TestClient(create_app(Settings()))
    response = client.post(
        "/rankings",
        json={
            "frequency": "monthly",
            "observations": [
                {"entityId": "A", "period": "2000", "value": 1},
                {"entityId": "B", "period": "2000-01", "value": 1},
                {"entityId": "B", "period": "2000-01", "value": 2},
            ],
        },
    )
    assert response.status_code == 422
    assert len(response.json()["detail"]) == 2
