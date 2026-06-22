import { z } from "zod";
import type { ToolDefinition } from "@anna/tool-registry";

const travelSearchSchema = z.object({
  kind: z.enum(["flight", "hotel"]),
  query: z.record(z.unknown())
});

export function createBookingTools(): ToolDefinition[] {
  return [
    {
      id: "booking.search",
      description: "Prepare a non-purchasing travel search request for flights or hotels.",
      riskLevel: "low",
      inputSchema: travelSearchSchema,
      capabilities: ["booking.search"],
      handler: async (input) => ({
        kind: input.kind,
        status: "planned",
        query: input.query,
        note: "This tool only prepares search criteria. It does not book, order, or pay."
      })
    }
  ];
}

