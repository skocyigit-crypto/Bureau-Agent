"""Ported from lib/logger + the pinoHttp config in app.ts:146-171.

Healthcheck paths are excluded from access logging to reduce noise, matching
the Node service's autoLogging.ignore predicate exactly.
"""
from __future__ import annotations

import logging

import structlog

HEALTHCHECK_PATHS = {"/api/healthz", "/api/health", "/healthz"}


def configure_logging() -> None:
    logging.basicConfig(format="%(message)s", level=logging.INFO)
    structlog.configure(
        processors=[
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.add_log_level,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str = "agent_bureau_api") -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)


def should_skip_access_log(path: str) -> bool:
    return path.split("?", 1)[0] in HEALTHCHECK_PATHS
