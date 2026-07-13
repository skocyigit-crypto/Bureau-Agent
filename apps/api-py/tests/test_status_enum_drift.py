"""Guards the French status literals (db/enums.py) against accidental drift
from the values documented in the Node source (task-status-enum.md /
lib/db/src/schema/{tasks,calls}.ts).

A full version of this test (per plan §2.6) runs `SELECT DISTINCT status
FROM tasks` / `calls` against a live/staging DB snapshot and asserts every
observed value is a member of the enum — that requires DB access this
environment doesn't have. This is the DB-less proxy: it pins the enum
values themselves so nobody "fixes" a French literal into an English one
(or a legacy feminine variant) without the change being visible in review.
"""
from __future__ import annotations

from agent_bureau_api.db.enums import CallStatus, TaskPriority, TaskStatus


def test_task_status_values_match_node_source() -> None:
    assert {s.value for s in TaskStatus} == {"en_attente", "en_cours", "termine", "annule"}


def test_task_priority_values_match_node_source() -> None:
    assert {s.value for s in TaskPriority} == {"basse", "moyenne", "haute", "urgente"}


def test_call_status_values_match_node_source() -> None:
    assert {s.value for s in CallStatus} == {"repondu", "manque", "messagerie"}
