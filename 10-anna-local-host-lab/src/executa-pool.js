import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const MAX_LINE_BYTES = 2 * 1024 * 1024;

class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

class ExecutaProcess {
  constructor(spec, options) {
    this.spec = spec;
    this.options = options;
    this.pending = new Map();
    this.nextId = 0;
    this.buffer = "";
    this.spawnCount = 0;
    this.stderrLines = 0;
    this.startPromise = null;
  }

  failPending(error) {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  terminate(error) {
    this.manifest = null;
    this.buffer = "";
    this.failPending(error);
    const child = this.child;
    this.child = null;
    child?.kill("SIGTERM");
  }

  async start() {
    if (this.child && !this.child.killed && this.manifest) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async startInternal() {
    const runtimeHome = path.join(
      this.options.runtimeDir,
      "home",
      this.spec.appSlug
    );
    fs.mkdirSync(runtimeHome, { recursive: true });
    const extraEnvironment = this.spec.environment?.(this.options) || {};
    const env = {
      PATH: process.env.PATH || "",
      HOME: runtimeHome,
      TMPDIR: path.join(this.options.runtimeDir, "tmp"),
      LANG: "C.UTF-8",
      NODE_ENV: "test",
      ANNA_LOCAL_HOST: "1",
      ...extraEnvironment
    };
    this.environmentKeys = Object.keys(env).sort();
    fs.mkdirSync(env.TMPDIR, { recursive: true });
    for (const file of Object.values(extraEnvironment)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }

    const child = spawn(this.options.nodePath || process.execPath, [this.spec.entry], {
      cwd: this.spec.directory,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    this.spawnCount += 1;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.onStdout(chunk));
    child.stderr.on("data", (chunk) => {
      this.stderrLines += String(chunk).split("\n").filter(Boolean).length;
    });
    child.on("error", (cause) => {
      if (this.child !== child) return;
      this.terminate(new Error(
        `Executa ${this.spec.toolId} failed to start: ${cause.message}`
      ));
    });
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      const error = new Error(
        `Executa ${this.spec.toolId} exited (${code ?? signal ?? "unknown"})`
      );
      this.manifest = null;
      this.buffer = "";
      this.failPending(error);
      this.child = null;
    });

    try {
      try {
        await this.callRaw("initialize", {
          protocolVersion: "2.0",
          clientInfo: { name: "anna-local-host-lab", version: "0.1.0" },
          capabilities: {}
        }, 5000, { terminateOnTimeout: false });
      } catch {
        // Anna permits legacy Executas that only implement describe/invoke.
      }
      const manifest = await this.callRaw("describe", {}, 5000);
      if (manifest?.name !== this.spec.toolId) {
        throw new Error(
          `Executa identity mismatch: expected ${this.spec.toolId}, got ${manifest?.name}`
        );
      }
      this.manifest = manifest;
    } catch (error) {
      this.terminate(error);
      throw error;
    }
  }

  onStdout(chunk) {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > MAX_LINE_BYTES) {
      this.child?.kill();
      return;
    }
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";
    for (const line of lines.filter(Boolean)) {
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        this.child?.kill();
        return;
      }
      const pending = this.pending.get(frame.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(frame.id);
      if (frame.error) {
        pending.reject(new RpcError(
          frame.error.code,
          frame.error.message,
          frame.error.data
        ));
      } else {
        pending.resolve(frame.result);
      }
    }
  }

  callRaw(method, params = {}, timeoutMs = 10000, options = {}) {
    if (!this.child || this.child.killed) {
      return Promise.reject(new Error(`Executa is not running: ${this.spec.toolId}`));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`Executa RPC timeout: ${method}`);
        reject(error);
        if (options.terminateOnTimeout !== false) this.terminate(error);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        (error) => {
          if (!error || !this.pending.has(id)) return;
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
          this.terminate(error);
        }
      );
    });
  }

  async call(method, params = {}, timeoutMs = 10000) {
    await this.start();
    return this.callRaw(method, params, timeoutMs);
  }

  async invoke(tool, args) {
    await this.start();
    const definition = this.manifest.tools?.find(({ name }) => name === tool);
    if (!definition) throw new RpcError(-32601, `Unknown tool: ${tool}`);
    const timeoutMs = Math.max(1000, Number(definition.timeout || 60) * 1000);
    return this.callRaw("invoke", {
      tool,
      arguments: args,
      context: {
        credentials: {},
        invoke_id: `local-${Date.now()}-${this.nextId + 1}`
      }
    }, timeoutMs);
  }

  close() {
    this.child?.stdin.end();
    this.terminate(new Error(`Executa ${this.spec.toolId} closed`));
  }

  stats() {
    return {
      tool_id: this.spec.toolId,
      running: Boolean(this.child && !this.child.killed),
      spawn_count: this.spawnCount,
      stderr_lines: this.stderrLines,
      pending: this.pending.size,
      node_path: this.options.nodePath || process.execPath,
      environment_keys: this.environmentKeys || []
    };
  }
}

export class ExecutaPool {
  constructor(toolSpecs, options) {
    this.toolSpecs = toolSpecs;
    this.options = options;
    this.processes = new Map();
  }

  get(toolId) {
    const spec = this.toolSpecs.get(toolId);
    if (!spec) throw new RpcError(-32601, `Unknown Executa: ${toolId}`);
    if (!this.processes.has(toolId)) {
      this.processes.set(toolId, new ExecutaProcess(spec, this.options));
    }
    return this.processes.get(toolId);
  }

  invoke(toolId, method, args) {
    return this.get(toolId).invoke(method, args);
  }

  stats() {
    return [...this.processes.values()].map((process_) => process_.stats());
  }

  close() {
    for (const process_ of this.processes.values()) process_.close();
  }
}

export { RpcError };
