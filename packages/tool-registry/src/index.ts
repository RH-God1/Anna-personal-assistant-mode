import { z, type ZodTypeAny } from "zod";
import { AnnaError, type ActorContext, type RiskLevel } from "@anna/shared";

export type ToolHandler<TInput, TOutput> = (input: TInput, context: { actor: ActorContext; taskId: string }) => Promise<TOutput>;

export type ToolDefinition<TSchema extends ZodTypeAny = ZodTypeAny, TOutput = unknown> = {
  id: string;
  description: string;
  riskLevel: RiskLevel;
  inputSchema: TSchema;
  capabilities?: string[];
  handler: ToolHandler<z.infer<TSchema>, TOutput>;
};

export type ToolSummary = {
  id: string;
  description: string;
  riskLevel: RiskLevel;
  capabilities: string[];
};

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register<TSchema extends ZodTypeAny, TOutput>(definition: ToolDefinition<TSchema, TOutput>): void {
    if (this.tools.has(definition.id)) {
      throw new AnnaError("DUPLICATE_TOOL", `Tool ${definition.id} is already registered.`, 500);
    }
    this.tools.set(definition.id, definition as unknown as ToolDefinition);
  }

  registerMany(definitions: ToolDefinition[]): void {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  get(id: string): ToolDefinition {
    const tool = this.tools.get(id);
    if (!tool) {
      throw new AnnaError("TOOL_NOT_REGISTERED", `Tool ${id} is not registered.`, 404);
    }
    return tool;
  }

  list(): ToolSummary[] {
    return Array.from(this.tools.values())
      .map((tool) => ({
        id: tool.id,
        description: tool.description,
        riskLevel: tool.riskLevel,
        capabilities: tool.capabilities ?? []
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  parseInput(tool: ToolDefinition, input: unknown): unknown {
    return tool.inputSchema.parse(input);
  }
}
