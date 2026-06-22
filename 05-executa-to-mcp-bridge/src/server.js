#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { ExecutaMcpBridge } from "./bridge.js";

const configPath = path.resolve(process.argv[2] || "bridge.config.json");
const baseDir = path.dirname(configPath);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const bridge = new ExecutaMcpBridge(config, baseDir);
const protocolVersion = "2025-11-25";

const input = readline.createInterface({ input: process.stdin });
input.on("line", async (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
    if (!("id" in request)) return;
    const result = await dispatch(request.method, request.params || {});
    send({ jsonrpc: "2.0", id: request.id, result });
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id: request?.id ?? null,
      error: {
        code: error.code || -32603,
        message: error.message || "Internal error"
      }
    });
  }
});
input.on("close", () => {
  bridge.close();
});

async function dispatch(method, params) {
  if (method === "initialize") {
    return {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "anna-executa-to-mcp-bridge", version: "1.0.0" },
      instructions: "Tools are allowlisted. Audit logs never include tool arguments or results."
    };
  }
  if (method === "ping") return {};
  if (method === "tools/list") {
    return {
      tools: (await bridge.listTools()).map(({ _bridge, ...tool }) => tool)
    };
  }
  if (method === "tools/call") {
    if (typeof params.name !== "string") {
      const error = new Error("tools/call requires name");
      error.code = -32602;
      throw error;
    }
    return bridge.callTool(params.name, params.arguments || {});
  }
  const error = new Error(`Method not found: ${method}`);
  error.code = -32601;
  throw error;
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

process.on("SIGTERM", () => {
  bridge.close();
  process.exit(0);
});
process.on("SIGINT", () => {
  bridge.close();
  process.exit(0);
});

export { dispatch };
