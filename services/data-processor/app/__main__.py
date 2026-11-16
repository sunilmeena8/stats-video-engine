"""Entry point: `python -m app [--reload]`."""

import argparse

import uvicorn

from app.config import Settings
from app.logging_config import logging_config


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Statsopedia data-processor.")
    parser.add_argument(
        "--reload", action="store_true", help="Restart on code changes (development only)."
    )
    args = parser.parse_args()

    settings = Settings()
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
        reload=args.reload,
        log_config=logging_config(settings.log_level),
    )


if __name__ == "__main__":
    main()
