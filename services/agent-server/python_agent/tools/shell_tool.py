from settings import Settings


class ShellTool:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def run(self, command: str) -> dict:
        if not self.settings.agent_shell_enabled:
            raise PermissionError("shell.run is disabled by default.")
        raise PermissionError("shell.run is intentionally not implemented in phase one.")

    def sudo(self, command: str) -> dict:
        raise PermissionError("shell.sudo is always forbidden.")

