"""Ported from artifacts/api-server/src/app.ts (env resolution) and lib/db/src/index.ts (pool tuning)."""
from __future__ import annotations

from functools import lru_cache
from urllib.parse import urlparse

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    database_url: str

    session_secrets: str = ""
    data_encryption_key: str = ""

    allowed_origins: str = ""
    replit_domains: str = ""
    public_url: str = ""
    app_url: str = ""
    replit_expo_dev_domain: str = ""

    db_statement_timeout_ms: int = 30000
    db_lock_timeout_ms: int = 5000
    db_idle_in_tx_timeout_ms: int = 60000

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    def session_secret_list(self) -> list[str]:
        """Mirrors lib/api-token.ts getSecrets(): SESSION_SECRETS CSV (>=16 chars
        each) first, then fails hard in production if none configured."""
        out: list[str] = []
        for part in self.session_secrets.split(","):
            part = part.strip()
            if len(part) >= 16:
                out.append(part)
        if out:
            return out
        if self.is_production:
            raise RuntimeError(
                "SESSION_SECRETS is required in production to sign sessions/tokens."
            )
        return ["dev-api-token-secret-do-not-use-in-prod-aaaaaaaa"]


def resolve_allowed_origins(settings: Settings) -> list[str]:
    """Direct port of resolveAllowedOrigins() in app.ts:186-233."""
    out: set[str] = set()

    if settings.allowed_origins:
        for o in settings.allowed_origins.split(","):
            o = o.strip()
            if o:
                out.add(o)

    if settings.replit_domains:
        for d in settings.replit_domains.split(","):
            d = d.strip()
            if not d:
                continue
            url = d if d.startswith("http://") or d.startswith("https://") else f"https://{d}"
            out.add(url)

    for v in (settings.public_url, settings.app_url):
        if v:
            try:
                parsed = urlparse(v)
                if parsed.scheme and parsed.netloc:
                    out.add(f"{parsed.scheme}://{parsed.netloc}")
            except ValueError:
                pass

    if settings.replit_expo_dev_domain.strip():
        d = settings.replit_expo_dev_domain.strip()
        url = d if d.startswith("http") else f"https://{d}"
        out.add(url.rstrip("/"))

    if settings.replit_domains:
        for d in settings.replit_domains.split(","):
            d = d.strip()
            if not d:
                continue
            expo_variant = d
            if expo_variant.endswith(".spock.replit.dev"):
                expo_variant = expo_variant[: -len(".spock.replit.dev")] + ".expo.spock.replit.dev"
            elif expo_variant.count(".") == 1 and expo_variant.endswith(".replit.dev"):
                sub = expo_variant.split(".", 1)[0]
                expo_variant = f"{sub}.expo.replit.dev"
            if expo_variant != d:
                out.add(f"https://{expo_variant}")

    return list(out)


@lru_cache
def get_settings() -> Settings:
    return Settings()
