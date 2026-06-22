import { spawn } from "node:child_process";
import { z } from "zod";
import type { ToolDefinition } from "@anna/tool-registry";

const runShortcutSchema = z.object({
  name: z.string().min(1),
  input: z.string().max(5000).optional()
});

export function createMacShortcutTools(env: NodeJS.ProcessEnv = process.env): ToolDefinition[] {
  const allowedShortcuts = new Set(
    (env.ANNA_ALLOWED_SHORTCUTS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );

  return [
    {
      id: "mac.shortcut.run",
      description: "Run one user-created macOS Shortcut from ANNA_ALLOWED_SHORTCUTS.",
      riskLevel: "high",
      inputSchema: runShortcutSchema,
      capabilities: ["mac.shortcut.run"],
      handler: async (input) => {
        if (!allowedShortcuts.has(input.name)) {
          throw new Error(`Shortcut ${input.name} is not allowlisted.`);
        }

        const args = ["run", input.name];
        if (input.input) {
          args.push("--input-path", "-");
        }

        const result = await runProcess("shortcuts", args, input.input);
        return {
          name: input.name,
          stdout: result.stdout.trim(),
          stderr: result.stderr.trim()
        };
      }
    }
  ];
}

async function runProcess(command: string, args: string[], stdin?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Shortcut execution timed out."));
    }, 30_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || `Shortcut exited with code ${code}.`));
      }
    });

    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}
