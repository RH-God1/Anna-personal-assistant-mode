from dataclasses import dataclass
from pathlib import Path

import yaml


BASE_DIR = Path(__file__).resolve().parent


@dataclass(frozen=True)
class PolicyDecision:
    effect: str
    reason: str


class PolicyEngine:
    def __init__(self, policy_path: Path | None = None) -> None:
        data = yaml.safe_load((policy_path or BASE_DIR / "policy.yaml").read_text()) or {}
        self.allowed = set(data.get("allowed", []))
        self.requires_approval = set(data.get("requires_approval", []))
        self.denied = set(data.get("denied", []))

    def evaluate(self, tool_id: str) -> PolicyDecision:
        if tool_id in self.denied:
            return PolicyDecision("deny", f"{tool_id} is denied by policy.")
        if tool_id not in self.allowed:
            return PolicyDecision("deny", f"{tool_id} is not registered in the allowed policy list.")
        if tool_id in self.requires_approval:
            return PolicyDecision("requires_approval", f"{tool_id} requires human approval.")
        return PolicyDecision("allow", f"{tool_id} is allowed.")

