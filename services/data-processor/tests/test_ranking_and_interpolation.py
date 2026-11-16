"""Rankings, interpolation frames and the normalized output."""

import json

from app.models import NormalizedDataset
from app.processing.pipeline import process_csv
from tests.helpers import DATASET_INFO, csv_bytes, metric, processing


def build(
    *rows: str, order: str = "desc", header: str | None = None, **options: object
) -> NormalizedDataset:
    data = csv_bytes(*rows) if header is None else csv_bytes(*rows, header=header)
    report, normalized = process_csv(
        data,
        DATASET_INFO,
        metric(order=order),  # type: ignore[arg-type]
        processing(**options),  # type: ignore[arg-type]
    )
    assert normalized is not None, report.issues
    return normalized


def ranking(dataset: NormalizedDataset, period: str) -> list[tuple[str, float, int, int]]:
    [match] = [r for r in dataset.rankings if r.period == period]
    return [(e.entity_id, e.value, e.rank, e.position) for e in match.entries]


def test_descending_by_default_and_ascending_when_configured() -> None:
    rows = ("A,Alpha,2000,1,u,s", "B,Beta,2000,3,u,s", "C,Gamma,2000,2,u,s")
    assert [e[0] for e in ranking(build(*rows), "2000")] == ["B", "C", "A"]
    assert [e[0] for e in ranking(build(*rows, order="asc"), "2000")] == ["A", "C", "B"]


def test_ties_share_a_rank_and_are_ordered_by_entity_id() -> None:
    dataset = build(
        "C,Gamma,2000,5,u,s",
        "A,Alpha,2000,5,u,s",
        "D,Delta,2000,9,u,s",
        "B,Beta,2000,1,u,s",
    )
    assert ranking(dataset, "2000") == [
        ("D", 9.0, 1, 1),
        ("A", 5.0, 2, 2),
        ("C", 5.0, 2, 3),
        ("B", 1.0, 4, 4),
    ]


def test_tie_order_is_stable_regardless_of_row_order() -> None:
    rows = ["A,Alpha,2000,5,u,s", "B,Beta,2000,5,u,s", "C,Gamma,2000,5,u,s"]
    forward = ranking(build(*rows), "2000")
    backward = ranking(build(*reversed(rows)), "2000")
    assert forward == backward


def test_top_n_and_entities_entering_and_leaving() -> None:
    dataset = build(
        "A,Alpha,2000,30,u,s",
        "B,Beta,2000,20,u,s",
        "C,Gamma,2000,10,u,s",
        "A,Alpha,2001,30,u,s",
        "C,Gamma,2001,25,u,s",
        "D,Delta,2001,40,u,s",
        top_n=2,
    )
    first, second = dataset.rankings
    assert [e.entity_id for e in first.entries] == ["A", "B"]
    assert [e.entity_id for e in second.entries] == ["D", "A"]
    assert first.entered == ["A", "B"]
    assert second.entered == ["D"]
    assert second.exited == ["B"]


def test_missing_values_are_not_zero_unless_configured() -> None:
    rows = ("A,Alpha,2000,5,u,s", "B,Beta,2000,3,u,s", "A,Alpha,2001,,u,s", "A,Alpha,2002,7,u,s")
    excluded = build(*rows, method="none")
    assert ranking(excluded, "2001") == []

    zero = build(*rows, missing="zero", method="none")
    [entry] = next(r for r in zero.rankings if r.period == "2001").entries
    assert (entry.entity_id, entry.value, entry.value_kind) == ("A", 0.0, "zero_filled")
    # Zero-filling stays inside an entity's own span: B (2000 only) is not invented later.
    assert all(e.entity_id != "B" for r in zero.rankings[1:] for e in r.entries)


def test_original_observations_are_never_modified() -> None:
    dataset = build(
        "A,Alpha,2000,1.123456789,u,s",
        "A,Alpha,2003,4,u,s",
        "A,Alpha,2001,,u,s",
        allow_large_gaps=True,
        steps=4,
    )
    assert [(o.period, o.value, o.row) for o in dataset.observations] == [
        ("2000", 1.123456789, 2),
        ("2003", 4.0, 3),
        ("2001", None, 4),
    ]
    assert all(
        r.entries == [] or r.entries[0].value_kind != "interpolated" for r in dataset.rankings
    )


