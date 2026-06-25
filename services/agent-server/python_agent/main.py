from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from approval import ApprovalStore
from audit import AuditLogger
from policy import PolicyEngine
from settings import get_settings
from tools import BrowserTool, FileTool, ShellTool, ShortcutTool
from validate_config import validate_config


validate_config()

settings = get_settings()
policy = PolicyEngine()
approvals = ApprovalStore()
audit = AuditLogger(settings.audit_db_path)
file_tool = FileTool(settings)
browser_tool = BrowserTool()
shortcut_tool = ShortcutTool(settings)
shell_tool = ShellTool(settings)

app = FastAPI(title="Anna Controlled Computer Agent", version="0.1.0")


class ToolCall(BaseModel):
    tool_id: str = Field(min_length=1)
    input: dict[str, Any] = Field(default_factory=dict)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "mode": settings.agent_mode, "workspace": str(settings.workspace_path)}


@app.post("/tools/call")
async def call_tool(call: ToolCall) -> dict:
    decision = policy.evaluate(call.tool_id)
    audit.record("policy.evaluated", {"tool_id": call.tool_id, "effect": decision.effect, "reason": decision.reason})
    if decision.effect == "deny":
        raise HTTPException(status_code=403, detail=decision.reason)
    if decision.effect == "requires_approval":
        approval = approvals.create(call.tool_id, call.input, decision.reason)
        audit.record("approval.requested", approval.model_dump())
        return {"status": "waiting_approval", "approval": approval.model_dump()}
    return await _execute(call.tool_id, call.input)


@app.post("/approvals/{approval_id}/confirm")
async def confirm_approval(approval_id: str) -> dict:
    try:
        approval = approvals.confirm(approval_id)
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    audit.record("approval.confirmed", approval.model_dump())
    return await _execute(approval.tool_id, approval.input)


@app.get("/approvals")
def list_approvals() -> dict:
    return {"data": [record.model_dump() for record in approvals.list()]}


@app.get("/audit-logs")
def list_audit_logs(limit: int = 100) -> dict:
    return {"data": audit.list(limit)}


async def _execute(tool_id: str, tool_input: dict[str, Any]) -> dict:
    try:
        if tool_id == "file.read":
            result = file_tool.read(str(tool_input["path"]))
        elif tool_id == "file.write":
            result = file_tool.write(str(tool_input["path"]), str(tool_input.get("content", "")))
        elif tool_id == "file.move":
            result = file_tool.move(str(tool_input["source"]), str(tool_input["destination"]))
        elif tool_id == "browser.open":
            result = await browser_tool.open(str(tool_input["url"]))
        elif tool_id == "browser.screenshot":
            result = await browser_tool.screenshot(str(tool_input["url"]))
        elif tool_id == "browser.extract_text":
            result = await browser_tool.extract_text(str(tool_input["url"]))
        elif tool_id == "mac.shortcut.run":
            result = shortcut_tool.run(str(tool_input["name"]), tool_input.get("input"))
        elif tool_id == "shell.run":
            result = shell_tool.run(str(tool_input.get("command", "")))
        elif tool_id == "shell.sudo":
            result = shell_tool.sudo(str(tool_input.get("command", "")))
        else:
            raise PermissionError(f"No registered handler for {tool_id}.")
    except Exception as error:
        audit.record("tool.failed", {"tool_id": tool_id, "error": str(error)})
        raise HTTPException(status_code=400, detail=str(error)) from error

    audit.record("tool.succeeded", {"tool_id": tool_id, "result": result})
    return {"status": "succeeded", "result": result}


class ConfirmationRequest(BaseModel):
    confirmationId: str


@app.post("/api/booking/confirmation")
async def get_booking_confirmation(req: ConfirmationRequest) -> dict:
    records = audit.list(limit=500)
    for record in records:
        data = record if isinstance(record, dict) else {}
        if data.get("wid") == req.confirmationId or \
           data.get("window_id") == req.confirmationId or \
           data.get("confirmation_id") == req.confirmationId:
            return {"status": "found", "data": data}
    raise HTTPException(status_code=404, detail="Confirmation not found")
