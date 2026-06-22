from pathlib import Path

from settings import get_settings


FORBIDDEN_TRUE_FLAGS = {
    "agent_allow_outside_workspace": "Agent must stay inside the configured workspace.",
    "agent_applescript_enabled": "AppleScript is disabled in phase one.",
    "agent_shell_enabled": "Shell execution is disabled in phase one.",
    "agent_sudo_enabled": "sudo is always forbidden.",
    "agent_delete_files_enabled": "File deletion is disabled.",
    "agent_payment_enabled": "Real payment is disabled.",
    "agent_booking_confirm_enabled": "Final booking confirmation is disabled.",
    "agent_send_email_enabled": "Sending email is disabled."
}


def validate_config() -> None:
    settings = get_settings()
    errors: list[str] = []

    if settings.agent_mode != "controlled":
        errors.append("AGENT_MODE must be controlled.")
    if not settings.agent_require_approval:
        errors.append("AGENT_REQUIRE_APPROVAL must be true in phase one.")
    if not settings.agent_audit_log_enabled:
        errors.append("AGENT_AUDIT_LOG_ENABLED must be true.")

    for flag, message in FORBIDDEN_TRUE_FLAGS.items():
        if getattr(settings, flag):
            errors.append(message)

    workspace = settings.workspace_path
    workspace.mkdir(parents=True, exist_ok=True)
    if not workspace.is_dir():
        errors.append(f"Workspace path is not a directory: {workspace}")

    policy_path = Path(__file__).resolve().parent / "policy.yaml"
    allowlist_path = Path(__file__).resolve().parent / "allowlist.json"
    if not policy_path.exists():
        errors.append("policy.yaml is missing.")
    if not allowlist_path.exists():
        errors.append("allowlist.json is missing.")

    if errors:
        raise RuntimeError("Unsafe Anna agent configuration:\n- " + "\n- ".join(errors))


if __name__ == "__main__":
    validate_config()
    print("Configuration is safe for controlled mode.")

