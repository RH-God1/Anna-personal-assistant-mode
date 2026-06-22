import { spawn } from "node:child_process";

const MAX_LINE_BYTES = 2 * 1024 * 1024;

export class ExecutaClient {
  constructor(config, baseDir) {
    this.config = config;
    this.baseDir = baseDir;
    this.child = null;
    this.pending = new Map();
    this.sequence = 0;
    this.buffer = "";
    this.startPromise = null;
  }

  async describe() {
    return this.call("describe");
  }

  async invoke(tool, argumentsValue) {
    return this.call("invoke", { tool, arguments: argumentsValue });
  }

  async call(method, params = {}) {
    await this.start();
    return this.callRaw(method, params);
  }

  async start() {
    if (this.child && !this.child.killed) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async startInternal() {
    const env = {};
    for (const name of ["PATH", "HOME"]) {
      if (process.env[name] != null) env[name] = process.env[name];
    }
    for (const name of this.config.inheritEnv || []) {
      if (process.env[name] != null) env[name] = process.env[name];
    }

    const child = spawn(this.config.command, this.config.args || [], {
      cwd: this.baseDir,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    child.stdout.on("data", (chunk) => this.onData(chunk));
    child.stderr.on("data", (chunk) => {
      if (this.config.forwardStderr === true) {
        const redacted = String(chunk).replace(
          /(?:bearer\s+|sk-)[a-z0-9._~-]{8,}/gi,
          "[redacted]"
        );
        process.stderr.write(`[executa:${this.config.id}] ${redacted}`);
      }
    });
    child.on("error", (cause) => {
      if (this.child !== child) return;
      this.terminate(new Error(`Executa ${this.config.id} failed to start: ${cause.message}`));
    });
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      this.failPending(new Error(
        `Executa ${this.config.id} exited (${code ?? signal ?? "unknown"})`
      ));
      this.child = null;
      this.buffer = "";
    });

    try {
      try {
        await this.callRaw("initialize", {
          protocolVersion: "2.0",
          clientInfo: { name: "anna-executa-to-mcp-bridge", version: "1.0.0" },
          capabilities: {}
        }, { terminateOnTimeout: false });
      } catch {
        // Legacy Executas can expose describe/invoke without initialize.
      }
    } catch (error) {
      this.terminate(error);
      throw error;
    }
  }

  callRaw(method, params = {}, options = {}) {
    if (!this.child || this.child.killed) {
      return Promise.reject(new Error(`Executa ${this.config.id} is not running`));
    }
    const id = ++this.sequence;
    const timeoutMs = Number(options.timeoutMs || this.config.timeoutMs || 10000);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(
          `Executa ${this.config.id} timed out after ${timeoutMs}ms`
        );
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

  onData(chunk) {
    this.buffer += chunk.toString("utf8");
    if (Buffer.byteLength(this.buffer) > MAX_LINE_BYTES) {
      this.terminate(new Error(`Executa ${this.config.id} emitted an oversized frame`));
      return;
    }
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";
    for (const line of lines.filter(Boolean)) {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.terminate(new Error(`Executa ${this.config.id} emitted invalid JSON`));
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        const error = new Error(message.error.message || "Executa RPC error");
        error.code = message.error.code;
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
    }
  }

  failPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  terminate(error) {
    this.failPending(error);
    const child = this.child;
    this.child = null;
    this.buffer = "";
    child?.kill("SIGTERM");
  }

  close() {
    this.child?.stdin.end();
    this.terminate(new Error(`Executa ${this.config.id} closed`));
  }
}
