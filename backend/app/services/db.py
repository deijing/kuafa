"""Minimal SQLite persistence for generate + cover jobs (personal use)."""

from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

from app.config import settings
from app.models import CoverJobOut, JobOut

_LOCK = threading.Lock()
_INITIALIZED = False


def db_path() -> Path:
    return Path(settings.db_path)


def _connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


@contextmanager
def _db():
    with _LOCK:
        conn = _connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def init_db() -> None:
    global _INITIALIZED
    with _db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS generate_jobs (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_generate_jobs_created
                ON generate_jobs(created_at DESC);

            CREATE TABLE IF NOT EXISTS cover_jobs (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_cover_jobs_created
                ON cover_jobs(created_at DESC);
            """
        )
    _INITIALIZED = True


def ensure_db() -> None:
    if not _INITIALIZED:
        init_db()


def upsert_generate_job(job: JobOut) -> None:
    ensure_db()
    with _db() as conn:
        conn.execute(
            """
            INSERT INTO generate_jobs (id, created_at, payload)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                created_at = excluded.created_at,
                payload = excluded.payload
            """,
            (job.id, job.created_at, job.model_dump_json()),
        )


def get_generate_job(job_id: str) -> JobOut | None:
    ensure_db()
    with _db() as conn:
        row = conn.execute(
            "SELECT payload FROM generate_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
    if not row:
        return None
    return JobOut.model_validate_json(row["payload"])


def list_generate_jobs() -> list[JobOut]:
    ensure_db()
    with _db() as conn:
        rows = conn.execute(
            "SELECT payload FROM generate_jobs ORDER BY created_at DESC"
        ).fetchall()
    return [JobOut.model_validate_json(r["payload"]) for r in rows]


def delete_generate_job(job_id: str) -> bool:
    ensure_db()
    with _db() as conn:
        cur = conn.execute("DELETE FROM generate_jobs WHERE id = ?", (job_id,))
        return cur.rowcount > 0


def upsert_cover_job(job: CoverJobOut) -> None:
    ensure_db()
    with _db() as conn:
        conn.execute(
            """
            INSERT INTO cover_jobs (id, created_at, payload)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                created_at = excluded.created_at,
                payload = excluded.payload
            """,
            (job.id, job.created_at, job.model_dump_json()),
        )


def get_cover_job(job_id: str) -> CoverJobOut | None:
    ensure_db()
    with _db() as conn:
        row = conn.execute(
            "SELECT payload FROM cover_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
    if not row:
        return None
    return CoverJobOut.model_validate_json(row["payload"])


def list_cover_jobs() -> list[CoverJobOut]:
    ensure_db()
    with _db() as conn:
        rows = conn.execute(
            "SELECT payload FROM cover_jobs ORDER BY created_at DESC"
        ).fetchall()
    return [CoverJobOut.model_validate_json(r["payload"]) for r in rows]


def delete_cover_job(job_id: str) -> bool:
    ensure_db()
    with _db() as conn:
        cur = conn.execute("DELETE FROM cover_jobs WHERE id = ?", (job_id,))
        return cur.rowcount > 0


def delete_all_cover_jobs() -> int:
    ensure_db()
    with _db() as conn:
        cur = conn.execute("DELETE FROM cover_jobs")
        return cur.rowcount

