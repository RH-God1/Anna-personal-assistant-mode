import { AgentRuntime } from "@anna/agent-core";
import { InMemoryApprovalStore } from "@anna/approval-engine";
import { createAuditLoggerFromEnv } from "@anna/audit-logger";
import { createBookingTools } from "@anna/booking-tools";
import { createBrowserTools } from "@anna/browser-tools";
import { createMacShortcutTools } from "@anna/mac-tools";
import { createPaymentTools } from "@anna/payment-tools";
import { PolicyEngine } from "@anna/policy-engine";
import { ToolRegistry } from "@anna/tool-registry";

export function createRuntime(env: NodeJS.ProcessEnv = process.env): AgentRuntime {
  const registry = new ToolRegistry();
  registry.registerMany([
    ...createBrowserTools(),
    ...createMacShortcutTools(env),
    ...createBookingTools(),
    ...createPaymentTools()
  ]);

  return new AgentRuntime(registry, new PolicyEngine(), new InMemoryApprovalStore(), createAuditLoggerFromEnv(env));
}

export function createRegistry(env: NodeJS.ProcessEnv = process.env): ToolRegistry {
  const registry = new ToolRegistry();
  registry.registerMany([
    ...createBrowserTools(),
    ...createMacShortcutTools(env),
    ...createBookingTools(),
    ...createPaymentTools()
  ]);
  return registry;
}

