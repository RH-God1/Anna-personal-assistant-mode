import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAppRegistry } from "./app-registry.js";
import { ExecutaPool, RpcError } from "./executa-pool.js";
import {
  PolicyError,
  assertNoSensitivePayload,
  assertResultHasNoSecrets,
  auditShape,
  enforceInvokePolicy
} from "./privacy.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(moduleDir, "../public");
const MAX_BODY_BYTES = 64 * 1024;
const MAX_AUDIT_ENTRIES = 1000;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function securityHeaders({ app = false, scriptNonce = null } = {}) {
  const scriptSrc = ["'self'"];
  if (scriptNonce) scriptSrc.push(`'nonce-${scriptNonce}'`);
  const policy = app
    ? [
        "default-src 'self'",
        `script-src ${scriptSrc.join(" ")}`,
        "style-src 'self'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'self'"
      ].join("; ")
    : [
        "default-src 'self'",
        `script-src ${scriptSrc.join(" ")}`,
        "style-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "frame-src 'self'",
        "object-src 'none'",
        "base-uri 'none'"
      ].join("; ");
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": policy,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(self)"
  };
}

function json(response, status, value, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...securityHeaders(),
    ...headers
  });
  response.end(JSON.stringify(value));
}

function text(response, status, value, type = "text/plain; charset=utf-8", options = {}) {
  response.writeHead(status, {
    "Content-Type": type,
    ...securityHeaders(options),
    ...(options.headers || {})
  });
  response.end(value);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    let tooLarge = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      if (!tooLarge) body += chunk;
    });
    request.on("end", () => {
      if (tooLarge) {
        reject(new PolicyError(
          "body_too_large",
          `Request body exceeds ${MAX_BODY_BYTES} bytes.`,
          413
        ));
        return;
      }
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new PolicyError("invalid_json", "Request body is not valid JSON.", 400));
      }
    });
    request.on("error", reject);
  });
}

export function safeFile(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const file = path.resolve(root, relative);
  if (!file.startsWith(`${root}${path.sep}`)) return null;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(file);
  if (!realFile.startsWith(`${realRoot}${path.sep}`)) return null;
  return realFile;
}

function sendFile(response, file, options = {}) {
  response.writeHead(200, {
    "Content-Type": contentTypes[path.extname(file)] || "application/octet-stream",
    ...securityHeaders(options),
    ...(options.headers || {})
  });
  fs.createReadStream(file).pipe(response);
}

function allowedByManifest(app, namespace, method, args) {
  const grants = app.manifest.ui?.host_api || {};
  if (namespace === "tools" && method === "invoke") {
    return Array.isArray(grants.tools) &&
      grants.tools.length > 0 &&
      app.allowedToolIds.has(args?.tool_id);
  }
  const methods = grants[namespace];
  return Array.isArray(methods) &&
    (methods.includes(method) || methods.includes("*"));
}

function normalizeRpcName(value, field) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,63}$/i.test(value)) {
    throw new PolicyError(
      "invalid_rpc_name",
      `${field} must be a simple RPC identifier.`,
      400
    );
  }
  return value;
}

function publicApp(app) {
  return {
    slug: app.slug,
    name: app.name,
    version: app.version,
    summary: app.summary,
    accent: app.accent,
    permissions: app.manifest.permissions,
    host_api: app.manifest.ui?.host_api || {},
    tools: Object.entries(app.toolIds).map(([alias, tool_id]) => ({ alias, tool_id }))
  };
}

