import type { ActorContext, PolicyDecision, RiskLevel } from "@anna/shared";

export type PolicyTool = {
  id: string;
  riskLevel: RiskLevel;
  description: string;
  capabilities?: string[];
};

export type PolicyRequest = {
  actor: ActorContext;
  tool: PolicyTool;
  input: unknown;
};

const forbiddenCapabilities = new Set([
  "payment.capture",
  "payment.authorize",
  "commerce.place_order",
  "filesystem.delete",
  "email.send",
  "keychain.read",
  "shell.sudo",
  "desktop.free_mouse_keyboard",
  "auth.bypass",
  "captcha.solve"
]);

const forbiddenToolIdFragments = [
  "pay",
  "purchase",
  "place-order",
  "delete-file",
  "send-email",
  "keychain",
  "sudo",
  "captcha"
];

export class PolicyEngine {
  evaluate(request: PolicyRequest): PolicyDecision {
    const forbiddenCapability = request.tool.capabilities?.find((capability) => forbiddenCapabilities.has(capability));
    if (forbiddenCapability) {
      return {
        effect: "deny",
        code: "FORBIDDEN_CAPABILITY",
        reason: `Tool capability ${forbiddenCapability} is not allowed for Anna personal assistant automation.`
      };
    }

    const normalizedToolId = request.tool.id.toLowerCase();
    if (forbiddenToolIdFragments.some((fragment) => normalizedToolId.includes(fragment))) {
      return {
        effect: "deny",
        code: "FORBIDDEN_TOOL",
        reason: "This tool appears to perform a prohibited action."
      };
    }

    if (request.tool.riskLevel === "critical") {
      return {
        effect: "deny",
        code: "CRITICAL_RISK_DISABLED",
        reason: "Critical-risk tools are disabled in this backend."
      };
    }

    if (request.tool.riskLevel === "high") {
      return {
        effect: "requires_approval",
        reason: "High-risk tools require explicit user approval before execution."
      };
    }

    if (request.tool.riskLevel === "medium") {
      return {
        effect: "requires_approval",
        reason: "Medium-risk automation requires confirmation in the first production profile."
      };
    }

    return {
      effect: "allow",
      reason: "Tool is registered and passed policy checks."
    };
  }
}
