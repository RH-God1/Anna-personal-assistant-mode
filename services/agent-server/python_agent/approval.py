from datetime import datetime, timedelta, timezone
from uuid import uuid4

from pydantic import BaseModel


class ApprovalRecord(BaseModel):
    id: str
    tool_id: str
    input: dict
    status: str
    reason: str
    created_at: str
    expires_at: str


class ApprovalStore:
    def __init__(self) -> None:
        self._records: dict[str, ApprovalRecord] = {}

    def create(self, tool_id: str, tool_input: dict, reason: str) -> ApprovalRecord:
        now = datetime.now(timezone.utc)
        record = ApprovalRecord(
            id=f"approval_{uuid4().hex}",
            tool_id=tool_id,
            input=tool_input,
            status="pending",
            reason=reason,
            created_at=now.isoformat(),
            expires_at=(now + timedelta(minutes=15)).isoformat()
        )
        self._records[record.id] = record
        return record

    def confirm(self, approval_id: str) -> ApprovalRecord:
        record = self._records[approval_id]
        if record.status != "pending":
            raise ValueError(f"Approval is {record.status}.")
        if datetime.fromisoformat(record.expires_at) < datetime.now(timezone.utc):
            record.status = "expired"
            raise ValueError("Approval expired.")
        record.status = "approved"
        return record

    def reject(self, approval_id: str) -> ApprovalRecord:
        record = self._records[approval_id]
        if record.status != "pending":
            raise ValueError(f"Approval is {record.status}.")
        record.status = "rejected"
        return record

    def list(self) -> list[ApprovalRecord]:
        return list(self._records.values())

