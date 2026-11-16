"""Rankings by period.

Ties are handled deterministically: tied values share a competition rank (1, 2, 2, 4) and are
displayed in entity id order (`position`). Entities without a value in a period are not ranked
there, unless the `zero` missing-value policy is explicitly configured.
"""

import pandas as pd

from app.models import (
    Frequency,
    MissingValuePolicy,
    PeriodRanking,
    RankedValue,
    RankingOrder,
    ValueKind,
)
from app.processing.periods import period_from_index
from app.processing.validate import as_int

#: Columns of a "values" table: one rankable value per entity and period.
VALUE_COLUMNS = ["entity_id", "period_index", "value", "value_kind"]


def rankable_values(observations: pd.DataFrame, missing_values: MissingValuePolicy) -> pd.DataFrame:
    """The values that may be ranked: observed values, plus zeros when explicitly configured.

    With `zero`, every period between an entity's first and last row (rows with empty values
    included) that lacks a value ranks as 0. Periods outside that span stay unranked, so
    entities still enter and leave the ranking.
    """
    observed = observations.loc[~observations["is_missing"], ["entity_id", "period_index", "value"]]
    values = observed.assign(value_kind="observed")
    if missing_values == "exclude":
        return values[VALUE_COLUMNS].reset_index(drop=True)

    have = set(zip(observed["entity_id"], observed["period_index"], strict=True))
    bounds = observations.groupby("entity_id", sort=True)["period_index"].agg(["min", "max"])
    fills = [
        (entity_id, index)
        for entity_id, low, high in bounds.itertuples()
        for index in range(as_int(low), as_int(high) + 1)
        if (entity_id, index) not in have
    ]
    zeros = pd.DataFrame(fills, columns=["entity_id", "period_index"]).assign(
        value=0.0, value_kind="zero_filled"
    )
    combined = pd.concat([values, zeros], ignore_index=True) if fills else values
    return combined[VALUE_COLUMNS].reset_index(drop=True)


def rank_values(values: pd.DataFrame, order: RankingOrder, top_n: int | None) -> pd.DataFrame:
    """Adds `rank` and `position` per period and keeps the top N positions."""
    if values.empty:
        return values.assign(rank=pd.Series(dtype="int64"), position=pd.Series(dtype="int64"))
    ranked = values.assign(sort_value=-values["value"] if order == "desc" else values["value"])
    ranked = ranked.sort_values(["period_index", "sort_value", "entity_id"], kind="mergesort")
    by_period = ranked.groupby("period_index", sort=False)
    ranked["position"] = by_period.cumcount() + 1
    ranked["rank"] = by_period["sort_value"].rank(method="min").astype("int64")
    if top_n is not None:
        ranked = ranked[ranked["position"] <= top_n]
    return ranked.drop(columns="sort_value").reset_index(drop=True)


def period_rankings(
    values: pd.DataFrame,
    span: tuple[int, int],
    frequency: Frequency,
    order: RankingOrder,
    top_n: int | None,
) -> list[PeriodRanking]:
    """One ranking per calendar period in `span` (empty for periods without values)."""
    ranked = rank_values(values, order, top_n)
    grouped = {as_int(index): group for index, group in ranked.groupby("period_index", sort=True)}

    rankings: list[PeriodRanking] = []
    previous: list[str] = []
    for index in range(span[0], span[1] + 1):
        group = grouped.get(index)
        entries = [] if group is None else _entries(group)
        current = [entry.entity_id for entry in entries]
        current_set, previous_set = set(current), set(previous)
        rankings.append(
            PeriodRanking.model_construct(
                period=period_from_index(index, frequency).label,
                entries=entries,
                entered=[e for e in current if e not in previous_set],
                exited=[e for e in previous if e not in current_set],
            )
        )
        previous = current
    return rankings


def _entries(group: pd.DataFrame) -> list[RankedValue]:
    return [
        RankedValue.model_construct(
            entity_id=str(entity_id),
            value=float(value),
            rank=int(rank),
            position=int(position),
            value_kind=_kind(kind),
        )
        for entity_id, value, rank, position, kind in zip(
            group["entity_id"],
            group["value"],
            group["rank"],
            group["position"],
            group["value_kind"],
            strict=True,
        )
    ]


def _kind(kind: object) -> ValueKind:
    if kind == "zero_filled":
        return "zero_filled"
    if kind == "interpolated":
        return "interpolated"
    return "observed"