export function createLocalAnnaHost(options = {}) {
  const registry = loadAppRegistry();
  const runtimeDir = options.runtimeDir ||
    path.join(os.tmpdir(), `anna-local-host-${process.pid}`);
  fs.mkdirSync(runtimeDir, { recursive: true });
  const pool = new ExecutaPool(registry.tools, {
    runtimeDir,
    nodePath: options.nodePath || process.execPath
  });
  const windows = new Map();
  const audit = [];
  const storage = new Map();
  const adminToken = randomId("admin");
  const windowTtlMs = Math.max(10, Number(options.windowTtlMs || 30 * 60 * 1000));
  const maxRpcPerMinute = Math.max(1, Number(options.maxRpcPerMinute || 120));
  const maxInflightRpc = Math.max(1, Number(options.maxInflightRpc || 8));

  function requireAdmin(request) {
    if (!timingSafeEqual(request.headers["x-anna-admin-token"], adminToken)) {
      throw new PolicyError("invalid_admin_token", "Invalid Host management token.", 401);
    }
  }

  function appCorsHeaders(request) {
    return request.headers.origin === "null"
      ? {
          "Access-Control-Allow-Origin": "null",
          "Access-Control-Allow-Headers": "content-type, x-anna-app-token",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Vary": "Origin"
        }
      : {};
  }

  function record(entry) {
    audit.push({ ts: new Date().toISOString(), ...entry });
    if (audit.length > MAX_AUDIT_ENTRIES) audit.shift();
  }

  function createWindow(appSlug) {
    const app = registry.apps.get(appSlug);
    if (!app) throw new PolicyError("app_not_found", `Unknown app: ${appSlug}`, 404);
    const id = randomId("win");
    const window_ = {
      id,
      token: randomId("cap"),
      bootstrap: randomId("boot"),
      appSlug,
      title: app.name,
      grants: { external_network: options.externalNetwork === true },
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + windowTtlMs,
      rpcTimestamps: [],
      inflightRpc: 0
    };
    windows.set(id, window_);
    record({
      app: appSlug,
      window_id: id,
      namespace: "window",
      method: "create",
      outcome: "ok",
      arg_keys: ["app_slug"]
    });
    return window_;
  }

  function acquireRpc(window_) {
    const cutoff = Date.now() - 60_000;
    window_.rpcTimestamps = window_.rpcTimestamps.filter((ts) => ts > cutoff);
    if (window_.rpcTimestamps.length >= maxRpcPerMinute) {
      throw new PolicyError(
        "rpc_rate_limited",
        "Anna App RPC rate limit exceeded.",
        429
      );
    }
    if (window_.inflightRpc >= maxInflightRpc) {
      throw new PolicyError(
        "rpc_concurrency_limited",
        "Anna App has too many concurrent RPC requests.",
        429
      );
    }
    window_.rpcTimestamps.push(Date.now());
    window_.inflightRpc += 1;
  }

  function authenticate(request) {
    const token = request.headers["x-anna-app-token"];
    const window_ = [...windows.values()].find((candidate) =>
      timingSafeEqual(candidate.token, token)
    );
    if (!window_) {
      throw new PolicyError("invalid_app_token", "Invalid Anna App token.", 401);
    }
    if (window_.expiresAt <= Date.now()) {
      windows.delete(window_.id);
      throw new PolicyError("app_token_expired", "Anna App token has expired.", 401);
    }
    return window_;
  }

  async function dispatchRpc(request, response) {
    if (request.headers.origin && request.headers.origin !== "null") {
      throw new PolicyError(
        "cors_denied",
        "App RPC requires a sandboxed origin.",
        403
      );
    }
    const window_ = authenticate(request);
    acquireRpc(window_);
    try {
      const app = registry.apps.get(window_.appSlug);
      const body = await readJson(request);
      const namespace = normalizeRpcName(body.namespace, "namespace");
      const method = normalizeRpcName(body.method, "method");
      const args = body.args || {};
      const started = Date.now();
      const baseAudit = {
        app: app.slug,
        window_id: window_.id,
        namespace,
        method,
        arg_keys: auditShape(args)
      };

      try {
        if (!allowedByManifest(app, namespace, method, args)) {
          throw new PolicyError(
            "permission_denied",
            `${namespace}.${method} is not granted by manifest.ui.host_api.`
          );
        }
        assertNoSensitivePayload(args);
        let result;
        if (namespace === "tools" && method === "invoke") {
          enforceInvokePolicy({ app, args, grants: window_.grants });
          const toolId = args.tool_id;
          const toolMethod = args.method;
          const invokeResult = await pool.invoke(toolId, toolMethod, args.args || {});
          if (invokeResult?.success !== true) {
            const code = invokeResult?.error?.code || "tool_error";
            throw new PolicyError(
              code,
              `Executa rejected the request (${code}).`,
              422
            );
          }
          result = invokeResult;
        } else if (namespace === "chat" && method === "write_message") {
          result = {
            message_id: randomId("msg"),
            ephemeral: true,
            content_length: String(args.content || "").length
          };
        } else if (namespace === "storage") {
          const appStore = storage.get(app.slug) || new Map();
          storage.set(app.slug, appStore);
          const key = String(args.key || "");
          if (!key || key.length > 200) {
            throw new PolicyError("invalid_storage_key", "Storage key is required.", 400);
          }
          if (method === "get") result = { value: appStore.get(key) ?? null };
          if (method === "set") {
            appStore.set(key, args.value);
            result = { ok: true };
          }
          if (method === "delete") {
            result = { deleted: appStore.delete(key) };
          }
          if (method === "list") {
            result = { keys: [...appStore.keys()].sort() };
          }
        } else if (namespace === "window" && method === "set_title") {
          window_.title = String(args.title || app.name).slice(0, 160);
          result = { ok: true, title: window_.title };
        } else {
          throw new PolicyError(
            "not_implemented",
            `${namespace}.${method} is not implemented by the local host.`,
            501
          );
        }

        assertResultHasNoSecrets(result);
        record({
          ...baseAudit,
          outcome: "ok",
          duration_ms: Date.now() - started
        });
        json(response, 200, { result }, appCorsHeaders(request));
      } catch (error) {
        record({
          ...baseAudit,
          outcome: "denied",
          error_code: error.code || "internal_error",
          duration_ms: Date.now() - started
        });
        throw error;
      }
    } finally {
      window_.inflightRpc = Math.max(0, window_.inflightRpc - 1);
    }
  }

  async function handle(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    const pathname = url.pathname;

    if (request.method === "GET" && pathname === "/healthz") {
      json(response, 200, { ok: true, service: "anna-local-host-lab" });
      return;
    }

    if (request.method === "GET" && pathname === "/api/status") {
      requireAdmin(request);
      json(response, 200, {
        service: "anna-local-host-lab",
        privacy_mode: "strict",
        apps: [...registry.apps.values()].map(publicApp),
        window_count: windows.size,
        executas: pool.stats(),
        audit_entries: audit.length
      });
      return;
    }

    const windowMatch = pathname.match(/^\/api\/windows\/([^/]+)$/);
    if (request.method === "DELETE" && windowMatch) {
      requireAdmin(request);
      const window_ = windows.get(windowMatch[1]);
      if (!window_) throw new PolicyError("window_not_found", "Window not found.", 404);
      windows.delete(window_.id);
      record({
        app: window_.appSlug,
        window_id: window_.id,
        namespace: "window",
        method: "close",
        outcome: "ok",
        arg_keys: []
      });
      json(response, 200, { closed: true });
      return;
    }

    if (request.method === "POST" && pathname === "/api/windows") {
      requireAdmin(request);
      const body = await readJson(request);
      const window_ = createWindow(body.app_slug);
      json(response, 201, {
        window_id: window_.id,
        app_slug: window_.appSlug,
        url: `/apps/${window_.appSlug}/?window=${window_.id}&bootstrap=${window_.bootstrap}`
      });
      return;
    }

    const grantMatch = pathname.match(/^\/api\/windows\/([^/]+)\/grants$/);
    if (request.method === "PATCH" && grantMatch) {
      requireAdmin(request);
      const window_ = windows.get(grantMatch[1]);
      if (!window_) throw new PolicyError("window_not_found", "Window not found.", 404);
      const body = await readJson(request);
      window_.grants.external_network = body.external_network === true;
      record({
        app: window_.appSlug,
        window_id: window_.id,
        namespace: "privacy",
        method: "grant_external_network",
        outcome: "ok",
        arg_keys: ["external_network"]
      });
      json(response, 200, { grants: window_.grants });
      return;
    }

    if (request.method === "GET" && pathname === "/api/audit") {
      requireAdmin(request);
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 80)));
      json(response, 200, { entries: audit.slice(-limit).reverse() });
      return;
    }

    if (request.method === "OPTIONS" && pathname === "/api/runtime/rpc") {
      if (request.headers.origin !== "null") {
        throw new PolicyError("cors_denied", "App RPC requires a sandboxed origin.", 403);
      }
      response.writeHead(204, {
        ...securityHeaders({ app: true }),
        ...appCorsHeaders(request),
        "Access-Control-Max-Age": "600"
      });
      response.end();
      return;
    }

    if (request.method === "POST" && pathname === "/api/runtime/rpc") {
      await dispatchRpc(request, response);
      return;
    }

    if (request.method === "GET" && pathname === "/runtime/context.js") {
      const window_ = windows.get(url.searchParams.get("window"));
      const bootstrap = url.searchParams.get("bootstrap");
      if (!window_ || !timingSafeEqual(window_.bootstrap, bootstrap)) {
        throw new PolicyError("window_not_found", "Window bootstrap not found.", 404);
      }
      if (window_.expiresAt <= Date.now()) {
        windows.delete(window_.id);
        throw new PolicyError("app_token_expired", "Anna App token has expired.", 401);
      }
      const app = registry.apps.get(window_.appSlug);
      const source = [
        `window.__ANNA_HOST_CONTEXT__=${JSON.stringify({
          appSlug: app.slug,
          windowId: window_.id,
          token: window_.token,
          privacyMode: "strict"
        })};`,
        `window.__ANNA_TOOL_IDS__=${JSON.stringify(app.toolIds)};`
      ].join("\n");
      text(response, 200, source, "text/javascript; charset=utf-8", {
        app: true,
        headers: appCorsHeaders(request)
      });
      return;
    }

    if (request.method === "GET" &&
        pathname === "/static/anna-apps/_sdk/latest/index.js") {
      sendFile(response, path.join(publicDir, "anna-sdk.js"), {
        app: true,
        headers: appCorsHeaders(request)
      });
      return;
    }

    const appMatch = pathname.match(/^\/apps\/([^/]+)\/(.*)$/);
    if (request.method === "GET" && appMatch) {
      const app = registry.apps.get(appMatch[1]);
      const assetPath = appMatch[2] || "index.html";
      if (!app) throw new PolicyError("app_not_found", "App not found.", 404);
      if (assetPath === "anna-tool-ids.js") {
        text(response, 200, [
          "window.__ANNA_TOOL_IDS__ = ",
          JSON.stringify(app.toolIds),
          ";\n"
        ].join(""), "text/javascript; charset=utf-8", {
          app: true,
          headers: appCorsHeaders(request)
        });
        return;
      }
      const file = safeFile(app.bundleDir, assetPath);
      if (!file) throw new PolicyError("asset_not_found", "App asset not found.", 404);
      if (path.basename(file) === "index.html") {
        const window_ = windows.get(url.searchParams.get("window"));
        const bootstrap = url.searchParams.get("bootstrap");
        if (!window_ ||
            window_.appSlug !== app.slug ||
            !timingSafeEqual(window_.bootstrap, bootstrap)) {
          throw new PolicyError("window_not_found", "App window not found.", 404);
        }
        const html = fs.readFileSync(file, "utf8").replace(
          "</head>",
          `<script src="/runtime/context.js?window=${window_.id}&bootstrap=${window_.bootstrap}"></script></head>`
        );
        text(response, 200, html, "text/html; charset=utf-8", {
          app: true,
          headers: appCorsHeaders(request)
        });
      } else {
        sendFile(response, file, {
          app: true,
          headers: appCorsHeaders(request)
        });
      }
      return;
    }

    if (request.method === "GET") {
      const file = safeFile(publicDir, pathname);
      if (file) {
        if (path.basename(file) === "index.html") {
          const nonce = crypto.randomBytes(16).toString("base64url");
          const html = fs.readFileSync(file, "utf8").replace(
            '<script type="module" src="/app.js"></script>',
            [
              `<script type="module" nonce="${nonce}">`,
              `window.__ANNA_ADMIN_TOKEN__=${JSON.stringify(adminToken)};`,
              `await import("/app.js");`,
              `</script>`
            ].join("\n")
          );
          text(response, 200, html, "text/html; charset=utf-8", { scriptNonce: nonce });
          return;
        }
        sendFile(response, file);
        return;
      }
    }

    throw new PolicyError("not_found", "Not found.", 404);
  }

  const server = http.createServer((request, response) => {
    handle(request, response).catch((error) => {
      if (response.headersSent || response.destroyed) return;
      const cors = request.url?.startsWith("/api/runtime/rpc")
        ? appCorsHeaders(request)
        : {};
      if (error instanceof PolicyError) {
        json(response, error.status, {
          error: { code: error.code, message: error.message }
        }, cors);
        return;
      }
      if (error instanceof RpcError) {
        json(response, 502, {
          error: { code: error.code, message: "Executa request failed." }
        }, cors);
        return;
      }
      json(response, 500, {
        error: { code: "internal_error", message: "Local Host internal error." }
      }, cors);
    });
  });

  return {
    adminToken,
    audit,
    pool,
    registry,
    runtimeDir,
    server,
    windows,
    createWindow,
    getWindowToken(windowId) {
      return windows.get(windowId)?.token || null;
    },
    async listen(port = 0, hostname = "127.0.0.1") {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, hostname, resolve);
      });
      const address = server.address();
      return `http://${hostname}:${address.port}`;
    },
    async close() {
      pool.close();
      if (!server.listening) return;
      await new Promise((resolve) => server.close(resolve));
    }
  };
}
