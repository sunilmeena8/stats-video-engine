"""Configuration loaded from DATA_PROCESSOR_* environment variables (and an optional .env)."""

from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

LogLevel = Literal["debug", "info", "warning", "error", "critical"]


class Settings(BaseSettings):
    """Validated service settings. Invalid values raise a ValidationError at start-up."""

    model_config = SettingsConfigDict(
        env_prefix="DATA_PROCESSOR_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65_535)
    log_level: LogLevel = "info"
    storage_root: Path = Path("../../storage")
    # Largest CSV accepted, in bytes (the API enforces its own upload limit too).
    max_csv_bytes: int = Field(default=100 * 1024 * 1024, ge=1)
    max_csv_rows: int = Field(default=1_000_000, ge=1)

    @field_validator("storage_root")
    @classmethod
    def _resolve_storage_root(cls, value: Path) -> Path:
        return value.resolve()
