import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ExecutaMcpBridge, parametersToSchema } from "../src/bridge.js";

test("maps Executa parameters to MCP JSON Schema", () => {
  assert.deepEqual(parametersToSchema([
    {
      name: "message",
      type: "string",
      required: true,
      enum: ["short", "long"],
      minLength: 2
    },
    {
      name: "tags",
      type: "array",
      items: "string"
    }
  ]), {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: undefined,
        enum: ["short", "long"],
        minLength: 2
      },
      tags: {
        type: "array",
        description: undefined,
        items: { type: "string" }
      }
    },
    additionalProperties: false,
    required: ["message"]
  });
});

test("allowlists tools, invokes an Executa and writes metadata-only audit logs", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "executa-mcp-"));
  const fixture = new URL("./fixtures/echo-executa.cjs", import.meta.url).pathname;
  const bridge = new ExecutaMcpBridge({
    auditLog: "audit.jsonl",
    executas: [{
      id: "demo",
      command: process.execPath,
      args: [fixture],
      allowedTools: ["echo"],
      timeoutMs: 2000,
      privacy: {
        readsPii: false,
        writesExternal: false,
        requiresHumanConfirmation: true
      }
    }]
  }, temp);
  t.after(() => bridge.close());

  const tools = await bridge.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), ["demo__echo"]);
  assert.match(tools[0].description, /human confirmation required/);

  const result = await bridge.callTool("demo__echo", { message: "hello" });
  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent, { echoed: "hello" });

  const audit = fs.readFileSync(path.join(temp, "audit.jsonl"), "utf8");
  assert.match(audit, /demo__echo/);
  assert.doesNotMatch(audit, /hello/);
});

test("rejects tools outside the allowlist", async (t) => {
  const fixture = new URL("./fixtures/echo-executa.cjs", import.meta.url).pathname;
  const bridge = new ExecutaMcpBridge({
    executas: [{
      id: "demo",
      command: process.execPath,
      args: [fixture],
      allowedTools: ["echo"],
      timeoutMs: 2000
    }]
  }, process.cwd());
  t.after(() => bridge.close());
  await assert.rejects(() => bridge.callTool("demo__secret", {}), /Unknown or disallowed/);
});

test("blocks PII and redacts tool failures without writing argument values", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "executa-mcp-privacy-"));
  const fixture = new URL("./fixtures/echo-executa.cjs", import.meta.url).pathname;
  const bridge = new ExecutaMcpBridge({
    auditLog: "audit.jsonl",
    executas: [{
      id: "demo",
      command: process.execPath,
      args: [fixture],
      allowedTools: ["echo"],
      timeoutMs: 500,
      privacy: { readsPii: false }
    }]
  }, temp);
  t.after(() => bridge.close());

  const blocked = await bridge.callTool("demo__echo", {
    message: "anna-user@example.com"
  });
  assert.equal(blocked.isError, true);
  assert.equal(blocked.content[0].text, "Request blocked by the bridge privacy policy.");

  const failed = await bridge.callTool("demo__echo", {
    message: "private-sentinel",
    fail: true
  });
  assert.equal(failed.isError, true);
  assert.doesNotMatch(failed.content[0].text, /private-sentinel/);

  const leaked = await bridge.callTool("demo__echo", {
    message: "safe",
    leak: true
  });
  assert.equal(leaked.isError, true);
  assert.equal(leaked.content[0].text, "Request blocked by the bridge privacy policy.");

  const audit = fs.readFileSync(path.join(temp, "audit.jsonl"), "utf8");
  assert.doesNotMatch(audit, /anna-user|private-sentinel/);
  assert.equal(fs.statSync(path.join(temp, "audit.jsonl")).mode & 0o777, 0o600);
});

test("terminates timed-out or malformed Executas and recovers on the next call", async (t) => {
  const fixture = new URL("./fixtures/echo-executa.cjs", import.meta.url).pathname;
  const bridge = new ExecutaMcpBridge({
    executas: [{
      id: "demo",
      command: process.execPath,
      args: [fixture],
      allowedTools: ["echo"],
      timeoutMs: 80
    }]
  }, process.cwd());
  t.after(() => bridge.close());

  const timedOut = await bridge.callTool("demo__echo", {
    message: "safe",
    hang: true
  });
  assert.equal(timedOut.isError, true);

  const recovered = await bridge.callTool("demo__echo", { message: "recovered" });
  assert.equal(recovered.isError, false);
  assert.equal(recovered.structuredContent.echoed, "recovered");

  const malformed = await bridge.callTool("demo__echo", {
    message: "safe",
    invalid: true
  });
  assert.equal(malformed.isError, true);

  const recoveredAgain = await bridge.callTool("demo__echo", { message: "again" });
  assert.equal(recoveredAgain.isError, false);
  assert.equal(recoveredAgain.structuredContent.echoed, "again");
});

test("rejects duplicate Executa IDs and audit paths outside the bridge directory", () => {
  const fixture = new URL("./fixtures/echo-executa.cjs", import.meta.url).pathname;
  const item = {
    id: "demo",
    command: process.execPath,
    args: [fixture],
    allowedTools: ["echo"]
  };
  assert.throws(
    () => new ExecutaMcpBridge({ executas: [item, item] }, process.cwd()),
    /Duplicate Executa id/
  );
  assert.throws(
    () => new ExecutaMcpBridge({
      auditLog: "../audit.jsonl",
      executas: [item]
    }, process.cwd()),
    /stay inside/
  );
});
