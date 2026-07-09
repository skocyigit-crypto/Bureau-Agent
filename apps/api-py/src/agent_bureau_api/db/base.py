from __future__ import annotations

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

# Explicit naming convention so Alembic-generated constraint names are stable.
# NOTE: Drizzle's own constraint-naming scheme (visible per-table via
# `uniqueIndex("api_keys_key_hash_uniq")`-style explicit names, or its default
# convention where left implicit) must be reconciled against whatever this
# produces BEFORE trusting an "empty diff" against the live DB (plan §2.4) —
# Alembic compares constraint names too, so a scheme mismatch here would
# manufacture spurious diff noise even when the actual columns/types match.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Shared declarative base for every ported table.

    Every model module under db/models/ registers its table(s) against this
    single metadata object, mirroring lib/db/src/schema/index.ts's role as
    the barrel re-export that Drizzle's migration tooling introspects.
    """

    metadata = MetaData(naming_convention=NAMING_CONVENTION)
