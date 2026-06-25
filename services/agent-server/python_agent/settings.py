from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env.local", override=True)
load_dotenv(BASE_DIR / ".env", override=False)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(BASE_DIR / ".env", BASE_DIR / ".env.local"), extra="ignore")

    agent_mode: str = "controlled"
    agent_require_approval: bool = True
    agent_allowed_workspace: str = "./workspace"
    agent_allow_outside_workspace: bool = False
    agent_browser_enabled: bool = True
    agent_mac_control_enabled: bool = True
    agent_shortcuts_enabled: bool = True
    agent_applescript_enabled: bool = False
    agent_shell_enabled: bool = False
    agent_sudo_enabled: bool = False
    agent_delete_files_enabled: bool = False
    agent_payment_enabled: bool = False
    agent_booking_confirm_enabled: bool = False
    agent_send_email_enabled: bool = False
    agent_audit_log_enabled: bool = True
    agent_audit_db_path: str = "./audit_logs.sqlite"
    personal_assistant_api_base_url: str = Field(
        default="http://127.0.0.1:8808",
        validation_alias="ANNA_PERSONAL_ASSISTANT_API_BASE_URL"
    )
    openai_api_key: str | None = Field(default=None, validation_alias="OPENAI_API_KEY")

    @property
    def workspace_path(self) -> Path:
        path = Path(self.agent_allowed_workspace)
        if not path.is_absolute():
            path = BASE_DIR / path
        return path.resolve()

    @property
    def audit_db_path(self) -> Path:
        path = Path(self.agent_audit_db_path)
        if not path.is_absolute():
            path = BASE_DIR / path
        return path.resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
