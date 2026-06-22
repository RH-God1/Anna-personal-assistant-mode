import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

test("Node Executa starts, pauses, resumes and completes a session", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "focus-flow-test-"));
  const stateFile = path.join(temp, "state.json");
  const child = spawn(process.execPath, [
    new URL("../executas/focus-session-node/focus_session_plugin.js", import.meta.url).pathname
  ], {
    env: {
      PATH: process.env.PATH || "",
      HOME: temp,
      FOCUS_FLOW_STATE_FILE: stateFile
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  t.after(() => child.kill());

  let id = 0;
  const pending = new Map();
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    lines.filter(Boolean).forEach((line) => {
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    });
  });
  const call = (method, params = {}) => new Promise((resolve) => {
    const requestId = ++id;
    pending.set(requestId, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`);
  });
  const raw = (line) => new Promise((resolve) => {
    pending.set(null, resolve);
    child.stdin.write(`${line}\n`);
  });

  const describe = await call("describe");
  assert.equal(describe.result.name, "tool-test-focus-session-12345678");
  assert.equal(describe.result.tools[0].name, "session");

  const health = await call("health");
  assert.equal(health.result.status, "ready");

  const unsupported = await call("initialize");
  assert.equal(unsupported.error.code, -32601);

  const malformed = await raw("{");
  assert.equal(malformed.error.code, -32700);

  const start = await call("invoke", {
    tool: "session",
    arguments: { action: "start", duration_minutes: 1, topic: "测试" }
  });
  assert.equal(start.result.success, true);
  const pause = await call("invoke", { tool: "session", arguments: { action: "pause" } });
  assert.equal(pause.result.data.active.status, "paused");
  const resume = await call("invoke", { tool: "session", arguments: { action: "resume" } });
  assert.equal(resume.result.data.active.status, "running");
  const complete = await call("invoke", { tool: "session", arguments: { action: "complete" } });
  assert.equal(complete.result.data.completed.topic, "测试");
  assert.equal(fs.existsSync(stateFile), true);
});
