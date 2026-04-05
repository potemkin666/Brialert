import json
import sqlite3
import sys
from pathlib import Path


def ensure_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA journal_mode = DELETE;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS source_state (
          source_id TEXT PRIMARY KEY,
          provider TEXT,
          lane TEXT,
          kind TEXT,
          successful_runs INTEGER NOT NULL DEFAULT 0,
          empty_runs INTEGER NOT NULL DEFAULT 0,
          failed_runs INTEGER NOT NULL DEFAULT 0,
          consecutive_failures INTEGER NOT NULL DEFAULT 0,
          consecutive_empty_runs INTEGER NOT NULL DEFAULT 0,
          last_checked_at TEXT,
          last_successful_at TEXT,
          last_failure_at TEXT,
          last_empty_at TEXT,
          last_deferred_at TEXT,
          cooldown_until TEXT,
          auto_skip_reason TEXT,
          last_built_count INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS source_run_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_at TEXT NOT NULL,
          source_id TEXT NOT NULL,
          provider TEXT,
          lane TEXT,
          kind TEXT,
          parsed_count INTEGER NOT NULL DEFAULT 0,
          hydrated_count INTEGER NOT NULL DEFAULT 0,
          filtered_count INTEGER NOT NULL DEFAULT 0,
          kept_count INTEGER NOT NULL DEFAULT 0,
          built_count INTEGER NOT NULL DEFAULT 0,
          error_count INTEGER NOT NULL DEFAULT 0,
          dropped_by_filter INTEGER NOT NULL DEFAULT 0,
          dropped_by_item_cap INTEGER NOT NULL DEFAULT 0,
          dropped_by_build_failures INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS alert_churn (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_at TEXT NOT NULL,
          action TEXT NOT NULL,
          alert_id TEXT NOT NULL,
          fused_incident_id TEXT,
          title TEXT,
          lane TEXT,
          region TEXT,
          source TEXT,
          published_at TEXT,
          retention_score REAL
        );

        CREATE TABLE IF NOT EXISTS watchlists (
          watch_id TEXT PRIMARY KEY,
          story_id TEXT,
          created_at TEXT,
          updated_at TEXT,
          notes TEXT
        );

        CREATE TABLE IF NOT EXISTS source_request_queue (
          request_id TEXT PRIMARY KEY,
          provider TEXT,
          endpoint TEXT,
          lane TEXT,
          region TEXT,
          kind TEXT,
          requested_at TEXT,
          status TEXT,
          detail TEXT
        );
        """
    )


def upsert_source_state(connection: sqlite3.Connection, generated_at: str, source_health: dict) -> None:
    rows = []
    for source_id, entry in (source_health or {}).items():
        if not isinstance(entry, dict):
            continue
        rows.append(
            (
                source_id,
                entry.get("provider"),
                entry.get("lane"),
                entry.get("kind"),
                int(entry.get("successfulRuns") or 0),
                int(entry.get("emptyRuns") or 0),
                int(entry.get("failedRuns") or 0),
                int(entry.get("consecutiveFailures") or 0),
                int(entry.get("consecutiveEmptyRuns") or 0),
                entry.get("lastCheckedAt"),
                entry.get("lastSuccessfulAt"),
                entry.get("lastFailureAt"),
                entry.get("lastEmptyAt"),
                entry.get("lastDeferredAt"),
                entry.get("cooldownUntil"),
                entry.get("autoSkipReason"),
                int(entry.get("lastBuiltCount") or 0),
                generated_at,
            )
        )

    connection.executemany(
        """
        INSERT INTO source_state (
          source_id, provider, lane, kind, successful_runs, empty_runs, failed_runs,
          consecutive_failures, consecutive_empty_runs, last_checked_at, last_successful_at,
          last_failure_at, last_empty_at, last_deferred_at, cooldown_until, auto_skip_reason,
          last_built_count, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_id) DO UPDATE SET
          provider = excluded.provider,
          lane = excluded.lane,
          kind = excluded.kind,
          successful_runs = excluded.successful_runs,
          empty_runs = excluded.empty_runs,
          failed_runs = excluded.failed_runs,
          consecutive_failures = excluded.consecutive_failures,
          consecutive_empty_runs = excluded.consecutive_empty_runs,
          last_checked_at = excluded.last_checked_at,
          last_successful_at = excluded.last_successful_at,
          last_failure_at = excluded.last_failure_at,
          last_empty_at = excluded.last_empty_at,
          last_deferred_at = excluded.last_deferred_at,
          cooldown_until = excluded.cooldown_until,
          auto_skip_reason = excluded.auto_skip_reason,
          last_built_count = excluded.last_built_count,
          updated_at = excluded.updated_at
        """,
        rows,
    )


def insert_run_history(connection: sqlite3.Connection, generated_at: str, source_stats: list) -> None:
    rows = []
    for stat in source_stats or []:
        if not isinstance(stat, dict):
            continue
        discard = stat.get("discardReasons") or {}
        rows.append(
            (
                generated_at,
                stat.get("id"),
                stat.get("provider"),
                stat.get("lane"),
                stat.get("kind"),
                int(stat.get("parsed") or 0),
                int(stat.get("hydrated") or 0),
                int(stat.get("filtered") or 0),
                int(stat.get("kept") or 0),
                int(stat.get("built") or 0),
                int(stat.get("errors") or 0),
                int(discard.get("droppedByFilter") or 0),
                int(discard.get("droppedByItemCap") or 0),
                int(discard.get("buildFailures") or 0),
            )
        )

    connection.executemany(
        """
        INSERT INTO source_run_history (
          run_at, source_id, provider, lane, kind, parsed_count, hydrated_count,
          filtered_count, kept_count, built_count, error_count,
          dropped_by_filter, dropped_by_item_cap, dropped_by_build_failures
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )


def insert_alert_churn(connection: sqlite3.Connection, generated_at: str, churn_rows: list) -> None:
    rows = []
    for row in churn_rows or []:
        if not isinstance(row, dict):
            continue
        rows.append(
            (
                generated_at,
                row.get("action"),
                row.get("alertId"),
                row.get("fusedIncidentId"),
                row.get("title"),
                row.get("lane"),
                row.get("region"),
                row.get("source"),
                row.get("publishedAt"),
                row.get("retentionScore"),
            )
        )

    connection.executemany(
        """
        INSERT INTO alert_churn (
          run_at, action, alert_id, fused_incident_id, title, lane, region,
          source, published_at, retention_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: sqlite-sync.py <snapshot-json>", file=sys.stderr)
        return 1

    snapshot_path = Path(sys.argv[1])
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    sqlite_path = Path(snapshot["sqlitePath"])
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(str(sqlite_path))
    try:
        ensure_schema(connection)
        upsert_source_state(connection, snapshot["generatedAt"], snapshot.get("sourceHealth") or {})
        insert_run_history(connection, snapshot["generatedAt"], snapshot.get("sourceStats") or [])
        insert_alert_churn(connection, snapshot["generatedAt"], snapshot.get("alertChurn") or [])
        connection.commit()
    finally:
        connection.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
