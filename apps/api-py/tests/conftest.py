from __future__ import annotations

import os

# Must be set before agent_bureau_api.settings.get_settings() is first
# called anywhere (including transitively via other imports in this test
# session) — pydantic-settings reads the environment at instantiation time.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost/test_placeholder")
os.environ.setdefault("SESSION_SECRETS", "test-secret-not-for-prod-use-0000000000")
os.environ.setdefault("ENVIRONMENT", "test")
