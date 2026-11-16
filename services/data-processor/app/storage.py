"""Confines file access to the storage root.

Paths arrive from the API as storage-relative strings. They are resolved (following symlinks)
and must land inside an allowed top-level directory; anything else is refused.
"""

import os
import re
import uuid
from pathlib import Path, PurePosixPath


class StoragePathError(ValueError):
    pass


_WINDOWS_DRIVE = re.compile(r"^[A-Za-z]:")


def resolve_storage_path(
    storage_root: Path, relative: str, allowed_directories: tuple[str, ...]
) -> Path:
    if (
        not relative
        or "\x00" in relative
        or relative.startswith(("/", "\\"))
        or _WINDOWS_DRIVE.match(relative)
        or ".." in PurePosixPath(relative.replace("\\", "/")).parts
    ):
        raise StoragePathError(f"Not a safe storage-relative path: {relative!r}")
    candidate = (storage_root / relative).resolve()
    for directory in allowed_directories:
        base = (storage_root / directory).resolve()
        if candidate != base and candidate.is_relative_to(base):
            return candidate
    raise StoragePathError(
        f"{relative!r} is outside the allowed directories: {', '.join(allowed_directories)}"
    )


def write_atomically(path: Path, content: str) -> None:
    """Writes via a temporary file and rename, so readers never see a partial file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(content, encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
