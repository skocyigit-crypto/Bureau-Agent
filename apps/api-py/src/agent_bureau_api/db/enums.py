"""Application-layer representation of the French status literals that live
as plain TEXT columns in Postgres (see plan §2.6 — no native Postgres enum,
no CHECK constraint, so existing/malformed rows keep failing silently on an
unknown literal rather than erroring; only NEW Python-side code gets a
structural guard against typos/drift).

Also collapses the two independently-defined-but-must-stay-identical role
hierarchies (middleware/auth.ts ROLE_HIERARCHY vs middleware/tenant-guard.ts
ROLE_HIERARCHY — same ordering, different numeric scales) into one Python
source of truth, per plan §2.6.
"""
from __future__ import annotations

from enum import StrEnum, IntEnum


class TaskStatus(StrEnum):
    EN_ATTENTE = "en_attente"
    EN_COURS = "en_cours"
    TERMINE = "termine"
    ANNULE = "annule"


class TaskPriority(StrEnum):
    BASSE = "basse"
    MOYENNE = "moyenne"
    HAUTE = "haute"
    URGENTE = "urgente"


class CallStatus(StrEnum):
    REPONDU = "repondu"
    MANQUE = "manque"
    MESSAGERIE = "messagerie"


class CallDirection(StrEnum):
    ENTRANT = "entrant"
    SORTANT = "sortant"


class UserRole(StrEnum):
    LECTURE_SEULE = "lecture_seule"
    AGENT = "agent"
    ADMINISTRATEUR = "administrateur"
    SUPER_ADMIN = "super_admin"


class RoleRank(IntEnum):
    """Single source of truth for role ordering — was two independently
    maintained numeric scales in the Node codebase (auth.ts: 1/2/3/4 vs
    tenant-guard.ts: 5/20/50/100). Same relative ordering, collapsed here."""

    LECTURE_SEULE = 5
    AGENT = 20
    ADMINISTRATEUR = 50
    SUPER_ADMIN = 100


ROLE_HIERARCHY: dict[str, int] = {
    UserRole.LECTURE_SEULE: RoleRank.LECTURE_SEULE,
    UserRole.AGENT: RoleRank.AGENT,
    UserRole.ADMINISTRATEUR: RoleRank.ADMINISTRATEUR,
    UserRole.SUPER_ADMIN: RoleRank.SUPER_ADMIN,
}

TENANT_ASSIGNABLE_ROLES = {UserRole.ADMINISTRATEUR, UserRole.AGENT, UserRole.LECTURE_SEULE}
PROTECTED_ROLE = UserRole.SUPER_ADMIN


class SubscriptionStatus(StrEnum):
    ACTIVE = "active"
    CANCELLED = "cancelled"
    ANNULEE = "annulee"
    SUSPENDED = "suspended"
    PAST_DUE = "past_due"


class SubscriptionPlan(StrEnum):
    ESSAI = "essai"
    STARTER = "starter"
    PROFESSIONNEL = "professionnel"
    ENTREPRISE = "entreprise"
