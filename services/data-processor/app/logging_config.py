"""Structured JSON logging that matches the field names of the Node services (pino)."""

import json
import logging
from datetime import UTC, datetime
from typing import Any

SERVICE_NAME = "data-processor"

# Attributes every LogRecord has; anything else was passed via `extra=` and is logged as a field.
# `color_message` is uvicorn's ANSI-colored duplicate of `msg`.
_STANDARD_ATTRIBUTES = frozenset(
    vars(logging.LogRecord("", logging.INFO, "", 0, "", None, None))
) | {"message", "asctime", "taskName", "color_message"}


class JsonFormatter(logging.Formatter):
    """Formats each record as one JSON object per line."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "level": record.levelname.lower(),
            "time": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "service": SERVICE_NAME,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        payload.update(
            {key: value for key, value in vars(record).items() if key not in _STANDARD_ATTRIBUTES}
        )
        if record.exc_info:
            payload["err"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def logging_config(level: str) -> dict[str, Any]:
    """`logging.config.dictConfig` schema routing app and uvicorn logs through JsonFormatter."""
    level_name = level.upper()
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {"json": {"()": JsonFormatter}},
        "handlers": {
            "stdout": {
                "class": "logging.StreamHandler",
                "formatter": "json",
                "stream": "ext://sys.stdout",
            }
        },
        "root": {"handlers": ["stdout"], "level": level_name},
        "loggers": {
            name: {"handlers": [], "level": level_name, "propagate": True}
            for name in ("uvicorn", "uvicorn.error", "uvicorn.access")
        },
    }
