"""Animation frames with visual interpolation between known values.

Interpolated values are visual estimates: they are marked `interpolated`, frames containing them
are marked `isEstimate`, and the original observations are never modified. Gaps longer than
`maxGapPeriods` are only bridged with explicit permission (`allowLargeGaps`); otherwise the
entity leaves the frames for the gap. Values are never extrapolated before an entity's first
or after its last value.
"""

from dataclasses import dataclass
from itertools import pairwise

import numpy as np
import numpy.typing as npt
import pandas as pd

from app.models import (
    AnimationFrame,
    Frequency,
    InterpolationGap,
    InterpolationMetadata,
    InterpolationOptions,
    RankedValue,
    RankingOrder,
    ValueKind,
)
from app.processing.periods import period_from_index

#: Upper bound on ranked entries across all frames, to keep output files a sensible size.
MAX_FRAME_ENTRIES = 2_000_000
#: Upper bound on the entity x period working matrix.
MAX_MATRIX_CELLS = 30_000_000

_NONE, _OBSERVED, _ZERO, _INTERPOLATED = 0, 1, 2, 3
_KIND_CODES = {"observed": _OBSERVED, "zero_filled": _ZERO, "interpolated": _INTERPOLATED}
_KIND_NAMES: dict[int, ValueKind] = {
    _OBSERVED: "observed",
    _ZERO: "zero_filled",
    _INTERPOLATED: "interpolated",
}


class OutputTooLargeError(ValueError):
    """The requested frames would exceed the output size limits."""


@dataclass
class FrameResult:
    frames: list[AnimationFrame]
    metadata: InterpolationMetadata


def build_frames(
    values: pd.DataFrame,
    span: tuple[int, int],
    frequency: Frequency,
    order: RankingOrder,
    top_n: int | None,
    options: InterpolationOptions,
) -> FrameResult:
    entities = sorted(values["entity_id"].unique().tolist())
    start, end = span
    period_count = end - start + 1
    linear = options.method == "linear"
    steps = options.steps_per_period if linear else 1
    frame_count = (period_count - 1) * steps + 1

    if len(entities) * period_count > MAX_MATRIX_CELLS:
        raise OutputTooLargeError(
            f"{len(entities):,} entities x {period_count:,} periods is too large to animate"
        )
    per_frame = len(entities) if top_n is None else min(top_n, len(entities))
    if frame_count * per_frame > MAX_FRAME_ENTRIES:
        raise OutputTooLargeError(
            f"{frame_count:,} frames x {per_frame:,} entries exceeds {MAX_FRAME_ENTRIES:,}; "
            "lower stepsPerPeriod or set topN"
        )

    position_of = {entity: i for i, entity in enumerate(entities)}
    matrix = np.full((len(entities), period_count), np.nan)
    kinds = np.zeros((len(entities), period_count), dtype=np.int8)
    rows = values["entity_id"].map(position_of).to_numpy()
    cols = values["period_index"].to_numpy() - start
    matrix[rows, cols] = values["value"].to_numpy(dtype=float)
    kinds[rows, cols] = values["value_kind"].map(_KIND_CODES).to_numpy(dtype=np.int8)

    bridged, skipped = _fill_gaps(matrix, kinds, entities, start, frequency, options)

    labels = [period_from_index(start + i, frequency).label for i in range(period_count)]
    entity_ids = np.array(entities, dtype=object)
    frames: list[AnimationFrame] = []
    estimated = 0
    for column in range(period_count):
        is_last = column == period_count - 1
        for step in range(1 if is_last else steps):
            progress = step / steps
            if step == 0:
                current = matrix[:, column]
                present = ~np.isnan(current)
                frame_kinds = kinds[:, column]
            else:
                a, b = matrix[:, column], matrix[:, column + 1]
                present = ~np.isnan(a) & ~np.isnan(b)
                current = a + (b - a) * progress
                frame_kinds = np.where(present, _INTERPOLATED, _NONE).astype(np.int8)
            entries = _rank_frame(current, present, frame_kinds, entity_ids, order, top_n)
            frame_estimates = sum(1 for e in entries if e.value_kind == "interpolated")
            estimated += frame_estimates
            frames.append(
                AnimationFrame.model_construct(
                    index=len(frames),
                    from_period=labels[column],
                    to_period=None if is_last else labels[column + 1],
                    progress=progress,
                    is_estimate=frame_estimates > 0,
                    entries=entries,
                )
            )

    metadata = InterpolationMetadata(
        method=options.method,
        steps_per_period=steps,
        max_gap_periods=options.max_gap_periods,
        allow_large_gaps=options.allow_large_gaps,
        frame_count=len(frames),
        estimated_value_count=estimated,
        bridged_gaps=bridged,
        skipped_gaps=skipped,
    )
    return FrameResult(frames=frames, metadata=metadata)


def _fill_gaps(
    matrix: npt.NDArray[np.float64],
    kinds: npt.NDArray[np.int8],
    entities: list[str],
    start: int,
    frequency: Frequency,
    options: InterpolationOptions,
) -> tuple[list[InterpolationGap], list[InterpolationGap]]:
    """Linearly bridges allowed gaps in place. Returns (bridged, skipped) gaps."""
    bridged: list[InterpolationGap] = []
    skipped: list[InterpolationGap] = []
    for row, entity in enumerate(entities):
        known = np.flatnonzero(~np.isnan(matrix[row]))
        for left, right in pairwise(known):
            missing = int(right - left - 1)
            if missing == 0:
                continue
            gap = InterpolationGap.model_validate(
                {
                    "entity_id": entity,
                    "from": period_from_index(start + int(left), frequency).label,
                    "to": period_from_index(start + int(right), frequency).label,
                    "missing_periods": missing,
                }
            )
            allowed = options.method == "linear" and (
                missing <= options.max_gap_periods or options.allow_large_gaps
            )
            if not allowed:
                skipped.append(gap)
                continue
            fractions = np.arange(1, missing + 1) / (missing + 1)
            low, high = matrix[row, left], matrix[row, right]
            matrix[row, left + 1 : right] = low + (high - low) * fractions
            kinds[row, left + 1 : right] = _INTERPOLATED
            bridged.append(gap)
    return bridged, skipped


def _rank_frame(
    values: npt.NDArray[np.float64],
    present: npt.NDArray[np.bool_],
    kinds: npt.NDArray[np.int8],
    entity_ids: npt.NDArray[np.object_],
    order: RankingOrder,
    top_n: int | None,
) -> list[RankedValue]:
    candidates = np.flatnonzero(present)
    if candidates.size == 0:
        return []
    keys = values[candidates]
    sort_keys = -keys if order == "desc" else keys
    # Entities are pre-sorted by id, so the matrix row number breaks ties by entity id.
    ordering = candidates[np.lexsort((candidates, sort_keys))]
    if top_n is not None:
        # A competition rank depends only on the entries above it, so truncating is safe.
        ordering = ordering[:top_n]

    entries: list[RankedValue] = []
    rank = 0
    previous: float | None = None
    for position, row in enumerate(ordering, start=1):
        value = float(values[row])
        if previous is None or value != previous:
            rank = position
        previous = value
        entries.append(
            RankedValue.model_construct(
                entity_id=str(entity_ids[row]),
                value=value,
                rank=rank,
                position=position,
                value_kind=_KIND_NAMES[int(kinds[row])],
            )
        )
    return entries
