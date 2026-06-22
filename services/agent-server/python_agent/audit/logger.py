import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


class AuditLogger:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def record(self, event_type: str, payload: dict) -> dict:
        event = {
            "id": f"audit_{uuid4().hex}",
            "type": event_type,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "payload": payload
        }
        with sqlite3.connect(self.db_path) as connection:
            connection.execute(
                "insert into audit_logs (id, type, created_at, payload) values (?, ?, ?, ?)",
                (event["id"], event["type"], event["created_at"], json.dumps(event["payload"], ensure_ascii=False))
            )
            connection.commit()
        return event

    def list(self, limit: int = 100) -> list[dict]:
        with sqlite3.connect(self.db_path) as connection:
            rows = connection.execute(
                "select id, type, created_at, payload from audit_logs order by created_at desc limit ?",
                (limit,)
            ).fetchall()
        return [
            {"id": row[0], "type": row[1], "created_at": row[2], "payload": json.loads(row[3])}
            for row in rows
        ]

    def _init_db(self) -> None:
        with sqlite3.connect(self.db_path) as connection:
            connection.execute(
                """
                create table if not exists audit_logs (
                  id text primary key,
                  type text not null,
                  created_at text not null,
                  payload text not null
                )
                """
            )
            connection.execute("create index if not exists audit_logs_created_at_idx on audit_logs (created_at desc)")
            connection.commit()
