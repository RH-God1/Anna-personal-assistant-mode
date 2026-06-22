# Python Controlled Computer Agent

This is the Python/FastAPI phase-one safety skeleton for Anna personal assistant mode. It is intentionally conservative: no sudo, no unrestricted shell, no file access outside the configured workspace, no payment confirmation, no final booking, no email sending, and no keychain or browser password access.

Audit events are stored in local SQLite by default at `audit_logs.sqlite`.

## Install

```bash
cd services/agent-server/python_agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
cp .env.example .env.local
python validate_config.py
```

## Run

```bash
uvicorn main:app --reload --port 8018
```

## Configure `OPENAI_API_KEY`

Put it in `.env.local`:

```text
OPENAI_API_KEY=sk-...
```

The current phase does not call OpenAI directly; the key is only loaded from environment configuration for later model routing.

## Test Policy

Denied tool:

```bash
curl -s http://127.0.0.1:8018/tools/call \
  -H 'content-type: application/json' \
  -d '{"tool_id":"shell.run","input":{"command":"pwd"}}'
```

Approval-required tool:

```bash
curl -s http://127.0.0.1:8018/tools/call \
  -H 'content-type: application/json' \
  -d '{"tool_id":"file.write","input":{"path":"hello.txt","content":"hello"}}'
```

Then confirm with the returned approval ID:

```bash
curl -s http://127.0.0.1:8018/approvals/APPROVAL_ID/confirm -X POST
```

Move is also approval-gated and still constrained to the workspace:

```bash
curl -s http://127.0.0.1:8018/tools/call \
  -H 'content-type: application/json' \
  -d '{"tool_id":"file.move","input":{"source":"hello.txt","destination":"archive/hello.txt"}}'
```

## Test Workspace Restriction

Allowed:

```bash
curl -s http://127.0.0.1:8018/tools/call \
  -H 'content-type: application/json' \
  -d '{"tool_id":"file.read","input":{"path":"hello.txt"}}'
```

Blocked:

```bash
curl -s http://127.0.0.1:8018/tools/call \
  -H 'content-type: application/json' \
  -d '{"tool_id":"file.read","input":{"path":"../../README.md"}}'
```

## Test Browser Tool

```bash
curl -s http://127.0.0.1:8018/tools/call \
  -H 'content-type: application/json' \
  -d '{"tool_id":"browser.open","input":{"url":"https://example.com"}}'
```

## Test Shortcut Allowlist

Edit `allowlist.json`:

```json
{
  "mac.shortcut.run": ["Open Notes"]
}
```

Then call:

```bash
curl -s http://127.0.0.1:8018/tools/call \
  -H 'content-type: application/json' \
  -d '{"tool_id":"mac.shortcut.run","input":{"name":"Open Notes"}}'
```

The call first returns `waiting_approval`; after confirmation, the backend checks `allowlist.json` before running the Shortcut.