def test_linear_frames_mark_estimates() -> None:
    dataset = build("A,Alpha,2000,0,u,s", "A,Alpha,2001,10,u,s", steps=4)
    frames = [
        (f.from_period, f.progress, f.is_estimate, f.entries[0].value) for f in dataset.frames
    ]
    assert frames == [
        ("2000", 0.0, False, 0.0),
        ("2000", 0.25, True, 2.5),
        ("2000", 0.5, True, 5.0),
        ("2000", 0.75, True, 7.5),
        ("2001", 0.0, False, 10.0),
    ]
    assert dataset.interpolation.frame_count == 5
    assert dataset.interpolation.estimated_value_count == 3


def test_small_gaps_are_bridged_and_large_gaps_need_permission() -> None:
    rows = (
        "A,Alpha,2000,10,u,s",
        "A,Alpha,2002,30,u,s",  # 1 missing period: within maxGapPeriods=1
        "A,Alpha,2006,70,u,s",  # 3 missing periods: too long by default
    )
    default = build(*rows)
    assert [(g.from_, g.to) for g in default.interpolation.bridged_gaps] == [("2000", "2002")]
    assert [(g.from_, g.to, g.missing_periods) for g in default.interpolation.skipped_gaps] == [
        ("2002", "2006", 3)
    ]
    by_period = {f.from_period: f for f in default.frames}
    assert by_period["2001"].entries[0].value == 20.0
    assert by_period["2001"].entries[0].value_kind == "interpolated"
    assert by_period["2001"].is_estimate
    assert by_period["2004"].entries == []
    assert "GAP_NOT_INTERPOLATED" in [w.code for w in default.quality.warnings]

    permitted = build(*rows, allow_large_gaps=True)
    assert permitted.interpolation.skipped_gaps == []
    assert {f.from_period: f for f in permitted.frames}["2004"].entries[0].value == 50.0


def test_no_extrapolation_before_first_or_after_last_value() -> None:
    dataset = build(
        "A,Alpha,2000,1,u,s",
        "A,Alpha,2001,2,u,s",
        "B,Beta,2001,5,u,s",
        "B,Beta,2002,6,u,s",
        steps=2,
    )
    mid_2000 = dataset.frames[1]
    assert [e.entity_id for e in mid_2000.entries] == ["A"]  # B has not started yet
    mid_2001 = dataset.frames[3]
    assert [e.entity_id for e in mid_2001.entries] == ["B"]  # A has ended


def test_interpolation_none_keeps_one_frame_per_period() -> None:
    dataset = build("A,Alpha,2000,1,u,s", "A,Alpha,2002,3,u,s", method="none", steps=10)
    assert dataset.interpolation.steps_per_period == 1
    assert len(dataset.frames) == 3
    assert not any(f.is_estimate for f in dataset.frames)
    assert dataset.frames[1].entries == []


def test_normalized_output_sections() -> None:
    header = "entity_id,entity_name,year,value,unit,source_id,entity_category,source_url,notes"
    dataset = build(
        "A,Alpha,2000,1,people,wb,Europe,https://data.example.org/a,first",
        "B,Beta,2000,2,people,imf,,,",
        "A,Alpha,2002,3,people,wb,Europe,,",
        header=header,
    )
    body = json.loads(dataset.model_dump_json(by_alias=True))

    assert set(body) == {
        "schemaVersion",
        "generatedAt",
        "generator",
        "dataset",
        "metric",
        "processing",
        "timeRange",
        "entities",
        "sources",
        "observations",
        "rankings",
        "interpolation",
        "frames",
        "quality",
    }
    assert body["metric"] == {
        "frequency": "yearly",
        "rankingOrder": "desc",
        "allowNegative": False,
        "unit": "people",
    }
    assert body["timeRange"]["periods"] == ["2000", "2001", "2002"]
    assert body["entities"][0] == {
        "id": "A",
        "name": "Alpha",
        "category": "Europe",
        "imageUrl": None,
        "firstPeriod": "2000",
        "lastPeriod": "2002",
        "observationCount": 2,
        "missingPeriods": ["2001"],
    }
    assert body["sources"] == [
        {"id": "imf", "url": None, "observationCount": 1},
        {"id": "wb", "url": "https://data.example.org/a", "observationCount": 2},
    ]
    assert body["interpolation"]["bridgedGaps"][0] == {
        "entityId": "A",
        "from": "2000",
        "to": "2002",
        "missingPeriods": 1,
    }
    assert body["quality"]["status"] == "valid_with_warnings"


def test_empty_optional_cells_are_null_not_nan() -> None:
    header = "entity_id,entity_name,year,value,unit,source_id,notes"
    dataset = build("A,Alpha,2000,1,u,s,", "A,Alpha,2001,2,u,s,kept", header=header)
    assert [o.notes for o in dataset.observations] == [None, "kept"]
    body = dataset.model_dump_json(by_alias=True)
    assert "NaN" not in body and '"nan"' not in body
