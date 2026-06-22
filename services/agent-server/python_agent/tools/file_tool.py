from pathlib import Path

from settings import Settings


class FileTool:
    def __init__(self, settings: Settings) -> None:
        self.workspace = settings.workspace_path
        self.allow_outside_workspace = settings.agent_allow_outside_workspace

    def read(self, path: str) -> dict:
        target = self._resolve_workspace_path(path)
        return {"path": str(target), "content": target.read_text(encoding="utf-8")}

    def write(self, path: str, content: str) -> dict:
        target = self._resolve_workspace_path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return {"path": str(target), "bytes": len(content.encode("utf-8"))}

    def move(self, source: str, destination: str) -> dict:
        source_path = self._resolve_workspace_path(source)
        destination_path = self._resolve_workspace_path(destination)
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.replace(destination_path)
        return {"source": str(source_path), "destination": str(destination_path)}

    def _resolve_workspace_path(self, path: str) -> Path:
        target = Path(path)
        if not target.is_absolute():
            target = self.workspace / target
        resolved = target.resolve()
        if not self.allow_outside_workspace and not resolved.is_relative_to(self.workspace):
            raise PermissionError(f"Path is outside AGENT_ALLOWED_WORKSPACE: {resolved}")
        return resolved
