import fs from "node:fs";
import path from "node:path";
import { ExecutaClient } from "./executa-client.js";

export class ExecutaMcpBridge {
  constructor(config, baseDir) {
    this.config = config;
    this.baseDir = path.resolve(baseDir);
    validateConfig(config);
    this.auditFile = config.auditLog
      ? resolveAuditPath(this.baseDir, config.auditLog)
      : null;
    this.clients = new Map((config.executas || []).map((item) => [
      item.id,
      new ExecutaClient(item, this.baseDir)
    ]));
    this.tools = null;
  }

  async listTools() {
    if (this.tools) return this.tools;
    const tools = [];
    for (const config of this.config.executas || []) {
      const description = await this.clients.get(config.id).describe();
      for (const tool of description.tools || []) {
        if (!(config.allowedTools || []).includes(tool.name)) continue;
        tools.push({
          name: `${config.id}__${tool.name}`,
          title: tool.display_name || tool.name,
          description: privacyDescription(tool.description, config.privacy),
          inputSchema: parametersToSchema(tool.parameters || []),
          annotations: {
            readOnlyHint: config.privacy?.writesExternal !== true,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: config.privacy?.writesExternal === true
          },
          _bridge: {
            executaId: config.id,
            toolName: tool.name
          }
        });
      }
    }
    this.tools = tools;
    return tools;
  }

  async callTool(name, args) {
    const tool = (await this.listTools()).find((item) => item.name === name);
    if (!tool) throw new Error(`Unknown or disallowed MCP tool: ${name}`);
    const config = this.config.executas.find((item) => item.id === tool._bridge.executaId);
    const startedAt = Date.now();
    let outcome = "ok";
    try {
      if (config.privacy?.readsPii === false) {
        assertNoPii(args || {}, "arguments");
      }
      const result = await this.clients.get(config.id).invoke(tool._bridge.toolName, args || {});
      if (result?.success === false) {
        outcome = "tool_error";
        const code = result.error?.code || "tool_error";
        return {
          content: [{ type: "text", text: `Executa rejected the request (${code}).` }],
          isError: true
        };
      }
      const data = result?.data ?? result;
      if (config.privacy?.readsPii === false) {
        assertNoPii(data, "result");
      }
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data && typeof data === "object" ? data : undefined,
        isError: false
      };
    } catch (error) {
      outcome = "bridge_error";
      return {
        content: [{
          type: "text",
          text: error.code === "pii_blocked"
            ? "Request blocked by the bridge privacy policy."
            : "Executa bridge request failed."
        }],
        isError: true
      };
    } finally {
      this.audit({
        at: new Date().toISOString(),
        tool: name,
        executa: config.id,
        outcome,
        durationMs: Date.now() - startedAt
      });
    }
  }

  audit(entry) {
    if (!this.auditFile) return;
    fs.appendFileSync(this.auditFile, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    fs.chmodSync(this.auditFile, 0o600);
  }

  close() {
    for (const client of this.clients.values()) client.close();
  }
}

export function parametersToSchema(parameters) {
  const properties = {};
  const required = [];
  for (const parameter of parameters) {
    const schema = {
      type: jsonType(parameter.type),
      description: parameter.description
    };
    if (parameter.default !== undefined) schema.default = parameter.default;
    if (Array.isArray(parameter.enum)) schema.enum = [...parameter.enum];
    if (parameter.type === "array" && parameter.items) {
      schema.items = typeof parameter.items === "string"
        ? { type: jsonType(parameter.items) }
        : { ...parameter.items };
    }
    for (const key of [
      "minimum",
      "maximum",
      "minLength",
      "maxLength",
      "minItems",
      "maxItems",
      "pattern"
    ]) {
      if (parameter[key] !== undefined) schema[key] = parameter[key];
    }
    properties[parameter.name] = schema;
    if (parameter.required) required.push(parameter.name);
  }
  return {
    type: "object",
    properties,
    additionalProperties: false,
    ...(required.length ? { required } : {})
  };
}

function jsonType(type) {
  return {
    integer: "integer",
    number: "number",
    boolean: "boolean",
    object: "object",
    array: "array"
  }[type] || "string";
}

function privacyDescription(description, privacy = {}) {
  const labels = [];
  if (privacy.readsPii === false) labels.push("does not read PII");
  if (privacy.writesExternal === false) labels.push("no external writes");
  if (privacy.requiresHumanConfirmation === true) labels.push("human confirmation required");
  return labels.length ? `${description || ""}\n\nPrivacy: ${labels.join("; ")}.`.trim() : description;
}

function validateConfig(config) {
  if (!config || !Array.isArray(config.executas)) {
    throw new Error("Bridge config must contain an executas array.");
  }
  const ids = new Set();
  for (const executa of config.executas) {
    if (!executa || typeof executa.id !== "string" || !executa.id.trim()) {
      throw new Error("Every Executa requires a non-empty id.");
    }
    if (ids.has(executa.id)) {
      throw new Error(`Duplicate Executa id: ${executa.id}`);
    }
    ids.add(executa.id);
    if (typeof executa.command !== "string" || !executa.command.trim()) {
      throw new Error(`Executa ${executa.id} requires a command.`);
    }
    if (!Array.isArray(executa.allowedTools)) {
      throw new Error(`Executa ${executa.id} requires an allowedTools array.`);
    }
  }
}

function resolveAuditPath(baseDir, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative)) {
    throw new Error("auditLog must be a relative path inside the bridge directory.");
  }
  const file = path.resolve(baseDir, relative);
  if (!file.startsWith(`${baseDir}${path.sep}`)) {
    throw new Error("auditLog must stay inside the bridge directory.");
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const realBase = fs.realpathSync(baseDir);
  const realParent = fs.realpathSync(path.dirname(file));
  if (realParent !== realBase && !realParent.startsWith(`${realBase}${path.sep}`)) {
    throw new Error("auditLog parent resolves outside the bridge directory.");
  }
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
    throw new Error("auditLog cannot be a symbolic link.");
  }
  return file;
}

const sensitiveKeyPattern =
  /(?:^|[_-])(?:full[_-]?name|passenger[_-]?name|passport|identity|phone|mobile|email|bank|card[_-]?(?:number|no)|cvv|cvc|password|api[_-]?key|access[_-]?token|auth[_-]?token|authorization|credentials?|secret)(?:$|[_-])/i;

const sensitiveValuePatterns = [
  /\b1[3-9]\d{9}\b/,
  /\b(?:\d[ -]*?){13,19}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\bsk-[A-Za-z0-9_-]{12,}\b/i,
  /\bBearer\s+[A-Za-z0-9._~-]{12,}\b/i
];

function assertNoPii(value, location, key = "") {
  if (key && sensitiveKeyPattern.test(key)) {
    const error = new Error(`Sensitive field blocked at ${location}.${key}`);
    error.code = "pii_blocked";
    throw error;
  }
  if (typeof value === "string" &&
      sensitiveValuePatterns.some((pattern) => pattern.test(value))) {
    const error = new Error(`Sensitive value blocked at ${location}`);
    error.code = "pii_blocked";
    throw error;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPii(item, `${location}[${index}]`));
    return;
  }
  for (const [nestedKey, nestedValue] of Object.entries(value)) {
    assertNoPii(nestedValue, location, nestedKey);
  }
}
