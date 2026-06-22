import { z } from "zod";
import type { ToolDefinition } from "@anna/tool-registry";

const blockedPaymentSchema = z.object({
  reason: z.string().optional()
});

export function createPaymentTools(): ToolDefinition[] {
  return [
    {
      id: "payment.capture",
      description: "Disabled placeholder for payment capture. Real payments are not supported by this backend.",
      riskLevel: "critical",
      inputSchema: blockedPaymentSchema,
      capabilities: ["payment.capture"],
      handler: async () => {
        throw new Error("Automatic payments are prohibited.");
      }
    }
  ];
}
