import json
import subprocess
from pathlib import Path

from settings import Settings


BASE_DIR = Path(__file__).resolve().parents[1]


class ShortcutTool:
    def __init__(self, settings: Settings, allowlist_path: Path | None = None) -> None:
        self.settings = settings
        self.allowlist_path = allowlist_path or BASE_DIR / "allowlist.json"
        self.allowlist = json.loads(self.allowlist_path.read_text(encoding="utf-8"))

    def run(self, name: str, input_text: str | None = None) -> dict:
        if not self.settings.agent_mac_control_enabled or not self.settings.agent_shortcuts_enabled:
            raise PermissionError("Mac Shortcuts are disabled.")
        allowed = set(self.allowlist.get("mac.shortcut.run", []))
        if name not in allowed:
            raise PermissionError(f"Shortcut is not in allowlist.json: {name}")

        command = ["shortcuts", "run", name]
        process = subprocess.run(
            command,
            input=input_text,
            text=True,
            capture_output=True,
            timeout=30,
            check=False
        )
        if process.returncode != 0:
            raise RuntimeError(process.stderr or f"Shortcut exited with {process.returncode}.")
        return {"name": name, "stdout": process.stdout.strip(), "stderr": process.stderr.strip()}

